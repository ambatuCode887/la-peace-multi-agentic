from __future__ import annotations

import json

from fastapi.testclient import TestClient

from agents.shipping.api import _save_upload, create_app
from agents.shipping.actions import preview_targeted_reread


class FakeUpload:
    def __init__(self, filename: str, content: bytes) -> None:
        from types import SimpleNamespace

        self.filename = filename
        self.file = SimpleNamespace(read=lambda: content)


def test_targeted_reread_rejects_unknown_field() -> None:
    try:
        preview_targeted_reread({}, "unknown")
    except ValueError as error:
        assert "Unsupported comparison field" in str(error)
    else:
        raise AssertionError("Unknown fields must be rejected")


def test_action_previews_are_proposal_only(tmp_path) -> None:
    root = _save_upload(
        tmp_path,
        "email_action_001",
        "docs@example.com",
        "Subject",
        "Body",
        [FakeUpload("si.txt", b"SI"), FakeUpload("bl.txt", b"BL")],
    )
    report = {
        "email_id": "email_action_001",
        "sender": "docs@example.com",
        "status": "MISMATCH",
        "defect_fields": ["container_count"],
        "documents": {
            "si": {"fields": {"container_count": 3}},
            "bl": {"fields": {"container_count": 5}},
        },
    }
    (root / "report.json").write_text(json.dumps(report), encoding="utf-8")
    client = TestClient(create_app(tmp_path))

    response = client.post(
        "/cases/email_action_001/action-preview",
        json={"action": "draft_correction_email", "requested_correction": "Confirm the correct count."},
    )

    assert response.status_code == 200
    preview = response.json()["preview"]
    assert preview["requires_confirmation"] is True
    assert preview["sent"] is False
    assert "container_count" in preview["body"]
    assert json.loads((root / "report.json").read_text()) == report




