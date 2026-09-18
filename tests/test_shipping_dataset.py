from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from agents.shipping import DatasetAdapter, build_text_baseline


def make_dataset(tmp_path):
    root = tmp_path / "data_v2"
    (root / "inbox").mkdir(parents=True)
    (root / "attachments").mkdir()
    attachment = root / "attachments" / "email_001_SI.txt"
    attachment.write_text("SHIPPING INSTRUCTION", encoding="utf-8")
    (root / "inbox" / "email_001.json").write_text(
        json.dumps(
            {
                "email_id": "email_001",
                "from": "docs@example.com",
                "subject": "Check documents",
                "body": "Please compare the documents.",
                "attachments": ["attachments/email_001_SI.txt"],
            }
        ),
        encoding="utf-8",
    )
    return root


def test_adapter_loads_email_and_resolves_attachment(tmp_path) -> None:
    adapter = DatasetAdapter(make_dataset(tmp_path))

    email = adapter.get("email_001")

    assert email.email_id == "email_001"
    assert email.attachments == ("attachments/email_001_SI.txt",)
    assert adapter.read_text(email.attachments[0]) == "SHIPPING INSTRUCTION"


def test_adapter_rejects_attachment_path_escape(tmp_path) -> None:
    adapter = DatasetAdapter(make_dataset(tmp_path))

    with pytest.raises(ValueError, match="escapes"):
        adapter.resolve_attachment("attachments/../inbox/email_001.json")


def test_text_baseline_reads_text_and_tracks_binary_references(tmp_path) -> None:
    root = make_dataset(tmp_path)
    (root / "attachments" / "email_001.pdf").write_bytes(b"pdf")
    record = json.loads((root / "inbox" / "email_001.json").read_text(encoding="utf-8"))
    record["attachments"].append("attachments/email_001.pdf")
    (root / "inbox" / "email_001.json").write_text(
        json.dumps(record), encoding="utf-8"
    )

    baseline = build_text_baseline(DatasetAdapter(root))

    assert baseline.text_attachment_count == 1
    assert baseline.attachments[0].email_id == "email_001"
    assert baseline.attachments[0].text == "SHIPPING INSTRUCTION"
    assert baseline.unsupported_references == ("attachments/email_001.pdf",)


def test_http_adapter_reads_emails_and_attachments() -> None:
    email = {
        "email_id": "email_001",
        "from": "docs@example.com",
        "subject": "Update",
        "body": "Body",
        "attachments": ["attachments/email_001_SI.txt"],
    }
    with patch("agents.shipping.dataset.urlopen") as urlopen:
        response = urlopen.return_value.__enter__.return_value
        response.read.return_value = json.dumps(email).encode()
        adapter = DatasetAdapter("http://localhost:8080")
        assert adapter.get("email_001").subject == "Update"
        response.read.return_value = b"SI text"
        assert adapter.read_text("attachments/email_001_SI.txt") == "SI text"