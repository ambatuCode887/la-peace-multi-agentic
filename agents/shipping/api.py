from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse

from .tool import inspect_shipping_email
from .ui import dashboard_page
from .ai import AIUnavailable, analyze_shipping_case, chat_about_shipping_case
from .dataset import DatasetAdapter, DatasetEmail
from .verification import COMPARE_FIELDS
from agents.config import env

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
    }
    (inbox_dir / f"{email_id}.json").write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8"
    )
    return dataset_root


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
    defects = [field for field in COMPARE_FIELDS if si.get(field) != bl.get(field)]
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