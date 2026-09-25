from __future__ import annotations

import base64
import json
import hashlib
import logging
import mimetypes
import os
import re
import shutil
import smtplib
import stat
import sys
import threading
import time
import uuid
from email.message import EmailMessage
from email.utils import getaddresses, make_msgid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from starlette.concurrency import run_in_threadpool
from .exports import render_export
from .tool import inspect_shipping_email
from .actions import (
    draft_correction_email,
    preview_ai_field_correction,
    preview_false_alarm,
    preview_rule_correction,
    preview_targeted_reread,
)
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
from agents.config import env, env_int, truthy
from agents.storage import CaseStore, FilesystemCaseStore, MongoCaseStore, get_case_store
from .schedule import ScheduledEmailQueue
from agents.tools.functions.retrieve.credential_stuffing import retrieve_knowledge

MAX_UPLOAD_BYTES = 20 * 1024 * 1024
PERSISTENCE_BATCH_SIZE = 50
logger = logging.getLogger(__name__)


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
    scheduled_email_queue = ScheduledEmailQueue(root, store)
    app = FastAPI(title="Shipping Document Verification API")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    scheduler_stop = threading.Event()
    scheduler_thread: threading.Thread | None = None

    def deliver_due_emails() -> None:
        while (job := scheduled_email_queue.claim_due()) is not None:
            try:
                message = EmailMessage()
                message["From"] = job["from"]
                message["To"] = ", ".join(job["to"])
                message["Subject"] = job["subject"]
                message["Message-ID"] = job["message_id"]
                message.set_content(job["body"])
                for attachment in job.get("attachments", []):
                    content_type = attachment.get("content_type") or "application/octet-stream"
                    maintype, subtype = content_type.split("/", 1)
                    message.add_attachment(
                        base64.b64decode(attachment["content_base64"]),
                        maintype=maintype,
                        subtype=subtype,
                        filename=attachment["filename"],
                    )
                smtp_host = env("SMTP_HOST", env("MAILPIT_SMTP_HOST", "127.0.0.1")) or "127.0.0.1"
                smtp_port = env_int("SMTP_PORT", env_int("MAILPIT_SMTP_PORT", 1025))
                local_smtp_hosts = {"127.0.0.1", "localhost", "::1"}
                if not truthy(env("EMAIL_SEND_ENABLED", "false")) and smtp_host.lower() not in local_smtp_hosts:
                    raise RuntimeError("External email sending is disabled")
                username = env("SMTP_USERNAME", "") or ""
                password = env("SMTP_PASSWORD", "") or ""
                if bool(username) != bool(password):
                    raise RuntimeError("Configure both SMTP_USERNAME and SMTP_PASSWORD")
                with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
                    if truthy(env("SMTP_STARTTLS", "false")):
                        smtp.starttls()
                    if username:
                        smtp.login(username, password)
                    smtp.send_message(message)

                sent_at = datetime.now(timezone.utc).isoformat()
                report = store.get_case(job["case_id"])
                if report is not None:
                    report.setdefault("audit_events", []).append({
                        "action": "email_sent",
                        "recipient": ", ".join(job["to"]),
                        "subject": job["subject"],
                        "message_id": job["message_id"],
                        "scheduled_email_id": job["id"],
                        "timestamp": sent_at,
                    })
                    try:
                        store.save_report(report)
                    except Exception:
                        logger.exception("Scheduled email %s sent but its audit event could not be persisted", job["id"])
                scheduled_email_queue.update(job["id"], {"status": "sent", "sent_at": sent_at})
            except Exception as error:
                logger.exception("Scheduled email %s failed", job.get("id"))
                scheduled_email_queue.update(job["id"], {"status": "failed", "error": str(error)[:500]})

    def run_email_scheduler() -> None:
        while not scheduler_stop.is_set():
            try:
                deliver_due_emails()
            except Exception:
                logger.exception("Scheduled email worker failed")
            scheduler_stop.wait(15)

    def start_email_scheduler() -> None:
        nonlocal scheduler_thread
        scheduler_stop.clear()
        scheduler_thread = threading.Thread(target=run_email_scheduler, daemon=True)
        scheduler_thread.start()

    def stop_email_scheduler() -> None:
        scheduler_stop.set()
        if scheduler_thread is not None:
            scheduler_thread.join(timeout=2)

    app.router.on_startup.append(start_email_scheduler)
    app.router.on_shutdown.append(stop_email_scheduler)

    @app.get("/", response_class=HTMLResponse)
    async def dashboard() -> HTMLResponse:
        return dashboard_page()

    @app.get("/cases")
    async def cases(page: int = 1, page_size: int = 1000) -> dict[str, Any]:
        page = max(page, 1)
        page_size = min(max(page_size, 1), 1000)
        skip = (page - 1) * page_size
        cases = await run_in_threadpool(store.list_cases, skip=skip, limit=page_size)
        return {
            "ok": True,
            "cases": cases,
            "page": page,
            "page_size": page_size,
            "has_more": len(cases) == page_size,
        }

    @app.post("/inbox/mailpit/sync")
    async def sync_mailpit(background_tasks: BackgroundTasks) -> dict[str, Any]:
        base_url = env("MAILPIT_URL", "http://127.0.0.1:8025").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                summaries = await _mailpit_summaries(client, base_url)
                known_cases = await run_in_threadpool(store.list_cases)
                known_case_ids = {
                    str(case.get("email_id") or "") for case in known_cases
                }
                known_mailpit_cases = {
                    str(case["mailpit_id"]): str(case.get("email_id") or "")
                    for case in known_cases
                    if case.get("mailpit_id")
                }
                imported = 0
                for summary in summaries:
                    message_id = str(summary.get("ID") or summary.get("id") or "")
                    if not message_id:
                        continue
                    known_email_id = known_mailpit_cases.get(message_id)
                    if known_email_id and not known_email_id.startswith("mailpit_"):
                        continue
                    detail_response = await client.get(f"{base_url}/api/v1/message/{message_id}")
                    detail_response.raise_for_status()
                    message = detail_response.json()
                    email_id = _mailpit_email_id(message_id, message)
                    if email_id in known_case_ids:
                        known_mailpit_cases[message_id] = email_id
                        continue
                    hashed_id = f"mailpit_{hashlib.sha256(message_id.encode()).hexdigest()[:24]}"
                    if hashed_id != email_id and hashed_id in known_case_ids:
                        renamed = await run_in_threadpool(
                            _rename_mailpit_case,
                            root,
                            store,
                            hashed_id,
                            email_id,
                            message_id,
                        )
                        if renamed:
                            known_case_ids.discard(hashed_id)
                            known_case_ids.add(email_id)
                            known_mailpit_cases[message_id] = email_id
                            continue
                    attachment_data: list[tuple[str, bytes]] = []
                    for attachment in message.get("Attachments", []):
                        part_id = str(attachment.get("PartID") or "")
                        filename = str(attachment.get("FileName") or f"attachment_{part_id}")
                        if not part_id:
                            continue
                        part_response = await client.get(
                            f"{base_url}/api/v1/message/{message_id}/part/{part_id}"
                        )
                        part_response.raise_for_status()
                        attachment_data.append((filename, part_response.content))
                    dataset_root = await run_in_threadpool(
                        _save_mailpit_message,
                        root,
                        email_id,
                        message,
                        attachment_data,
                    )
                    sender = _mailpit_address(message.get("From"))
                    subject = str(message.get("Subject") or "(No subject)")
                    body = str(message.get("Text") or message.get("text") or "")
                    placeholder = {
                        "email_id": email_id,
                        "sender": sender,
                        "subject": subject,
                        "body": body,
                        "attachments": [
                            f"attachments/{path.name}"
                            for path in (dataset_root / "attachments").glob("*")
                        ],
                        "category": "UNPROCESSED",
                        "status": "UNPROCESSED",
                        "review_reason": "processing",
                        "source": "mailpit",
                        "mailpit_id": message_id,
                    }
                    await run_in_threadpool(store.save_report, placeholder)
                    known_case_ids.add(email_id)
                    known_mailpit_cases[message_id] = email_id
                    background_tasks.add_task(
                        _process_received_case,
                        store,
                        dataset_root,
                        email_id,
                        env("MAILPIT_INCLUDE_AI", "false").lower() == "true",
                    )
                    imported += 1
        except (httpx.HTTPError, ValueError) as error:
            raise HTTPException(status_code=502, detail=f"Could not read Mailpit: {error}") from error
        return {"ok": True, "imported": imported}

    @app.get("/cases/{email_id}")
    def case_detail(email_id: str, background_tasks: BackgroundTasks) -> dict[str, Any]:
        report = store.get_case(email_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Case report not found")
        needs_verifier = (
            report.get("status") == "MISMATCH"
            and bool(report.get("defect_fields"))
            and "verifier" not in report
        )
        telemetry = report.get("routing_telemetry") or {}
        needs_ambiguity_analysis = bool(telemetry.get("ambiguous_fields")) and not report.get(
            "ocr_distortion_analysis"
        )
        if needs_verifier or needs_ambiguity_analysis:
            background_tasks.add_task(_enrich_case_report, store, report)
        return {"ok": True, "report": report}

    @app.get("/cases/{email_id}/related")
    def related_cases(email_id: str) -> dict[str, Any]:
        report = store.get_case(email_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Case report not found")

        reference_keys = _case_reference_keys(report)
        matches = []
        if reference_keys:
            for candidate in store.list_reports():
                candidate_id = str(candidate.get("email_id") or "")
                if not candidate_id or candidate_id == email_id:
                    continue
                shared_references = reference_keys & _case_reference_keys(candidate)
                if not shared_references:
                    continue
                matches.append({
                    "email_id": candidate_id,
                    "subject": str(candidate.get("subject") or f"Shipping case {candidate_id}"),
                    "category": candidate.get("category", "UNKNOWN"),
                    "status": candidate.get("status", "UNPROCESSED"),
                    "shared_references": sorted(shared_references),
                    "updated_at": candidate.get("updated_at"),
                })
        matches.sort(
            key=lambda item: (len(item["shared_references"]), item["updated_at"] or ""),
            reverse=True,
        )
        return {"email_id": email_id, "cases": matches[:10]}

    @app.post("/email/send")
    def send_email(
        case_id: str = Form(...),
        to: str = Form(...),
        subject: str = Form(...),
        body: str = Form(""),
        case_attachment_names: str = Form("[]"),
        attachments: list[UploadFile] = File(default=[]),
    ) -> dict[str, Any]:
        report = store.get_case(case_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Case report not found")

        recipients = [address for _, address in getaddresses([to]) if address]
        if not recipients or any(
            not re.fullmatch(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", address)
            for address in recipients
        ):
            raise HTTPException(status_code=422, detail="Enter one or more valid recipient email addresses")
        if not subject.strip() or any(character in subject for character in "\r\n"):
            raise HTTPException(status_code=422, detail="Email subject is required and must be a single line")
        try:
            requested_case_attachments = json.loads(case_attachment_names)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=422, detail="Invalid case attachment selection") from error
        if not isinstance(requested_case_attachments, list) or not all(
            isinstance(name, str) for name in requested_case_attachments
        ):
            raise HTTPException(status_code=422, detail="Invalid case attachment selection")

        message = EmailMessage()
        message["From"] = env("SMTP_FROM", "la-peace@localhost") or "la-peace@localhost"
        message["To"] = ", ".join(recipients)
        message["Subject"] = subject.strip()
        message["Message-ID"] = make_msgid(domain="la-peace.local")
        message.set_content(body)

        total_attachment_bytes = 0
        available_case_attachments = {
            Path(str(reference)).name: str(reference)
            for reference in report.get("attachments") or []
        }
        for requested_name in requested_case_attachments:
            filename = Path(requested_name).name
            if filename not in available_case_attachments:
                raise HTTPException(status_code=422, detail=f"Attachment is not part of case {case_id}")
            attachment_path = (root / _safe_id(case_id) / "attachments" / filename).resolve()
            content = attachment_path.read_bytes() if attachment_path.is_file() else None
            if content is None and isinstance(store, MongoCaseStore):
                stored = store.get_attachment(case_id, filename)
                if stored is not None:
                    content = stored[0]
            if content is None:
                raise HTTPException(status_code=404, detail=f"Case attachment not found: {filename}")
            total_attachment_bytes += len(content)
            content_type, _ = mimetypes.guess_type(filename)
            maintype, subtype = content_type.split("/", 1) if content_type else ("application", "octet-stream")
            message.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)

        for attachment in attachments:
            filename = _safe_filename(attachment.filename or "attachment")
            content = attachment.file.read(MAX_UPLOAD_BYTES + 1)
            total_attachment_bytes += len(content)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="An email attachment exceeds the 20 MB limit")
            content_type = attachment.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            maintype, subtype = content_type.split("/", 1) if "/" in content_type else ("application", "octet-stream")
            message.add_attachment(content, maintype=maintype, subtype=subtype, filename=filename)
        if total_attachment_bytes > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Combined email attachments exceed the 20 MB limit")

        smtp_host = env("SMTP_HOST", env("MAILPIT_SMTP_HOST", "127.0.0.1")) or "127.0.0.1"
        smtp_port = env_int("SMTP_PORT", env_int("MAILPIT_SMTP_PORT", 1025))
        local_smtp_hosts = {"127.0.0.1", "localhost", "::1"}
        if not truthy(env("EMAIL_SEND_ENABLED", "false")) and smtp_host.lower() not in local_smtp_hosts:
            raise HTTPException(status_code=503, detail="External email sending is disabled; set EMAIL_SEND_ENABLED=true to enable it")
        username = env("SMTP_USERNAME", "") or ""
        password = env("SMTP_PASSWORD", "") or ""
        if bool(username) != bool(password):
            raise HTTPException(status_code=503, detail="Configure both SMTP_USERNAME and SMTP_PASSWORD")
        try:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as smtp:
                if truthy(env("SMTP_STARTTLS", "false")):
                    smtp.starttls()
                if username:
                    smtp.login(username, password)
                smtp.send_message(message)
        except Exception as error:
            logger.exception("SMTP delivery failed for case %s", case_id)
            raise HTTPException(status_code=502, detail="Email delivery failed; check backend SMTP configuration") from error

        sent_at = datetime.now(timezone.utc).isoformat()
        report.setdefault("audit_events", []).append({
            "action": "email_sent",
            "recipient": ", ".join(recipients),
            "subject": subject.strip(),
            "message_id": message["Message-ID"],
            "timestamp": sent_at,
        })
        audit_logged = True
        try:
            store.save_report(report)
        except Exception:
            audit_logged = False
            logger.exception("Email sent but audit event could not be persisted for case %s", case_id)
        return {
            "sent": True,
            "email_id": case_id,
            "to": recipients,
            "message_id": message["Message-ID"],
            "sent_at": sent_at,
            "audit_logged": audit_logged,
        }

    @app.post("/email/schedule")
    def schedule_email(
        case_id: str = Form(...),
        to: str = Form(...),
        subject: str = Form(...),
        body: str = Form(""),
        scheduled_at: str = Form(...),
        case_attachment_names: str = Form("[]"),
        attachments: list[UploadFile] = File(default=[]),
    ) -> dict[str, Any]:
        report = store.get_case(case_id)
        if report is None:
            raise HTTPException(status_code=404, detail="Case report not found")
        recipients = [address for _, address in getaddresses([to]) if address]
        if not recipients or any(
            not re.fullmatch(r"[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+", address)
            for address in recipients
        ):
            raise HTTPException(status_code=422, detail="Enter one or more valid recipient email addresses")
        if not subject.strip() or any(character in subject for character in "\r\n"):
            raise HTTPException(status_code=422, detail="Email subject is required and must be a single line")
        try:
            delivery_time = datetime.fromisoformat(scheduled_at.replace("Z", "+00:00"))
            if delivery_time.tzinfo is None:
                raise ValueError("Timezone is required")
            delivery_time = delivery_time.astimezone(timezone.utc)
        except ValueError as error:
            raise HTTPException(status_code=422, detail="Enter a valid scheduled date and time") from error
        if delivery_time <= datetime.now(timezone.utc):
            raise HTTPException(status_code=422, detail="Scheduled time must be in the future")
        smtp_host = env("SMTP_HOST", env("MAILPIT_SMTP_HOST", "127.0.0.1")) or "127.0.0.1"
        if not truthy(env("EMAIL_SEND_ENABLED", "false")) and smtp_host.lower() not in {
            "127.0.0.1", "localhost", "::1"
        }:
            raise HTTPException(status_code=503, detail="External email sending is disabled; set EMAIL_SEND_ENABLED=true to enable it")
        if bool(env("SMTP_USERNAME", "") or "") != bool(env("SMTP_PASSWORD", "") or ""):
            raise HTTPException(status_code=503, detail="Configure both SMTP_USERNAME and SMTP_PASSWORD")
        try:
            requested_case_attachments = json.loads(case_attachment_names)
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=422, detail="Invalid case attachment selection") from error
        if not isinstance(requested_case_attachments, list) or not all(
            isinstance(name, str) for name in requested_case_attachments
        ):
            raise HTTPException(status_code=422, detail="Invalid case attachment selection")

        queued_attachments: list[dict[str, str]] = []
        attachment_bytes = 0
        available_case_attachments = {
            Path(str(reference)).name: str(reference)
            for reference in report.get("attachments") or []
        }
        for requested_name in requested_case_attachments:
            filename = Path(requested_name).name
            if filename not in available_case_attachments:
                raise HTTPException(status_code=422, detail=f"Attachment is not part of case {case_id}")
            attachment_path = (root / _safe_id(case_id) / "attachments" / filename).resolve()
            content = attachment_path.read_bytes() if attachment_path.is_file() else None
            if content is None and isinstance(store, MongoCaseStore):
                stored = store.get_attachment(case_id, filename)
                if stored is not None:
                    content = stored[0]
            if content is None:
                raise HTTPException(status_code=404, detail=f"Case attachment not found: {filename}")
            attachment_bytes += len(content)
            content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            queued_attachments.append({
                "filename": filename,
                "content_type": content_type,
                "content_base64": base64.b64encode(content).decode("ascii"),
            })

        for attachment in attachments:
            filename = _safe_filename(attachment.filename or "attachment")
            content = attachment.file.read(MAX_UPLOAD_BYTES + 1)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="An email attachment exceeds the 20 MB limit")
            attachment_bytes += len(content)
            content_type = attachment.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            queued_attachments.append({
                "filename": filename,
                "content_type": content_type,
                "content_base64": base64.b64encode(content).decode("ascii"),
            })
        if attachment_bytes > 8 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Scheduled email attachments are limited to 8 MB combined")

        job_id = uuid.uuid4().hex
        message_id = make_msgid(domain="la-peace.local")
        job = {
            "id": job_id,
            "case_id": case_id,
            "to": recipients,
            "from": env("SMTP_FROM", "la-peace@localhost") or "la-peace@localhost",
            "subject": subject.strip(),
            "body": body,
            "message_id": message_id,
            "scheduled_at": delivery_time.isoformat(),
            "attachment_names": [item["filename"] for item in queued_attachments],
            "attachments": queued_attachments,
            "status": "scheduled",
        }
        try:
            scheduled_email_queue.save(job)
        except Exception as error:
            logger.exception("Could not persist scheduled email for case %s", case_id)
            raise HTTPException(status_code=503, detail="Could not save scheduled email") from error
        report.setdefault("audit_events", []).append({
            "action": "email_scheduled",
            "scheduled_email_id": job_id,
            "recipient": ", ".join(recipients),
            "subject": subject.strip(),
            "scheduled_at": delivery_time.isoformat(),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        try:
            store.save_report(report)
        except Exception:
            logger.exception("Scheduled email %s saved but its audit event could not be persisted", job_id)
        return {key: value for key, value in job.items() if key != "attachments"}

    @app.get("/email/scheduled")
    def list_scheduled_emails() -> dict[str, Any]:
        return {"emails": scheduled_email_queue.list()}

    @app.delete("/email/scheduled/{scheduled_email_id}")
    def cancel_scheduled_email(scheduled_email_id: str) -> dict[str, bool]:
        if not scheduled_email_queue.cancel(scheduled_email_id):
            raise HTTPException(status_code=409, detail="Scheduled email is no longer cancellable")
        return {"cancelled": True}

    @app.get("/cases/{email_id}/attachments/{attachment_path:path}")
    async def case_attachment(email_id: str, attachment_path: str) -> Response:
        attachment_root = (root / _safe_id(email_id) / "attachments").resolve()
        relative_path = Path(attachment_path)
        if relative_path.parts and relative_path.parts[0] == "attachments":
            relative_path = Path(*relative_path.parts[1:])
        candidate = (attachment_root / relative_path).resolve()
        if attachment_root in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        if isinstance(store, MongoCaseStore):
            stored = store.get_attachment(email_id, relative_path.name)
            if stored is not None:
                content, content_type = stored
                return Response(
                    content=content,
                    media_type=content_type or mimetypes.guess_type(relative_path.name)[0] or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{relative_path.name}"'},
                )
        raise HTTPException(status_code=404, detail="Attachment not found")

    @app.get("/cases/{email_id}/export")
    async def export_case(email_id: str, format: str = "csv") -> Response:
        report = store.get_case(email_id)
        _validate_export_reports([report], [email_id])
        try:
            content, media_type, extension = render_export([report], format.lower())
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{_safe_id(email_id)}-draft-bl.{extension}"'},
        )

    @app.post("/exports")
    async def export_cases(payload: dict[str, Any]) -> Response:
        email_ids = payload.get("email_ids")
        export_format = str(payload.get("format", "csv")).lower()
        if (
            not isinstance(email_ids, list)
            or not email_ids
            or not all(isinstance(email_id, str) and email_id.strip() for email_id in email_ids)
        ):
            raise HTTPException(status_code=422, detail="email_ids must be a non-empty list of case IDs")
        reports = [store.get_case(email_id) for email_id in email_ids]
        _validate_export_reports(reports, email_ids)
        try:
            content, media_type, extension = render_export(reports, export_format)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="draft-bl-export.{extension}"'},
        )

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

    @app.post("/reviews/batch-rule-corrections/preview")
    def batch_rule_correction_preview() -> dict[str, Any]:
        reports = [
            report
            for report in store.list_reports()
            if report.get("category") == "BL_COMPARISON"
            and report.get("status") == "MISMATCH"
            and report.get("defect_fields")
        ]
        results = [preview_rule_correction(report) for report in reports]
        return {
            "ok": True,
            "total": len(results),
            "ready": sum(result["ready"] for result in results),
            "results": results,
        }

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

    @app.get("/api/benchmark/summary")
    async def get_benchmark_summary() -> dict[str, Any]:
        """Return certified multi-tier benchmark results."""
        artifacts_path = Path("artifacts/benchmark_results.json")
        if artifacts_path.is_file():
            try:
                return json.loads(artifacts_path.read_text(encoding="utf-8"))
            except Exception:
                pass
        from agents.eval.benchmark import run_benchmark
        return await run_in_threadpool(run_benchmark, sample_size=None, save=True)

    @app.post("/api/benchmark/run")
    async def run_live_benchmark(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        """Execute interactive live benchmark run on a specified sample size."""
        sample_size = (payload or {}).get("sample_size", 20)
        from agents.eval.benchmark import run_benchmark
        return await run_in_threadpool(run_benchmark, sample_size=sample_size, save=False)

    @app.post("/inbox/process")
    def process_inbox(payload: dict[str, Any] | None = None) -> dict[str, Any]:
        # A plain `def` runs in a worker thread, so the dashboard stays responsive meanwhile.
        options = payload or {}
        data_root = options.get("data_root") or env("SHIPPING_DATA_ROOT", "/app/data_v2")
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
        pending_reports: list[dict[str, Any]] = []
        pending_attachments: list[tuple[str, str, bytes, str | None]] = []

        def persist_batch() -> None:
            if pending_attachments:
                store.save_attachments(pending_attachments)
                pending_attachments.clear()
            if pending_reports:
                store.save_reports(pending_reports)
                pending_reports.clear()

        for email in emails:
            try:
                report = _process_inbox_case(root, adapter, email, include_ai=include_ai)
                if isinstance(store, MongoCaseStore):
                    case_root = root / _safe_id(email.email_id)
                    email_attachments: list[tuple[str, str, bytes, str | None]] = []
                    for reference in report.get("attachments", []):
                        attachment_path = case_root / reference
                        if attachment_path.is_file():
                            email_attachments.append((
                                email.email_id,
                                Path(reference).name,
                                attachment_path.read_bytes(),
                                mimetypes.guess_type(attachment_path.name)[0],
                            ))
                    pending_attachments.extend(email_attachments)
                    pending_reports.append(report)
                else:
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
                (case_root / "report.json").write_text(
                    json.dumps(failure, indent=2) + "\n", encoding="utf-8"
                )
                if isinstance(store, MongoCaseStore):
                    pending_reports.append(failure)
                else:
                    store.save_report(failure)
                results.append({
                    "email_id": email.email_id,
                    "status": "UNPROCESSED",
                    "category": "UNPROCESSED",
                    "error": str(error),
                })
            if isinstance(store, MongoCaseStore) and len(pending_reports) >= PERSISTENCE_BATCH_SIZE:
                persist_batch()

        if isinstance(store, MongoCaseStore):
            persist_batch()

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
        if not inbox_path.is_file() and isinstance(store, MongoCaseStore):
            _materialize_mongo_case(store, email_id, dataset_root)
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
        if isinstance(store, MongoCaseStore):
            for reference in report.get("attachments", []):
                attachment_path = dataset_root / reference
                if attachment_path.is_file():
                    store.save_attachment(
                        email_id,
                        Path(reference).name,
                        attachment_path.read_bytes(),
                        mimetypes.guess_type(attachment_path.name)[0],
                    )
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
    candidates = [
        Path("data_v2/ground_truth.json").resolve(),
        Path(__file__).resolve().parents[2] / "data_v2" / "ground_truth.json",
        Path(__file__).resolve().parents[2] / "problem_statement_AverisXMonash" / "Hackathon Problem Statement" / "sdoc-hackathon-docker" / "data_v2" / "ground_truth.json",
        Path.home() / "Downloads" / "sdoc-hackathon-docker" / "data_v2" / "ground_truth.json",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return candidates[0]


def _materialize_mongo_case(store: MongoCaseStore, email_id: str, dataset_root: Path) -> None:
    """Recreate retry inputs from MongoDB after an ephemeral Render restart."""
    report = store.get_case(email_id)
    if report is None:
        return
    attachments = list(report.get("attachments") or [])
    inbox = dataset_root / "inbox"
    attachment_root = dataset_root / "attachments"
    inbox.mkdir(parents=True, exist_ok=True)
    attachment_root.mkdir(parents=True, exist_ok=True)
    for reference in attachments:
        name = Path(reference).name
        stored = store.get_attachment(email_id, name)
        if stored is not None:
            (attachment_root / name).write_bytes(stored[0])
    (inbox / f"{email_id}.json").write_text(
        json.dumps({
            "email_id": email_id,
            "from": report.get("sender", ""),
            "subject": report.get("subject", ""),
            "body": report.get("body", ""),
            "attachments": [f"attachments/{Path(reference).name}" for reference in attachments],
            "source": report.get("source", "inbox"),
        }, indent=2) + "\n",
        encoding="utf-8",
    )


def _validate_export_reports(reports: list[dict[str, Any] | None], email_ids: list[str]) -> None:
    invalid = [
        email_id
        for email_id, report in zip(email_ids, reports)
        if report is None or report.get("status") != "OK" or report.get("category") != "BL_COMPARISON"
    ]
    if invalid:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "Only OK Bill of Lading verification cases can be exported.",
                "failed_email_ids": invalid,
            },
        )


