from __future__ import annotations

import json

from agents.shipping.tool import inspect_shipping_email, run_shipping_verification


def test_run_shipping_verification_writes_submission(tmp_path) -> None:
    root = tmp_path / "data_v2"
    (root / "inbox").mkdir(parents=True)
    (root / "attachments").mkdir()
    (root / "attachments" / "email_001_SI.txt").write_text(
        "SHIPPING INSTRUCTION\nShipper: ACME", encoding="utf-8"
    )
    (root / "inbox" / "email_001.json").write_text(
        json.dumps(
            {
                "email_id": "email_001",
                "from": "docs@example.com",
                "subject": "UPDATE SUMMARY",
                "body": "Operational update.",
                "attachments": ["attachments/email_001_SI.txt"],
            }
        ),
        encoding="utf-8",
    )
    output = tmp_path / "submission.json"

    result = run_shipping_verification(str(root), str(output))

    assert result["ok"] is True
    assert result["email_count"] == 1
    assert json.loads(output.read_text(encoding="utf-8"))["email_001"]["category"] == "GENERAL"


def test_tool_defaults_to_http_dataset(monkeypatch, tmp_path) -> None:
    calls = {}

    def fake_adapter(source):
        calls["source"] = source
        return None

    monkeypatch.setattr("agents.shipping.tool.DatasetAdapter", fake_adapter)
    monkeypatch.setattr(
        "agents.shipping.tool.write_submission",
        lambda adapter, output: {},
    )

    result = run_shipping_verification(output_path=str(tmp_path / "submission.json"))

    assert calls["source"] == "http://localhost:8080"
    assert result["email_count"] == 0


def test_inspect_shipping_email_returns_side_by_side_differences(tmp_path) -> None:
    root = tmp_path / "data_v2"
    (root / "inbox").mkdir(parents=True)
    (root / "attachments").mkdir()
    (root / "attachments" / "email_004_SI.txt").write_text(
        "SHIPPING INSTRUCTION\nShipper: ACME\nConsignee: EAST\nNotify: EAST\n"
        "Port of Loading: SINGAPORE\nPOD: KOBE\nTotal Containers: 1 x 40'HC\n"
        "Gross Weight (KG): 1000 KG",
        encoding="utf-8",
    )
    (root / "attachments" / "email_004_BL.txt").write_text(
        "BILL OF LADING (DRAFT)\nSHIPPER: ACME\nTo the Order of: WEST\n"
        "Notify: WEST\nPort of Loading: SINGAPORE\nPOD: KOBE\n"
        "Container Count: 1 x 40'HC\nGross Weight (KG): 1000 KG",
        encoding="utf-8",
    )
    (root / "inbox" / "email_004.json").write_text(
        json.dumps({
            "email_id": "email_004",
            "subject": "TO CONFIRM DOCS",
            "body": "Please check the SI and draft BL.",
            "attachments": ["attachments/email_004_SI.txt", "attachments/email_004_BL.txt"],
        }),
        encoding="utf-8",
    )

    result = inspect_shipping_email("email_004", str(root))

    assert result["status"] == "MISMATCH"
    assert result["defect_fields"] == ["consignee", "notify_party"]
    assert result["differences"]["consignee"] == {"si": "EAST", "bl": "WEST"}