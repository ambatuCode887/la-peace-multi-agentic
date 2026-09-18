from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import HTMLResponse

from .tool import inspect_shipping_email
from .ui import dashboard_page


def create_app(upload_root: str | Path = ".artifacts/uploads") -> FastAPI:
    root = Path(upload_root).expanduser().resolve()
    app = FastAPI(title="Shipping Document Verification API")

    @app.get("/", response_class=HTMLResponse)
    async def dashboard() -> HTMLResponse:
        return dashboard_page()

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
        report_path = dataset_root / "report.json"
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        return {"ok": True, "report": report, "report_path": str(report_path)}

    @app.post("/reviews/{email_id}")
    async def correct_review(email_id: str, correction: dict[str, Any]) -> dict[str, Any]:
        dataset_root = root / _safe_id(email_id)
        if not (dataset_root / "inbox" / f"{email_id}.json").is_file():
            raise HTTPException(status_code=404, detail="Uploaded email not found")
        _validate_correction(correction)
        corrections_path = dataset_root / "review-corrections.json"
        corrections = _read_json(corrections_path, {})
        corrections[email_id] = correction
        corrections_path.write_text(json.dumps(corrections, indent=2) + "\n", encoding="utf-8")

        submission = _read_json(dataset_root / "submission.json", {})
        submission[email_id] = correction
        (dataset_root / "submission.json").write_text(
            json.dumps(submission, indent=2) + "\n", encoding="utf-8"
        )
        return {"ok": True, "email_id": email_id, "result": correction}

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
        path.write_bytes(upload.file.read())
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


def _validate_correction(correction: dict[str, Any]) -> None:
    required = {"category", "status", "review_reason", "has_defect", "defect_fields"}
    if not required.issubset(correction):
        raise HTTPException(status_code=422, detail=f"Correction requires: {sorted(required)}")
    if correction["status"] not in {"OK", "MISMATCH", "NEEDS_REVIEW"}:
        raise HTTPException(status_code=422, detail="Invalid status")
    if not isinstance(correction["defect_fields"], list):
        raise HTTPException(status_code=422, detail="defect_fields must be a list")


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