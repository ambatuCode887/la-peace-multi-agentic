from __future__ import annotations

import json
import os
import re
import shutil
import stat
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from .tool import inspect_shipping_email
from .actions import draft_correction_email, preview_ai_field_correction, preview_false_alarm, preview_targeted_reread
from .ui import dashboard_page
from .ai import (
    AIUnavailable,
    TARGETED_FIELD_COST_USD,
    analyze_field_ambiguity,
    analyze_shipping_case,
    chat_about_shipping_case,
    verify_shipping_discrepancies,
)
from .dataset import DatasetAdapter, DatasetEmail
from agents.eval.shipping import (
    append_snapshot,
    evaluate_shipping_reports,
    load_ground_truth,
    load_reports,
    read_snapshots,
)
from .verification import COMPARE_FIELDS, values_match
from agents.config import env
from agents.storage import CaseStore, FilesystemCaseStore, get_case_store
from agents.tools.functions.retrieve.credential_stuffing import retrieve_knowledge

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def create_app(
    upload_root: str | Path = ".artifacts/uploads",
    case_store: CaseStore | None = None,
) -> FastAPI:
    root = Path(upload_root).expanduser().resolve()
    production_root = Path(upload_root) == Path(".artifacts/uploads")
    if case_store is None and production_root and not env("MONGODB_URI"):
        raise RuntimeError(
            "MONGODB_URI is required for the production shipping API; "
            "refusing to fall back to local or Docker report storage."
        )
    store = case_store or get_case_store(
        root,
        prefer_mongo=production_root,
    )
    app = FastAPI(title="Shipping Document Verification API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/", response_class=HTMLResponse)
    async def dashboard() -> HTMLResponse:
        return dashboard_page()

    @app.get("/cases")
    async def cases() -> dict[str, Any]:
        return {"ok": True, "cases": store.list_cases()}

    @app.get("/cases/{email_id}")
    def case_detail(email_id: str) -> dict[str, Any]:
        report = store.get_case(email_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Case report not found")
        if report.get("status") == "MISMATCH" and "verifier" not in report:
            # Bulk processing skips the slow AI verifier; run it once, the first time a mismatch is opened.
            _add_verifier_result(report)
            store.save_report(report)
        if _add_ambiguity_analysis(report):
            store.save_report(report)
        return {"ok": True, "report": report}

    @app.get("/cases/{email_id}/attachments/{attachment_path:path}")
    async def case_attachment(email_id: str, attachment_path: str) -> FileResponse:
        attachment_root = (root / _safe_id(email_id) / "attachments").resolve()
        relative_path = Path(attachment_path)
        if relative_path.parts and relative_path.parts[0] == "attachments":
            relative_path = Path(*relative_path.parts[1:])
        candidate = (attachment_root / relative_path).resolve()
        if attachment_root not in candidate.parents or not candidate.is_file():
            raise HTTPException(status_code=404, detail="Attachment not found")
        return FileResponse(candidate)

    @app.delete("/cases/{email_id}")
    async def delete_case(email_id: str) -> dict[str, Any]:
        case_root = root / _safe_id(email_id)
        if isinstance(store, FilesystemCaseStore) and not case_root.is_dir():
            raise HTTPException(status_code=404, detail="Case not found")
        if isinstance(store, FilesystemCaseStore) and not _is_user_upload(case_root, email_id):
            raise HTTPException(status_code=403, detail="Only cases created from the upload form can be deleted")
        deleted = store.delete_case(email_id)
        if not deleted:
            raise HTTPException(status_code=404, detail="Case not found")
        if case_root.is_dir():
            _remove_case(case_root)
        return {"ok": True, "email_id": email_id}

    @app.post("/cases/{email_id}/manager-review")
    async def manager_review(email_id: str) -> dict[str, Any]:
        dataset_root = root / _safe_id(email_id)
        report = store.get_case(email_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Uploaded email report not found")

        report_path = dataset_root / "report.json"
        if not report_path.is_file():
            dataset_root.mkdir(parents=True, exist_ok=True)
            report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        try:
            review = await _run_manager_review(email_id, dataset_root)
        except Exception as error:
            review = {
                "available": False,
                "route": "human_review",
                "reason": str(error),
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
        report = store.get_case(email_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Uploaded email report not found")
        action = payload.get("action")
        try:
            if action == "draft_correction_email":
                preview = draft_correction_email(report, str(payload.get("requested_correction", "")))
            elif action == "false_alarm":
                preview = preview_false_alarm(report, str(payload.get("note", "")))
            elif action == "targeted_reread":
                preview = preview_targeted_reread(report, str(payload.get("field", "")))
            elif action == "ai_field_correction":
                preview = preview_ai_field_correction(report, str(payload.get("request", "")))
            else:
                raise ValueError("action must be draft_correction_email, false_alarm, targeted_reread, or ai_field_correction")
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {"ok": True, "email_id": email_id, "preview": preview}

    @app.get("/metrics")
    async def metrics() -> dict[str, Any]:
        reports = store.list_reports()
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

    @app.get("/evaluation")
    async def evaluation() -> dict[str, Any]:
        ground_truth_path = _ground_truth_path()
        try:
            ground_truth = load_ground_truth(ground_truth_path)
        except (FileNotFoundError, ValueError) as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        result = evaluate_shipping_reports(ground_truth, load_reports(root))
        result["ground_truth_path"] = str(ground_truth_path)
        result["snapshots"] = read_snapshots(root.parent / "evaluation-history.json")
        return {"ok": True, "evaluation": result}

    @app.post("/evaluation/snapshots")
    async def save_evaluation_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
        label = payload.get("label")
        if not isinstance(label, str) or not label.strip():
            raise HTTPException(status_code=422, detail="label is required")
        ground_truth_path = _ground_truth_path()
        try:
            ground_truth = load_ground_truth(ground_truth_path)
        except (FileNotFoundError, ValueError) as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        result = evaluate_shipping_reports(ground_truth, load_reports(root))
        snapshot = append_snapshot(root.parent / "evaluation-history.json", label, result)
        return {"ok": True, "snapshot": snapshot}

    @app.post("/inbox/process")
    def process_inbox(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        # A plain `def` runs in a worker thread, so the dashboard stays responsive meanwhile.
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
                store.save_report(report)
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
                store.save_report(failure)
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
        _add_ambiguity_analysis(report)
        try:
            report["ai_analysis"] = analyze_shipping_case(report)
        except AIUnavailable as error:
            report["ai_analysis"] = {"available": False, "reason": str(error)}
        (dataset_root / "report.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
        store.save_report(report)
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
        _add_ambiguity_analysis(report)
        try:
            report["ai_analysis"] = analyze_shipping_case(report)
        except AIUnavailable as error:
            report["ai_analysis"] = {"available": False, "reason": str(error)}
        report_path = dataset_root / "report.json"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        store.save_report(report)
        return {"ok": True, "report": report, "report_path": str(report_path)}

    @app.post("/chat/{email_id}")
    async def chat(email_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        report = store.get_case(email_id)
        if report is None:
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
        try:
            answer = chat_about_shipping_case(report, message, history[-20:])
        except AIUnavailable as error:
            raise HTTPException(status_code=503, detail=str(error)) from error
        return {"ok": True, "email_id": email_id, **answer}

    @app.post("/reviews/{email_id}")
    async def correct_review(email_id: str, correction: dict[str, Any]) -> dict[str, Any]:
        dataset_root = root / _safe_id(email_id)
        report = store.get_case(email_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Case report not found")
        _validate_correction(correction)
        report_path = dataset_root / "report.json"
        corrected_report = _apply_review_correction(report, correction)
        corrections_path = dataset_root / "review-corrections.json"
        corrections = _read_json(corrections_path, {})
        correction = {
            **correction,
            "reviewed_at": datetime.now(timezone.utc).isoformat(),
        }
        corrections[email_id] = correction
        corrected_report.setdefault("review_decisions", []).append(correction)
        corrected_report.setdefault("correction_history", []).append({
            "reviewed_at": correction["reviewed_at"],
            "decision": correction.get("decision"),
            "note": correction.get("note"),
            "status": corrected_report.get("status"),
            "defect_fields": corrected_report.get("defect_fields", []),
        })
        corrected_report.setdefault("audit_events", []).append({
            "event": "review_saved",
            "actor": correction.get("reviewer", "operator"),
            "at": correction["reviewed_at"],
            "decision": correction.get("decision"),
        })
        if dataset_root.is_dir():
            corrections_path.write_text(json.dumps(corrections, indent=2) + "\n", encoding="utf-8")
            report_path.write_text(json.dumps(corrected_report, indent=2) + "\n", encoding="utf-8")
        store.save_report(corrected_report)

        submission = _read_json(dataset_root / "submission.json", {})
        submission[email_id] = {
            "category": corrected_report.get("category", correction["category"]),
            "status": corrected_report.get("status", correction["status"]),
            "review_reason": corrected_report.get("review_reason"),
            "has_defect": corrected_report.get("has_defect", False),
            "defect_fields": corrected_report.get("defect_fields", []),
        }
        if dataset_root.is_dir():
            (dataset_root / "submission.json").write_text(
                json.dumps(submission, indent=2) + "\n", encoding="utf-8"
            )
        clarification = _clarification_draft(report, correction) if correction.get("decision") == "request_clarification" else None
        if clarification and dataset_root.is_dir():
            (dataset_root / "clarification-draft.json").write_text(
                json.dumps(clarification, indent=2) + "\n", encoding="utf-8"
            )
        return {"ok": True, "email_id": email_id, "result": corrected_report, "correction": correction, "clarification_draft": clarification}

    return app


def _ground_truth_path() -> Path:
    configured = env("SHIPPING_GROUND_TRUTH_PATH", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    return Path.home() / "Downloads" / "sdoc-hackathon-docker" / "data_v2" / "ground_truth.json"


def _add_verifier_result(report: dict[str, Any]) -> None:
    """Attach advisory verifier output to mismatches without mutating their verdict."""
    if report.get("status") != "MISMATCH" or not report.get("defect_fields"):
        return
    try:
        report["verifier"] = verify_shipping_discrepancies(report)
    except AIUnavailable as error:
        report["verifier"] = {"available": False, "reason": str(error)}


def _add_ambiguity_analysis(report: dict[str, Any]) -> bool:
    """Diagnose only routed fields; deterministic status remains authoritative."""
    telemetry = report.get("routing_telemetry")
    documents = report.get("documents", {})
    ambiguous_fields = telemetry.get("ambiguous_fields", []) if isinstance(telemetry, dict) else []
    if not ambiguous_fields or not isinstance(documents, dict):
        return False

    si = documents.get("si", {})
    bl = documents.get("bl", {})
    si_attachment = str(si.get("attachment") or "").lower()
    bl_attachment = str(bl.get("attachment") or "").lower()
    if not (si_attachment.endswith(".pdf") and bl_attachment.endswith(".pdf")):
        updated_telemetry = dict(telemetry)
        updated_telemetry["sent_to_llm"] = 0
        updated_telemetry["llm_latency_ms"] = 0.0
        updated_telemetry["llm_calls"] = 0
        updated_telemetry["estimated_cost_usd"] = 0.0
        updated_telemetry["field_resolutions"] = {
            **updated_telemetry.get("field_resolutions", {}),
            **{
                field: {"source": "human", "reason": "text_ambiguity_requires_human"}
                for field in ambiguous_fields
            },
        }
        updated_telemetry["scalability_summary"] = (
            "10,000 emails/day = $0.00/day targeted vs "
            "$15.00/day full-document (100% savings; text ambiguity held for human review)"
        )
        report["routing_telemetry"] = updated_telemetry
        report["status"] = "NEEDS_REVIEW"
        report["review_reason"] = "ambiguous_field"
        report["ocr_distortion_analysis"] = []
        return True

    analyses: list[dict[str, Any]] = []
    total_llm_latency = 0.0
    attempted_calls = 0
    for field in ambiguous_fields:
        attempted_calls += 1
        si_details = si.get("evidence_details", {}).get(field, {})
        bl_details = bl.get("evidence_details", {}).get(field, {})
        si_snippet = str(si_details.get("source_text") or si.get("evidence", {}).get(field) or "")
        bl_snippet = str(bl_details.get("source_text") or bl.get("evidence", {}).get(field) or "")
        try:
            analysis = analyze_field_ambiguity(
                field,
                si.get("fields", {}).get(field),
                bl.get("fields", {}).get(field),
                si_snippet,
                bl_snippet,
            )
        except AIUnavailable as error:
            analyses.append({
                "field": field,
                "diagnosis": "UNAVAILABLE",
                "is_ocr_distortion": False,
                "explanation": str(error),
                "suggested_operator_action": "Review the source documents manually.",
                "confidence": 0.0,
            })
            continue
        total_llm_latency += float(analysis.get("latency_ms", 0.0))
        analyses.append(analysis)

    report["ocr_distortion_analysis"] = analyses
    report["status"] = "NEEDS_REVIEW"
    report["has_defect"] = False
    if any(item.get("is_ocr_distortion") for item in analyses):
        report["review_reason"] = "ocr_distortion_suspected"
    elif report.get("review_reason") not in {"missing_value", "wrong_doc_type", "unreadable"}:
        report["review_reason"] = "ambiguous_field"
    updated_telemetry = dict(telemetry)
    updated_telemetry["llm_latency_ms"] = round(total_llm_latency, 3)
    updated_telemetry["llm_calls"] = attempted_calls
    updated_telemetry["estimated_cost_usd"] = round(attempted_calls * TARGETED_FIELD_COST_USD, 5)
    updated_telemetry["full_document_cost_usd"] = 0.0015
    daily_targeted_cost = attempted_calls * TARGETED_FIELD_COST_USD * 10000
    daily_full_document_cost = 0.0015 * 10000
    savings = round((1 - (daily_targeted_cost / daily_full_document_cost)) * 100, 1)
    updated_telemetry["scalability_summary"] = (
        f"10,000 emails/day = ${daily_targeted_cost:.2f}/day targeted vs "
        f"${daily_full_document_cost:.2f}/day full-document ({savings:.0f}% savings)"
    )
    report["routing_telemetry"] = updated_telemetry
    return True


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


# Every review reason gets a knowledge citation. Matches and non-comparison emails do not:
# there is no decision for the reviewer to make, so a citation would only add noise.
_CITED_REVIEW_REASONS = {
    "ambiguous_field",
    "unreadable",
    "missing_value",
    "missing_attachment",
    "wrong_doc_type",
}

_FIELD_TERMS = {
    "container_count": {"container", "containers", "package", "quantity"},
    "notify_party": {"notify party", "notify-party", "notify"},
    "shipper": {"shipper", "exporter", "legal entity"},
    "consignee": {"consignee", "receiver", "importer"},
    "port_of_loading": {"port mismatch", "port of loading", "loading port", "locode"},
    "port_of_discharge": {"port mismatch", "port of discharge", "discharge port", "locode"},
    "gross_weight_kg": {"gross weight", "gross wt", "kilograms", "kg", "mt", "lb"},
}
# Phrases from the knowledge file's own headings, so the section about this field ranks first.
_FIELD_SECTION_TERMS = {
    "container_count": {"container count mismatch", "different container quantities"},
    "notify_party": {"notify party mismatch", "notify-party"},
    "shipper": {"shipper, consignee, or party mismatch", "legal entity name"},
    "consignee": {"shipper, consignee, or party mismatch", "legal entity name"},
    "port_of_loading": {"port mismatch", "un/locode"},
    "port_of_discharge": {"port mismatch", "un/locode"},
    "gross_weight_kg": {"gross-weight mismatch", "normalize both gross weights"},
}
_REASON_TERMS = {
    "unreadable": ({"ocr", "re-read", "unreadable", "low-confidence"}, {"ocr can confuse", "targeted re-read"}),
    "ambiguous_field": ({"ocr", "legal entity", "ambiguous"}, {"do not silently correct", "ocr can confuse"}),
    "missing_value": (
        {"missing", "required field", "low-confidence"},
        {"review routing", "missing, unreadable, or low-confidence value"},
    ),
    "missing_attachment": ({"missing", "clarification needed", "supplied evidence"}, {"review routing"}),
    "wrong_doc_type": ({"clarification needed", "conflict", "supplied evidence"}, {"review routing"}),
}


def _guidance_applies(report: dict[str, Any], status: str, defects: list[str]) -> tuple[bool, str]:
    """Decide whether this case gets knowledge citations, and say why not when it does not."""
    if report.get("category", "BL_COMPARISON") != "BL_COMPARISON":
        return False, "Knowledge guidance is only used for document-comparison emails."
    if status == "MISMATCH" and defects:
        return True, ""
    if status == "NEEDS_REVIEW" and report.get("review_reason") in _CITED_REVIEW_REASONS:
        return True, ""
    if status == "OK":
        return False, "The documents match, so no guidance is needed."
    return False, "The next step for this case is clear without knowledge guidance."


def _knowledge_sections(text: str) -> list[tuple[str, str]]:
    """Split a retrieved chunk into headed paragraphs so one citation is one topic, not a chunk.

    Returns (text to show, text to score). Only a section's first paragraph is scored together with
    its heading, so a later paragraph on another subject does not borrow the heading's relevance.
    """
    sections: list[tuple[str, str]] = []
    for part in re.split(r"(?m)^(?=#{2,6}\s)", text):
        # A part without a heading is the tail of a section that started in the previous chunk
        # and would read as a sentence cut in half, so only parts that begin at a heading are kept.
        if not part.lstrip().startswith("#"):
            continue
        heading, _, body = part.strip().partition("\n")
        heading = re.sub(r"#{1,6}\s*", "", heading).strip()
        paragraphs = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n\s*\n", body)]
        for index, paragraph in enumerate(p for p in paragraphs if p):
            shown = f"{heading} {paragraph}"
            sections.append((shown, shown if index == 0 else paragraph))
    return sections


def _count_terms(text: str, terms: set[str]) -> int:
    return sum(len(re.findall(rf"(?<!\w){re.escape(term)}(?!\w)", text)) for term in terms)


def _select_citations(
    results: list[dict[str, Any]],
    terms: set[str],
    preferred_terms: set[str],
    limit: int = 2,
) -> list[dict[str, Any]]:
    """Pick the few knowledge sections that really answer this case, without repeats."""
    scored: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in results:
        for section, scored_text in _knowledge_sections(item.get("text", "")):
            if len(section) < 40 or section in seen:
                continue  # skip bare headings, and chunks stored more than once
            seen.add(section)
            lowered = scored_text.lower()
            preferred = _count_terms(lowered, preferred_terms)
            hits = _count_terms(lowered, terms)
            if preferred == 0 and hits < 2:
                continue  # only a passing mention of the topic
            scored.append({
                "preferred": preferred,
                "hits": hits,
                "text": section,
                # Split on both separators: the source path may have been ingested on Windows.
                "source": re.split(r"[\\/]", item.get("source") or "")[-1] or "knowledge base",
                "chunk_index": item.get("chunk_index"),
                "relevance": round(float(item.get("score") or 0), 3),
            })
    if any(entry["preferred"] for entry in scored):
        scored = [entry for entry in scored if entry["preferred"]]
    scored.sort(key=lambda e: (e["preferred"], e["hits"], e["relevance"]), reverse=True)
    return [
        {
            "source": entry["source"],
            "chunk_index": entry["chunk_index"],
            "relevance": entry["relevance"],
            "excerpt": entry["text"][:420].rstrip() + ("..." if len(entry["text"]) > 420 else ""),
        }
        for entry in scored[:limit]
    ]


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

    reason = report.get("review_reason")
    ambiguous_fields = list((report.get("routing_telemetry") or {}).get("ambiguous_fields") or [])
    applies, skip_note = _guidance_applies(report, status, defects)
    citations: list[dict[str, Any]] = []
    if applies:
        # The fields that triggered the review come first; a review for ambiguity is about those.
        focus_fields = list(dict.fromkeys(
            (ambiguous_fields + defects) if reason == "ambiguous_field" else (defects or ambiguous_fields)
        ))
        terms: set[str] = {t for f in focus_fields for t in _FIELD_TERMS.get(f, {f.replace("_", " ")})}
        preferred: set[str] = {t for f in focus_fields for t in _FIELD_SECTION_TERMS.get(f, set())}
        if status == "NEEDS_REVIEW":
            reason_terms, reason_preferred = _REASON_TERMS.get(reason, (set(), set()))
            terms |= reason_terms
            preferred |= reason_preferred
        topic = ", ".join(f.replace("_", " ") for f in focus_fields) or str(reason or status)
        retrieval = retrieve_knowledge(f"shipping document {topic} guidance", limit=10)
        citations = _select_citations(retrieval.get("results", []), terms, preferred)
    field_rules = {
        "container_count": "Compare the number of containers and package descriptions on the SI and BL. Different container quantities are a real mismatch; confirm the correct count against the source documents before release.",
        "notify_party": "Compare the full notify-party name and address on the SI and BL. Formatting differences may be equivalent, but a different company or address requires confirmation before release.",
        "shipper": "Compare the complete shipper legal name, address, and country. Check OCR, abbreviations, trading names, and legal suffixes before confirming whether the entity mismatch is genuine.",
        "consignee": "Compare the complete consignee legal name, address, and country. Check OCR, abbreviations, trading names, and legal suffixes before confirming whether the entity mismatch is genuine.",
        "port_of_loading": "Compare the port name and UN/LOCODE on both documents. A different loading port requires human review before release.",
        "port_of_discharge": "Compare the port name and UN/LOCODE on both documents. A different discharge port requires human review before release.",
        "gross_weight_kg": "Normalize both gross weights to kilograms and verify the units and evidence lines. A difference remaining after conversion is a real mismatch.",
    }
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
        # Only text that was actually retrieved from Qdrant, with where it came from.
        "guidance_applicable": applies,
        "guidance_note": skip_note,
        "retrieved_guidance": [citation["excerpt"] for citation in citations],
        "citations": citations,
        # Built-in rules per defect field: not retrieved, so they are kept apart from citations.
        "field_guidance": [field_rules[field] for field in defects if field in field_rules],
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
    # The AI verifier is not run here: it calls Gemini once per mismatch and made bulk
    # processing take minutes. It runs the first time a mismatch is opened (see case_detail).
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


def _remove_case(case_root: Path) -> None:
    """Delete a case folder, coping with read-only files and briefly locked files on Windows."""
    def clear_read_only_and_retry(function: Any, path: str, _error: Any) -> None:
        os.chmod(path, stat.S_IWRITE)
        function(path)

    handler = {"onexc" if sys.version_info >= (3, 12) else "onerror": clear_read_only_and_retry}
    for attempt in range(3):
        try:
            shutil.rmtree(case_root, **handler)
            return
        except FileNotFoundError:
            return
        except OSError:
            time.sleep(0.3)
    if case_root.exists():
        raise HTTPException(
            status_code=409,
            detail="Could not delete this case because a file in it is in use. Close any program showing it and try again.",
        )


def _is_user_upload(case_root: Path, email_id: str) -> bool:
    """True for cases made with the upload form; inbox (Docker) cases are never deletable."""
    record = _read_json(case_root / "inbox" / f"{email_id}.json", {})
    if record.get("source") is not None:
        return record["source"] == "upload"
    # Uploads saved before the marker existed: not from the inbox and not named like one.
    report = _read_json(case_root / "report.json", {})
    return report.get("source") != "inbox" and not re.fullmatch(r"email_\d+", email_id)


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