def _add_verifier_result(report: dict[str, Any]) -> None:
    """Attach advisory verifier output to mismatches without mutating their verdict."""
    if report.get("status") != "MISMATCH" or not report.get("defect_fields"):
        return
    try:
        report["verifier"] = verify_shipping_discrepancies(report)
    except AIUnavailable as error:
        report["verifier"] = {"available": False, "reason": str(error)}


def _enrich_case_report(store: CaseStore, report: dict[str, Any]) -> None:
    _add_verifier_result(report)
    changed = _add_ambiguity_analysis(report)
    if report.get("verifier") is not None or changed:
        store.save_report(report)


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


async def _mailpit_summaries(
    client: httpx.AsyncClient,
    base_url: str,
    page_size: int = 50,
) -> list[dict[str, Any]]:
    start = 0
    summaries: list[dict[str, Any]] = []
    while True:
        response = await client.get(
            f"{base_url}/api/v1/messages",
            params={"limit": page_size, "start": start},
        )
        response.raise_for_status()
        payload = response.json()
        page = payload.get("messages", [])
        summaries.extend(page)
        if not page:
            break
        start += len(page)
        total = payload.get("total")
        if (total is not None and start >= int(total)) or (
            total is None and len(page) < page_size
        ):
            break
    return summaries


def _mailpit_address(value: Any) -> str:
    if isinstance(value, dict):
        return str(value.get("Address") or value.get("address") or value.get("Name") or "")
    return str(value or "")


