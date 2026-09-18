from __future__ import annotations

import json
from urllib.request import urlopen
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator


@dataclass(frozen=True)
class DatasetEmail:
    """An inbox record plus its dataset-relative attachment references."""

    email_id: str
    sender: str
    subject: str
    body: str
    attachments: tuple[str, ...]
    raw: dict[str, Any]


class DatasetAdapter:
    """Read a local SDOC ``data_v2`` directory.

    The expected root contains ``inbox/`` and ``attachments/`` directories.
    Attachment references are resolved relative to that root, matching the
    paths stored in the challenge email records.
    """

    def __init__(self, data_root: str | Path) -> None:
        self.source = str(data_root).rstrip("/")
        self.is_http = self.source.startswith(("http://", "https://"))
        if self.is_http:
            self.data_root = None
            self.inbox_dir = None
            self.attachments_dir = None
            return
        self.data_root = Path(data_root).expanduser().resolve()
        self.inbox_dir = self.data_root / "inbox"
        self.attachments_dir = self.data_root / "attachments"
        if not self.inbox_dir.is_dir():
            raise FileNotFoundError(f"Inbox directory not found: {self.inbox_dir}")
        if not self.attachments_dir.is_dir():
            raise FileNotFoundError(
                f"Attachments directory not found: {self.attachments_dir}"
            )

    def emails(self) -> list[DatasetEmail]:
        """Load all inbox records in deterministic email-id order."""
        if self.is_http:
            return [self._from_raw_email(item) for item in self._get_json("/emails")]
        return [self._load_email(path) for path in sorted(self.inbox_dir.glob("email_*.json"))]

    def __iter__(self) -> Iterator[DatasetEmail]:
        return iter(self.emails())

    def get(self, email_id: str) -> DatasetEmail:
        """Load one inbox record by its ``email_id``."""
        if self.is_http:
            return self._from_raw_email(self._get_json(f"/emails/{email_id}"))
        path = self.inbox_dir / f"{email_id}.json"
        if not path.is_file():
            raise FileNotFoundError(f"Email record not found: {email_id}")
        return self._load_email(path)

    def resolve_attachment(self, attachment: str) -> Path:
        """Resolve and validate an attachment reference from an email record."""
        if self.is_http:
            raise ValueError("HTTP datasets do not expose local attachment paths")
        relative = Path(attachment)
        if relative.is_absolute():
            raise ValueError(f"Attachment must be dataset-relative: {attachment}")

        path = (self.data_root / relative).resolve()
        attachments_root = self.attachments_dir.resolve()
        if path != attachments_root and attachments_root not in path.parents:
            raise ValueError(f"Attachment escapes the attachments directory: {attachment}")
        if not path.is_file():
            raise FileNotFoundError(f"Attachment not found: {attachment}")
        return path

    def read_bytes(self, attachment: str) -> bytes:
        if self.is_http:
            return self._get_bytes("/attachments/" + attachment.removeprefix("attachments/"))
        return self.resolve_attachment(attachment).read_bytes()

    def read_text(self, attachment: str, encoding: str = "utf-8") -> str:
        return self.read_bytes(attachment).decode(encoding, errors="replace")

    def _load_email(self, path: Path) -> DatasetEmail:
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            raise ValueError(f"Invalid email JSON: {path}") from error
        if not isinstance(raw, dict):
            raise ValueError(f"Email record must be a JSON object: {path}")

        email_id = raw.get("email_id")
        attachments = raw.get("attachments", [])
        if not isinstance(email_id, str) or not email_id.strip():
            raise ValueError(f"Email record has no valid email_id: {path}")
        if not isinstance(attachments, list) or not all(
            isinstance(item, str) for item in attachments
        ):
            raise ValueError(f"Email attachments must be a list of strings: {path}")

        return self._from_raw_email(raw)

    def _from_raw_email(self, raw: dict[str, Any]) -> DatasetEmail:
        email_id = raw.get("email_id")
        attachments = raw.get("attachments", [])
        if not isinstance(email_id, str) or not email_id.strip():
            raise ValueError("Email record has no valid email_id")
        if not isinstance(attachments, list) or not all(isinstance(item, str) for item in attachments):
            raise ValueError(f"Email attachments must be a list of strings: {email_id}")
        return DatasetEmail(
            email_id=email_id,
            sender=str(raw.get("from", "")),
            subject=str(raw.get("subject", "")),
            body=str(raw.get("body", "")),
            attachments=tuple(attachments),
            raw=raw,
        )

    def _get_json(self, path: str) -> Any:
        with urlopen(self.source + path) as response:
            return json.loads(response.read())

    def _get_bytes(self, path: str) -> bytes:
        with urlopen(self.source + path) as response:
            return response.read()