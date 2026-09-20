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
                "deletable": False,
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
        return result.deleted_count == 1

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
    shutil.rmtree(case_root)


def _safe_case_id(value: str) -> str:
    import re

    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", value).strip(".")
    if not safe or safe != value:
        raise ValueError("email_id contains invalid characters")
    return safe