def _mailpit_email_id(message_id: str, message: dict[str, Any]) -> str:
    for attachment in message.get("Attachments", []):
        filename = str(attachment.get("FileName") or "")
        match = re.match(r"^(email_\d+)(?:_|\.)", filename, re.IGNORECASE)
        if match:
            return match.group(1)
    return f"mailpit_{hashlib.sha256(message_id.encode()).hexdigest()[:24]}"


def _rename_mailpit_case(
    root: Path,
    store: CaseStore,
    old_id: str,
    new_id: str,
    message_id: str,
) -> bool:
    report = store.get_case(old_id)
    if report is None:
        return False

    old_root = root / _safe_id(old_id)
    new_root = root / _safe_id(new_id)
    if new_root.exists():
        return False

    inbox_path = old_root / "inbox" / f"{old_id}.json"
    inbox_record: dict[str, Any] = {}
    if inbox_path.is_file():
        inbox_record = json.loads(inbox_path.read_text(encoding="utf-8"))
    if inbox_record.get("mailpit_id") != message_id:
        return False

    if isinstance(store, MongoCaseStore):
        for attachment in report.get("attachments", []):
            name = Path(str(attachment)).name
            stored = store.get_attachment(old_id, name)
            if stored is not None:
                content, content_type = stored
                store.save_attachment(new_id, name, content, content_type)

    if old_root.is_dir():
        old_root.rename(new_root)
        inbox_path = new_root / "inbox" / f"{old_id}.json"
        if inbox_path.is_file():
            inbox_record["email_id"] = new_id
            (inbox_path.parent / f"{new_id}.json").write_text(
                json.dumps(inbox_record, indent=2) + "\n", encoding="utf-8"
            )
            inbox_path.unlink()

    report["email_id"] = new_id
    store.save_report(report)
    if isinstance(store, MongoCaseStore):
        store.delete_case(old_id)
    return True


