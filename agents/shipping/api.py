from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse
from .tool import inspect_shipping_email
from .actions import draft_correction_email, preview_false_alarm, preview_targeted_reread
from .ui import dashboard_page
from .ai import AIUnavailable, analyze_shipping_case, chat_about_shipping_case, verify_shipping_discrepancies
from .dataset import DatasetAdapter, DatasetEmail
from .verification import COMPARE_FIELDS, values_match
from agents.config import env
from agents.tools.functions.retrieve.credential_stuffing import retrieve_knowledge

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def create_app(upload_root: str | Path = ".artifacts/uploads") -> FastAPI:
    root = Path(upload_root).expanduser().resolve()
    app = FastAPI(title="Shipping Document Verification API")

    @app.get("/", response_class=HTMLResponse)
    async def dashboard() -> HTMLResponse:
        return dashboard_page()

    @app.get("/cases")
    async def cases() -> dict[str, Any]:
        items = []
        if root.is_dir():
            for report_path in sorted(root.glob("*/report.json")):
                report = _read_json(report_path, {})
                items.append({
                    "email_id": report.get("email_id", report_path.parent.name),
                    "category": report.get("category", "UNKNOWN"),
                    "status": report.get("status", "UNPROCESSED"),
                    "review_reason": report.get("review_reason"),
                    "updated_at": datetime.fromtimestamp(
                        report_path.stat().st_mtime, tz=timezone.utc
                    ).isoformat(),
                })
        return {"ok": True, "cases": items}

    @app.get("/cases/{email_id}")
    async def case_detail(email_id: str) -> dict[str, Any]:
        report_path = root / _safe_id(email_id) / "report.json"
        if not report_path.is_file():
            raise HTTPException(status_code=404, detail="Case report not found")
        return {"ok": True, "report": _read_json(report_path, {})}

    @app.post("/cases/{email_id}/manager-review")
    async def manager_review(email_id: str) -> dict[str, Any]:
        dataset_root = root / _safe_id(email_id)
        report_path = dataset_root / "report.json"
        if not report_path.is_file():
            raise HTTPException(status_code=404, detail="Uploaded email report not found")

        report = _read_json(report_path, {})
        try:
            review = await _run_manager_review(email_id, dataset_root)
        except Exception as error:
            review = {
                "available": False,
                "route": "human_review",
                "deterministic_status": report.get("status"),
                "defects": report.get("defect_fields", []),
                "retrieved_guidance": [],
                "recommended_next_action": (
                    "Review the deterministic report manually; optional manager guidance "
                    f"was unavailable: {error}"
                ),
            }
        return {
            "ok": True,
            "email_id": email_id,
            "deterministic_status": report.get("status"),
            "deterministic_defects": report.get("defect_fields", []),
            "manager_review": review,
        }

    @app.post("/cases/{email_id}/action-preview")
    async def action_preview(email_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        report_path = root / _safe_id(email_id) / "report.json"
        if not report_path.is_file():
            raise HTTPException(status_code=404, detail="Uploaded email report not found")
        report = _read_json(report_path, {})
        action = payload.get("action")
        try:
            if action == "draft_correction_email":
                preview = draft_correction_email(report, str(payload.get("requested_correction", "")))
            elif action == "false_alarm":
                preview = preview_false_alarm(report, str(payload.get("note", "")))
            elif action == "targeted_reread":
                preview = preview_targeted_reread(report, str(payload.get("field", "")))
            else:
                raise ValueError("action must be draft_correction_email, false_alarm, or targeted_reread")
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {"ok": True, "email_id": email_id, "preview": preview}

    @app.get("/metrics")
    async def metrics() -> dict[str, Any]:
        reports = [_read_json(path, {}) for path in root.glob("*/report.json")] if root.is_dir() else []
        return {
            "ok": True,
            "processed": len(reports),
            "needs_review": sum(report.get("status") == "NEEDS_REVIEW" for report in reports),
            "mismatches": sum(report.get("status") == "MISMATCH" for report in reports),
            "ok_cases": sum(report.get("status") == "OK" for report in reports),
            "categories": {
                category: sum(report.get("category") == category for report in reports)
                for category in {report.get("category") for report in reports if report.get("category")}
            },
        }

    @app.post("/inbox/process")
    async def process_inbox(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        options = payload or {}
        data_root = options.get("data_root") or env("SHIPPING_DATA_ROOT", "http://localhost:8080")
        if not isinstance(data_root, str) or not data_root.strip():
            raise HTTPException(status_code=422, detail="data_root must be a non-empty string")
        include_ai = options.get("include_ai", False)
        if not isinstance(include_ai, bool):
            raise HTTPException(status_code=422, detail="include_ai must be a boolean")

        try:
            adapter = DatasetAdapter(data_root)
            emails = adapter.emails()
        except Exception as error:
            raise HTTPException(status_code=502, detail=f"Could not load inbox: {error}") from error

        results: list[dict[str, Any]] = []
        for email in emails:
            try:
                report = _process_inbox_case(root, adapter, email, include_ai=include_ai)
                results.append({
                    "email_id": email.email_id,
                    "status": report.get("status", "UNPROCESSED"),
                    "category": report.get("category"),
                })
            except Exception as error:
                case_root = root / _safe_id(email.email_id)
                case_root.mkdir(parents=True, exist_ok=True)
                failure = {
                    "email_id": email.email_id,
                    "sender": email.sender,
                    "subject": email.subject,
                    "category": "UNPROCESSED",
                    "status": "UNPROCESSED",
                    "error": str(error),
                    "source": "inbox",
                }
                (case_root / "report.json").write_text(
                    json.dumps(failure, indent=2) + "\n", encoding="utf-8"
                )
                results.append({
                    "email_id": email.email_id,
                    "status": "UNPROCESSED",
                    "category": "UNPROCESSED",
                    "error": str(error),
                })

        return {
            "ok": True,
            "data_root": data_root,
            "processed": len(results),
            "failed": sum(item["status"] == "UNPROCESSED" for item in results),
            "results": results,
        }

    @app.post("/cases/{email_id}/retry")
    async def retry_case(email_id: str) -> dict[str, Any]:
        dataset_root = root / _safe_id(email_id)
        inbox_path = dataset_root / "inbox" / f"{email_id}.json"
        if not inbox_path.is_file():
            raise HTTPException(status_code=404, detail="Uploaded email not found")
        report = inspect_shipping_email(email_id, str(dataset_root))
        _add_verifier_result(report)
        try:
            report["ai_analysis"] = analyze_shipping_case(report)
        except AIUnavailable as error:
            report["ai_analysis"] = {"available": False, "reason": str(error)}
        (dataset_root / "report.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
        return {"ok": True, "report": report}

    @app.post("/verify")
    async def verify_upload(
        email_id: str = Form(...),
        sender: str = Form(""),
        subject: str = Form(""),
        body: str = Form(""),
        attachments: list[UploadFile] = File(...),
    ) -> dict[str, Any]:
        dataset_root = _save_upload(root, email_id, sender, subject, body, attachments)
        report = inspect_shipping_email(email_id, str(dataset_root))
        _add_verifier_result(report)
        try:
            report["ai_analysis"] = analyze_shipping_case(report)
        except AIUnavailable as error:
            report["ai_analysis"] = {"available": False, "reason": str(error)}
        report_path = dataset_root / "report.json"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return {"ok": True, "report": report, "report_path": str(report_path)}

    @app.post("/chat/{email_id}")
    async def chat(email_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        dataset_root = root / _safe_id(email_id)
        report_path = dataset_root / "report.json"
        if not report_path.is_file():
            raise HTTPException(status_code=404, detail="Uploaded email report not found")
        message = payload.get("message")
        if not isinstance(message, str) or not message.strip():
            raise HTTPException(status_code=422, detail="message is required")
        history = payload.get("history", [])
        if not isinstance(history, list) or not all(
            isinstance(turn, dict)
            and isinstance(turn.get("role"), str)
            and isinstance(turn.get("content"), str)
            for turn in history
        ):
            raise HTTPException(status_code=422, detail="history must be a list of role/content messages")
        report = _read_json(report_path, {})
        try:
            answer = chat_about_shipping_case(report, message, history[-20:])
        except AIUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        return {"ok": True, "email_id": email_id, **answer}

    @app.post("/reviews/{email_id}")
    async def correct_review(email_id: str, correction: dict[str, Any]) -> dict[str, Any]:
        dataset_root = root / _safe_id(email_id)
        if not (dataset_root / "inbox" / f"{email_id}.json").is_file():
            raise HTTPException(status_code=404, detail="Uploaded email not found")
        _validate_correction(correction)
        report_path = dataset_root / "report.json"
        report = _read_json(report_path, {})
        corrected_report = _apply_review_correction(report, correction)
        corrections_path = dataset_root / "review-corrections.json"
        corrections = _read_json(corrections_path, {})
        correction = {
            **correction,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }
        corrections[email_id] = correction
        corrections_path.write_text(json.dumps(corrections, indent=2) + "\n", encoding="utf-8")
        report_path.write_text(json.dumps(corrected_report, indent=2) + "\n", encoding="utf-8")

        submission = _read_json(dataset_root / "submission.json", {})
        submission[email_id] = {
            "category": corrected_report.get("category", correction["category"]),
            "status": corrected_report.get("status", correction["status"]),
            "review_reason": corrected_report.get("review_reason"),
            "has_defect": corrected_report.get("has_defect", False),
            "defect_fields": corrected_report.get("defect_fields", []),
        }
        (dataset_root / "submission.json").write_text(
            json.dumps(submission, indent=2) + "\n", encoding="utf-8"
        )
        clarification = _clarification_draft(report, correction) if correction.get("decision") == "request_clarification" else None
        if clarification:
            (dataset_root / "clarification-draft.json").write_text(
                json.dumps(clarification, indent=2) + "\n", encoding="utf-8"
            )
        return {"ok": True, "email_id": email_id, "result": corrected_report, "correction": correction, "clarification_draft": clarification}

    return app


def _add_verifier_result(report: dict[str, Any]) -> None:
    """Attach advisory verifier output to mismatches without mutating their verdict."""
    if report.get("status") != "MISMATCH" or not report.get("defect_fields"):
        return
    try:
        report["verifier"] = verify_shipping_discrepancies(report)
    except AIUnavailable as error:
        report["verifier"] = {"available": False, "reason": str(error)}


def _save_upload(
    root: Path,
    email_id: str,
    sender: str,
    subject: str,
    body: str,
    attachments: list[UploadFile],
) -> Path:
    safe_id = _safe_id(email_id)
    dataset_root = root / safe_id
    inbox_dir = dataset_root / "inbox"
    attachments_dir = dataset_root / "attachments"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)
    references: list[str] = []
    for index, upload in enumerate(attachments):
        filename = _safe_filename(upload.filename or f"attachment_{index}")
        path = attachments_dir / filename
        content = upload.file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"Attachment exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit")
        path.write_bytes(content)
        references.append(f"attachments/{filename}")
    record = {
        "email_id": email_id,
        "from": sender,
        "subject": subject,
        "body": body,
        "attachments": references,
        "source": "upload",
    }
    (inbox_dir / f"{email_id}.json").write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8"
    )
    return dataset_root


async def _run_manager_review(email_id: str, dataset_root: Path) -> dict[str, Any]:
    """Add RAG guidance to the saved deterministic report without recomputing it."""
    report = _read_json(dataset_root / "report.json", {})
    status = report.get("status", "NEEDS_REVIEW")
    defects = list(report.get("defect_fields", []))
    route = "automatic_match" if status == "OK" else "human_review"
    if status == "NEEDS_REVIEW" and report.get("review_reason") in {
        "missing_attachment",
        "unreadable",
        "wrong_doc_type",
    }:
        route = "clarification_needed"

    query = (
        "shipping document verification guidance for "
        f"status {status}, fields {', '.join(defects) or 'none'}, "
        f"review reason {report.get('review_reason') or 'none'}"
    )
    retrieval = retrieve_knowledge(query, limit=10)
    guidance_terms = {
        "container_count": {"container", "containers", "package", "quantity"},
        "notify_party": {"notify party", "notify-party", "notify"},
        "shipper": {"shipper", "exporter", "legal entity"},
        "consignee": {"consignee", "receiver", "importer"},
        "port_of_loading": {"port mismatch", "port of loading", "loading port", "locode"},
        "port_of_discharge": {"port mismatch", "port of discharge", "discharge port", "locode"},
        "gross_weight_kg": {"gross weight", "gross wt", "kilograms", "kg", "mt", "lb"},
    }
    relevant_terms = {
        term
        for field in defects
        for term in guidance_terms.get(field, {field.replace("_", " ")})
    }
    specific_terms = {
        "container_count": {"container count mismatch", "different container quantities", "correct count"},
        "notify_party": {"notify-party mismatch", "full notify-party", "different company or address"},
        "shipper": {"shipper mismatch", "full legal entity name"},
        "consignee": {"consignee mismatch", "full legal entity name"},
        "port_of_loading": {"port mismatch", "port aliases", "different port"},
        "port_of_discharge": {"port mismatch", "port aliases", "different port"},
        "gross_weight_kg": {"gross-weight mismatch", "normalize both gross weights", "normalized values"},
    }
    preferred_terms = {
        term
        for field in defects
        for term in specific_terms.get(field, set())
    }
    candidates = []
    for item in retrieval.get("results", []):
        raw_text = item.get("text", "")
        if relevant_terms and not any(term in raw_text.lower() for term in relevant_terms):
            continue
        text = re.sub(r"#{1,6}\s*", "", raw_text)
        text = re.sub(r"\s+", " ", text).strip()
        score = sum(raw_text.lower().count(term) for term in preferred_terms)
        if text:
            candidates.append((score, text))
    best_score = max((score for score, _ in candidates), default=0)
    if best_score >= 2:
        candidates = [item for item in candidates if item[0] == best_score]
    field_guidance = {
        "container_count": "Compare the number of containers and package descriptions on the SI and BL. Different container quantities are a real mismatch; confirm the correct count against the source documents before release.",
        "notify_party": "Compare the full notify-party name and address on the SI and BL. Formatting differences may be equivalent, but a different company or address requires confirmation before release.",
        "shipper": "Compare the complete shipper legal name, address, and country. Check OCR, abbreviations, trading names, and legal suffixes before confirming whether the entity mismatch is genuine.",
        "consignee": "Compare the complete consignee legal name, address, and country. Check OCR, abbreviations, trading names, and legal suffixes before confirming whether the entity mismatch is genuine.",
        "port_of_loading": "Compare the port name and UN/LOCODE on both documents. A different loading port requires human review before release.",
        "port_of_discharge": "Compare the port name and UN/LOCODE on both documents. A different discharge port requires human review before release.",
        "gross_weight_kg": "Normalize both gross weights to kilograms and verify the units and evidence lines. A difference remaining after conversion is a real mismatch.",
    }
    guidance = [field_guidance[field] for field in defects if field in field_guidance]
    if not guidance:
        for _, text in sorted(candidates, key=lambda item: item[0], reverse=True):
            excerpt = text[:420].rstrip() + ("..." if len(text) > 420 else "")
            if excerpt not in guidance:
                guidance.append(excerpt)
            if len(guidance) == 2:
                break
    if status == "OK":
        action = "No further action is required unless a reviewer identifies new evidence."
    elif defects:
        action = f"Confirm the {', '.join(defects)} value(s) against the source documents before release."
    else:
        action = "Request the missing or unreadable document/value, then re-run verification."
    return {
        "available": True,
        "route": route,
        "deterministic_status": status,
        "defects": defects,
        "retrieved_guidance": guidance,
        "recommended_next_action": action,
    }


def _process_inbox_case(
    root: Path,
    adapter: DatasetAdapter,
    email: DatasetEmail,
    *,
    include_ai: bool,
) -> dict[str, Any]:
    case_root = root / _safe_id(email.email_id)
    inbox_dir = case_root / "inbox"
    attachments_dir = case_root / "attachments"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)

    references: list[str] = []
    for index, reference in enumerate(email.attachments):
        filename = _safe_filename(Path(reference).name or f"attachment_{index}")
        if filename in {Path(item).name for item in references}:
            filename = f"{index}_{filename}"
        (attachments_dir / filename).write_bytes(adapter.read_bytes(reference))
        references.append(f"attachments/{filename}")

    record = dict(email.raw)
    record.update({
        "email_id": email.email_id,
        "from": email.sender,
        "subject": email.subject,
        "body": email.body,
        "attachments": references,
    })
    (inbox_dir / f"{email.email_id}.json").write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8"
    )

    report = inspect_shipping_email(email.email_id, str(case_root))
    report["source"] = "inbox"
    _add_verifier_result(report)
    if include_ai:
        try:
            report["ai_analysis"] = analyze_shipping_case(report)
        except AIUnavailable as error:
            report["ai_analysis"] = {"available": False, "reason": str(error)}
    (case_root / "report.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return report


def _validate_correction(correction: dict[str, Any]) -> None:
    required = {"category", "status", "review_reason", "has_defect", "defect_fields"}
    if not required.issubset(correction):
        raise HTTPException(status_code=422, detail=f"Correction requires: {sorted(required)}")
    if correction["status"] not in {"OK", "MISMATCH", "NEEDS_REVIEW"}:
        raise HTTPException(status_code=422, detail="Invalid status")
    if not isinstance(correction["defect_fields"], list):
        raise HTTPException(status_code=422, detail="defect_fields must be a list")
    if "decision" in correction and correction["decision"] not in {"accept", "confirm_mismatch", "false_alarm", "request_clarification"}:
        raise HTTPException(status_code=422, detail="Invalid review decision")
    for document_key in ("si_fields", "bl_fields"):
        if document_key in correction and not isinstance(correction[document_key], dict):
            raise HTTPException(status_code=422, detail=f"{document_key} must be an object")


def _apply_review_correction(report: dict[str, Any], correction: dict[str, Any]) -> dict[str, Any]:
    updated = dict(report)
    documents = {key: dict(value) for key, value in report.get("documents", {}).items()}
    for document_key, correction_key in (("si", "si_fields"), ("bl", "bl_fields")):
        if correction_key not in correction or document_key not in documents:
            continue
        document = dict(documents[document_key])
        fields = dict(document.get("fields", {}))
        fields.update({field: value for field, value in correction[correction_key].items() if field in COMPARE_FIELDS})
        document["fields"] = fields
        document["missing_fields"] = [field for field in COMPARE_FIELDS if fields.get(field) in (None, "")]
        documents[document_key] = document
    if documents:
        updated["documents"] = documents
    si = documents.get("si", {}).get("fields", {})
    bl = documents.get("bl", {}).get("fields", {})
    defects = [field for field in COMPARE_FIELDS if not values_match(field, si.get(field), bl.get(field))]
    decision = correction.get("decision")
    if decision == "false_alarm":
        updated.update(status="OK", has_defect=False, defect_fields=[], review_reason=None)
    elif decision == "confirm_mismatch":
        updated.update(status="MISMATCH", has_defect=True, defect_fields=defects or correction.get("defect_fields", []), review_reason=None)
    elif decision == "request_clarification":
        updated.update(status="NEEDS_REVIEW", review_reason="clarification_requested")
    elif documents and not any(documents[key].get("missing_fields") for key in ("si", "bl") if key in documents):
        updated.update(status="MISMATCH" if defects else "OK", has_defect=bool(defects), defect_fields=defects, review_reason=None)
    if correction.get("note"):
        updated["review_note"] = correction["note"]
    return updated


def _clarification_draft(report: dict[str, Any], correction: dict[str, Any]) -> dict[str, str]:
    reason = correction.get("note") or report.get("review_reason") or "additional document clarification"
    email_id = report.get("email_id", "shipment")
    return {
        "to": report.get("sender", ""),
        "subject": f"Clarification required for shipping documents - {email_id}",
        "body": (
            "Hello,\n\nWe need clarification before completing the shipping document verification. "
            f"Reason: {reason}. Please confirm the correct SI and BL values or provide the missing document.\n\n"
            "Regards,\nShipping Operations"
        ),
    }


def _safe_id(value: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", value).strip(".")
    if not safe or safe != value:
        raise HTTPException(status_code=422, detail="email_id contains invalid characters")
    return safe


def _safe_filename(value: str) -> str:
    filename = Path(value).name
    if filename in {"", ".", ".."}:
        raise HTTPException(status_code=422, detail="Invalid attachment filename")
    return re.sub(r"[^A-Za-z0-9_.()-]", "_", filename)


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


app = create_app()