from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from agents.shipping.api import _save_upload, create_app


class FakeUpload:
    def __init__(self, filename: str, content: bytes) -> None:
        self.filename = filename
        self.file = SimpleNamespace(read=lambda: content)


def test_upload_storage_creates_expected_dataset_shape(tmp_path) -> None:
    root = _save_upload(
        tmp_path,
        "email_004",
        "docs@example.com",
        "TO CONFIRM DOCS",
        "Please compare.",
        [FakeUpload("email_004_SI.txt", b"SI"), FakeUpload("email_004_BL.txt", b"BL")],
    )

    record = json.loads((root / "inbox" / "email_004.json").read_text(encoding="utf-8"))
    assert record["attachments"] == [
        "attachments/email_004_SI.txt",
        "attachments/email_004_BL.txt",
    ]
    assert (root / "attachments" / "email_004_SI.txt").read_bytes() == b"SI"


def test_create_app_returns_fastapi_application(tmp_path) -> None:
    application = create_app(tmp_path)
    assert any(route.path == "/verify" for route in application.routes)
    assert any(route.path == "/reviews/{email_id}" for route in application.routes)