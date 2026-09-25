from __future__ import annotations

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from agents.storage import MongoCaseStore


class ScheduledEmailQueue:
    def __init__(self, root: str | Path, case_store: Any) -> None:
        self._lock = threading.Lock()
        self._directory = Path(root) / "scheduled_emails"
        self._collection = None
        if isinstance(case_store, MongoCaseStore):
            self._collection = case_store.database["scheduled_emails"]
            self._collection.create_index([("status", 1), ("scheduled_at", 1)])
        else:
            self._directory.mkdir(parents=True, exist_ok=True)

    def save(self, job: dict[str, Any]) -> None:
        if self._collection is not None:
            self._collection.insert_one(dict(job))
            return
        with self._lock:
            self._write_file(job)

    def list(self) -> list[dict[str, Any]]:
        if self._collection is not None:
            jobs = list(self._collection.find({}, {"_id": 0, "attachments": 0}).sort("scheduled_at", 1))
        else:
            with self._lock:
                jobs = [self._read_file(path) for path in sorted(self._directory.glob("*.json"))]
        for job in jobs:
            job.pop("attachments", None)
        return sorted(jobs, key=lambda job: job.get("scheduled_at", ""))

    def cancel(self, job_id: str) -> bool:
        if self._collection is not None:
            result = self._collection.update_one(
                {"id": job_id, "status": "scheduled"},
                {"$set": {"status": "cancelled"}},
            )
            return result.modified_count == 1
        with self._lock:
            path = self._path(job_id)
            if not path.is_file():
                return False
            job = self._read_file(path)
            if job.get("status") != "scheduled":
                return False
            job["status"] = "cancelled"
            self._write_file(job)
            return True

    def claim_due(self, now: datetime | None = None) -> dict[str, Any] | None:
        now = now or datetime.now(timezone.utc)
        now_iso = now.astimezone(timezone.utc).isoformat()
        if self._collection is not None:
            from pymongo import ReturnDocument

            job = self._collection.find_one_and_update(
                {"status": "scheduled", "scheduled_at": {"$lte": now_iso}},
                {"$set": {"status": "sending"}},
                sort=[("scheduled_at", 1)],
                return_document=ReturnDocument.AFTER,
            )
            if job:
                job.pop("_id", None)
            return job
        with self._lock:
            for path in sorted(self._directory.glob("*.json")):
                job = self._read_file(path)
                if job.get("status") != "scheduled" or job.get("scheduled_at", "") > now_iso:
                    continue
                job["status"] = "sending"
                self._write_file(job)
                return job
        return None

    def update(self, job_id: str, values: dict[str, Any]) -> None:
        if self._collection is not None:
            update = {"$set": values}
            if values.get("status") in {"sent", "failed"}:
                update["$unset"] = {"attachments": ""}
            self._collection.update_one({"id": job_id}, update)
            return
        with self._lock:
            path = self._path(job_id)
            if not path.is_file():
                return
            job = self._read_file(path)
            job.update(values)
            if job.get("status") in {"sent", "failed"}:
                job.pop("attachments", None)
            self._write_file(job)

    def get_for_delivery(self, job_id: str) -> dict[str, Any] | None:
        if self._collection is not None:
            job = self._collection.find_one({"id": job_id}, {"_id": 0})
            return dict(job) if job else None
        with self._lock:
            path = self._path(job_id)
            return self._read_file(path) if path.is_file() else None

    def _path(self, job_id: str) -> Path:
        safe_id = "".join(character for character in job_id if character.isalnum() or character in "-_")
        if not safe_id or safe_id != job_id:
            raise ValueError("Invalid scheduled email ID")
        return self._directory / f"{safe_id}.json"

    def _read_file(self, path: Path) -> dict[str, Any]:
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_file(self, job: dict[str, Any]) -> None:
        path = self._path(str(job["id"]))
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(job, indent=2) + "\n", encoding="utf-8")
        temporary.replace(path)