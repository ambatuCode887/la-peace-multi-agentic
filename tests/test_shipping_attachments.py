from __future__ import annotations

import json

from agents.shipping import DatasetAdapter, read_attachment_text


def test_text_attachment_uses_common_reader(tmp_path) -> None:
    root = tmp_path / "data_v2"
    (root / "inbox").mkdir(parents=True)
    (root / "attachments").mkdir()
    (root / "attachments" / "document.txt").write_text("BILL OF LADING", encoding="utf-8")
    (root / "inbox" / "email_001.json").write_text(
        json.dumps({"email_id": "email_001", "attachments": ["attachments/document.txt"]}),
        encoding="utf-8",
    )

    assert read_attachment_text(DatasetAdapter(root), "attachments/document.txt") == "BILL OF LADING"