from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agents.config import env


class CaseStore:
    """Storage abstraction for inbox records and case metadata."""

    def list_cases(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def list_reports(self) -> list[dict[str, Any]]:
        raise NotImplementedError

    def get_case(self, email_id: str) -> dict[str, Any] | None:
        raise NotImplementedError

    def save_report(self, report: dict[str, Any]) -> None:
        raise NotImplementedError

    def delete_case(self, email_id: str) -> bool:
        raise NotImplementedError

    def save_attachment(self, email_id: str, name: str, content: bytes, content_type: str | None = None) -> None:
        return None

    def get_attachment(self, email_id: str, name: str) -> tuple[bytes, str | None] | None:
        return None

class FilesystemCaseStore(CaseStore):
    def __init__(self, root: Path):
        self.root = Path(root).expanduser().resolve()

    def list_cases(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        if not self.root.is_dir():
            return items
        for report_path in sorted(self.root.glob("*/report.json")):
            report = _read_json(report_path, {})
            items.append({
                "email_id": report.get("email_id", report_path.parent.name),
                "category": report.get("category", "UNKNOWN"),
                "status": report.get("status", "UNPROCESSED"),
                "review_reason": report.get("review_reason"),
                "deletable": _is_user_upload(report_path.parent, report_path.parent.name),
                "updated_at": datetime.fromtimestamp(
                    report_path.stat().st_mtime, tz=timezone.utc
                ).isoformat(),
            })
        return items

    def get_case(self, email_id: str) -> dict[str, Any] | None:
        report_path = self.root / _safe_case_id(email_id) / "report.json"
        if not report_path.is_file():
            return None
        report = _read_json(report_path, {})
        if "body" not in report:
            inbox_record = _read_json(report_path.parent / "inbox" / f"{email_id}.json", {})
            if "body" in inbox_record:
                report["body"] = inbox_record["body"]
                report.setdefault("sender", inbox_record.get("from", ""))
                report.setdefault("subject", inbox_record.get("subject", ""))
        return report

    def list_reports(self) -> list[dict[str, Any]]:
        if not self.root.is_dir():
            return []
        return [_read_json(path, {}) for path in sorted(self.root.glob("*/report.json"))]

    def save_report(self, report: dict[str, Any]) -> None:
        email_id = report.get("email_id")
        if not email_id:
            raise ValueError("report.email_id is required")
        _ensure_report_metadata(report)
        case_root = self.root / _safe_case_id(email_id)
        case_root.mkdir(parents=True, exist_ok=True)
        (case_root / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")

    def delete_case(self, email_id: str) -> bool:
        case_root = self.root / _safe_case_id(email_id)
        if not case_root.is_dir():
            return False
        _remove_case_files(case_root)
        return True

class MongoCaseStore(CaseStore):
    def __init__(self, uri: str, database: str, collection_name: str = "cases"):
        try:
            from pymongo import MongoClient
        except ImportError as exc:  # pragma: no cover - only for environment setup
            raise RuntimeError("pymongo is required when MONGODB_URI is configured") from exc
        self.client = MongoClient(uri)
        self.database = self.client[database]
        self.collection = self.database[collection_name]
        self.collection.create_index("email_id", unique=True)
        self.attachment_collection = self.database[f"{collection_name}_attachments"]

    def list_cases(self) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for record in self.collection.find({"_deleted": {"$ne": True}}).sort("updated_at", -1):
            payload = dict(record)
            payload.pop("_id", None)
            items.append({
                "email_id": payload.get("email_id", ""),
                "category": payload.get("category", "UNKNOWN"),
                "status": payload.get("status", "UNPROCESSED"),
                "review_reason": payload.get("review_reason"),
                "deletable": payload.get("deletable", False),
                "updated_at": payload.get("updated_at"),
            })
        return items

    def get_case(self, email_id: str) -> dict[str, Any] | None:
        document = self.collection.find_one({"email_id": email_id, "_deleted": {"$ne": True}})
        if not document:
            return None
        payload = dict(document)
        payload.pop("_id", None)
        return payload

    def list_reports(self) -> list[dict[str, Any]]:
        reports: list[dict[str, Any]] = []
        for document in self.collection.find({"_deleted": {"$ne": True}}).sort("updated_at", -1):
            document.pop("_id", None)
            reports.append(document)
        return reports

    def save_report(self, report: dict[str, Any]) -> None:
        email_id = report.get("email_id")
        if not email_id:
            raise ValueError("report.email_id is required")
        _ensure_report_metadata(report)
        payload = dict(report)
        payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        self.collection.update_one(
            {"email_id": email_id},
            {"$set": payload},
            upsert=True,
        )

    def delete_case(self, email_id: str) -> bool:
        result = self.collection.delete_one({"email_id": email_id})
        self.attachment_collection.delete_many({"email_id": email_id})
        return result.deleted_count == 1

    def save_attachment(
        self,
        email_id: str,
        name: str,
        content: bytes,
        content_type: str | None = None,
    ) -> None:
        self.attachment_collection.replace_one(
            {"email_id": email_id, "name": name},
            {
                "email_id": email_id,
                "name": name,
                "content": content,
                "content_type": content_type,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
            upsert=True,
        )

    def get_attachment(self, email_id: str, name: str) -> tuple[bytes, str | None] | None:
        document = self.attachment_collection.find_one({"email_id": email_id, "name": name})
        if not document:
            return None
        return bytes(document.get("content", b"")), document.get("content_type")

def get_case_store(
    root: str | Path,
    mongo_uri: str | None = None,
    mongo_db: str | None = None,
    prefer_mongo: bool = True,
) -> CaseStore:
    uri = mongo_uri or env("MONGODB_URI")
    database = mongo_db or env("MONGODB_DB", "shipping") or "shipping"
    if prefer_mongo and uri:
        return MongoCaseStore(uri=uri, database=database)
    return FilesystemCaseStore(root=root)


def _read_json(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def _ensure_report_metadata(report: dict[str, Any]) -> None:
    now = datetime.now(timezone.utc).isoformat()
    report.setdefault("created_at", now)
    report["updated_at"] = now
    report.setdefault("review_decisions", [])
    report.setdefault("correction_history", [])
    audit_events = report.setdefault("audit_events", [])
    if not audit_events:
        audit_events.append({
            "event": "case_created",
            "actor": "verification_engine",
            "at": now,
        })


def _remove_case_files(case_root: Path) -> None:
    """Delete a case folder, coping with read-only files and briefly locked files on Windows."""
    import os
    import stat
    import sys
    import time

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


def _is_user_upload(case_root: Path, email_id: str) -> bool:
    import re

    record = _read_json(case_root / "inbox" / f"{email_id}.json", {})
    if record.get("source") is not None:
        return record["source"] == "upload"
    report = _read_json(case_root / "report.json", {})
    return report.get("source") != "inbox" and not re.fullmatch(r"email_\d+", email_id)


def _safe_case_id(value: str) -> str:
    import re

    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", value).strip(".")
    if not safe or safe != value:
        raise ValueError("email_id contains invalid characters")
    return safe