def _save_mailpit_message(
    root: Path,
    email_id: str,
    message: dict[str, Any],
    attachments: list[tuple[str, bytes]] | None = None,
) -> Path:
    dataset_root = root / _safe_id(email_id)
    inbox_dir = dataset_root / "inbox"
    attachments_dir = dataset_root / "attachments"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    attachments_dir.mkdir(parents=True, exist_ok=True)
    for filename, content in attachments or []:
        (attachments_dir / _safe_filename(filename)).write_bytes(content)
    record = {
        "email_id": email_id,
        "from": _mailpit_address(message.get("From")),
        "subject": str(message.get("Subject") or "(No subject)"),
        "body": str(message.get("Text") or message.get("text") or ""),
        "attachments": [
            f"attachments/{path.name}" for path in attachments_dir.glob("*")
        ],
        "source": "mailpit",
        "mailpit_id": message.get("ID") or message.get("id"),
    }
    (inbox_dir / f"{email_id}.json").write_text(
        json.dumps(record, indent=2) + "\n", encoding="utf-8"
    )
    return dataset_root


def _process_received_case(
    store: CaseStore,
    dataset_root: Path,
    email_id: str,
    include_ai: bool,
) -> None:
    try:
        report = inspect_shipping_email(email_id, str(dataset_root))
        report["source"] = "mailpit"
        inbox_record = _read_json(dataset_root / "inbox" / f"{email_id}.json", {})
        if inbox_record.get("mailpit_id"):
            report["mailpit_id"] = inbox_record["mailpit_id"]
        if include_ai:
            try:
                report["ai_analysis"] = analyze_shipping_case(report)
            except AIUnavailable as error:
                report["ai_analysis"] = {"available": False, "reason": str(error)}
        (dataset_root / "report.json").write_text(
            json.dumps(report, indent=2) + "\n", encoding="utf-8"
        )
        store.save_report(report)
    except Exception as error:
        failure = _read_json(dataset_root / "inbox" / f"{email_id}.json", {})
        failure.update({
            "email_id": email_id,
            "category": "UNPROCESSED",
            "status": "UNPROCESSED",
            "review_reason": "processing_failed",
            "error": str(error),
            "source": "mailpit",
        })
        (dataset_root / "report.json").write_text(
            json.dumps(failure, indent=2) + "\n", encoding="utf-8"
        )
        store.save_report(failure)


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
    if correction.get("decision") == "false_alarm":
        if not isinstance(correction.get("note"), str) or not correction["note"].strip():
            raise HTTPException(status_code=422, detail="False-alarm overrides require an explanation")
        if not isinstance(correction.get("supporting_evidence"), str) or not correction["supporting_evidence"].strip():
            raise HTTPException(status_code=422, detail="False-alarm overrides require supporting evidence")
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
        original_defects = list(report.get("defect_fields", [])) or defects
        updated.update(
            status="NEEDS_REVIEW",
            has_defect=bool(original_defects),
            defect_fields=original_defects,
            review_reason="operator_override_pending_release",
            override_status="operator_override_not_verified",
            override_explanation=correction["note"],
            override_supporting_evidence=correction["supporting_evidence"],
        )
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


_SUBJECT_SHIPMENT_REFERENCE = re.compile(
    r"(?i)\b(?:[a-z]{2,8}\d{5,}|\d[a-z]{2,8}-\d{4,}|[a-z]{2,8}-\d{4,}|\d{7,})\b"
)
_LABELED_SHIPMENT_REFERENCE = re.compile(
    r"(?i)\b(?:booking|invoice|purchase order|po|oc|container|shipment(?: reference)?|reference|ref)"
    r"(?:\s+(?:number|no\.?))?\s*(?:[:#]\s*|\s+)([a-z0-9][a-z0-9/-]{3,})(?![a-z0-9/-])"
)
_LABELED_BL_REFERENCE = re.compile(
    r"(?i)\b(?:bill of lading|b/?l)\s*(?:number|no\.?|#)\s*[:#]?\s*"
    r"([a-z0-9][a-z0-9/-]{3,})(?![a-z0-9/-])"
)


def _case_reference_keys(report: dict[str, Any]) -> set[str]:
    subject = str(report.get("subject") or "")
    body = str(report.get("body") or "")
    attachments = report.get("attachments") or []
    if isinstance(attachments, str):
        attachments = [attachments]
    attachment_names = " ".join(str(item) for item in attachments)
    keys = set(_SUBJECT_SHIPMENT_REFERENCE.findall(subject))
    references = f"{subject}\n{body}\n{attachment_names}"
    keys.update(_LABELED_SHIPMENT_REFERENCE.findall(references))
    keys.update(_LABELED_BL_REFERENCE.findall(references))
    return {re.sub(r"[^A-Z0-9]", "", key.upper()) for key in keys if key}


def _safe_filename(value: str) -> str:
    filename = Path(value).name
    if filename in {"", ".", ".."}:
        raise HTTPException(status_code=422, detail="Invalid attachment filename")
    return re.sub(r"[^A-Za-z0-9_.()-]", "_", filename)


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))