from __future__ import annotations

import json

from fastapi.testclient import TestClient

from agents.shipping.api import _save_upload, create_app
from agents.shipping.actions import preview_rule_correction, preview_targeted_reread


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


def test_rule_correction_requires_both_sources_to_support_same_value() -> None:
    extraction_error = {
        "email_id": "email_rule_fixed",
        "defect_fields": ["shipper"],
        "documents": {
            "si": {
                "fields": {"shipper": "APRIL FINE PAPER TRADING X"},
                "evidence_details": {
                    "shipper": {"source_text": "Shipper: APRIL FINE PAPER TRADING"},
                },
            },
            "bl": {
                "fields": {"shipper": "APRIL FINE PAPER TRADING"},
                "evidence_details": {
                    "shipper": {"source_text": "Shipper: APRIL FINE PAPER TRADING"},
                },
            },
        },
    }
    true_mismatch = {
        **extraction_error,
        "documents": {
            "si": {
                "fields": {"shipper": "APRIL FINE PAPER TRADING"},
                "evidence_details": {
                    "shipper": {"source_text": "Shipper: APRIL FINE PAPER TRADING"},
                },
            },
            "bl": {
                "fields": {"shipper": "OTHER PAPER COMPANY"},
                "evidence_details": {
                    "shipper": {"source_text": "Shipper: OTHER PAPER COMPANY"},
                },
            },
        },
    }

    proposed = preview_rule_correction(extraction_error)
    unresolved = preview_rule_correction(true_mismatch)

    assert proposed["ready"] is True
    assert proposed["si_fields"]["shipper"] == "APRIL FINE PAPER TRADING"
    assert proposed["changes"][0]["document"] == "si"
    assert proposed["source_evidence"]["shipper"]["si"] == "Shipper: APRIL FINE PAPER TRADING"
    assert unresolved["ready"] is False
    assert unresolved["changes"] == []
    assert unresolved["unresolved_fields"] == ["shipper"]


def test_batch_rule_preview_is_read_only_and_marks_ambiguous_cases(tmp_path) -> None:
    reports = [
        {
            "email_id": "email_rule_fixed",
            "category": "BL_COMPARISON",
            "status": "MISMATCH",
            "defect_fields": ["shipper"],
            "documents": {
                "si": {
                    "fields": {"shipper": "APRIL FINE PAPER TRADING X"},
                    "evidence_details": {
                        "shipper": {"source_text": "Shipper: APRIL FINE PAPER TRADING"},
                    },
                },
                "bl": {
                    "fields": {"shipper": "APRIL FINE PAPER TRADING"},
                    "evidence_details": {
                        "shipper": {"source_text": "Shipper: APRIL FINE PAPER TRADING"},
                    },
                },
            },
        },
        {
            "email_id": "email_rule_review",
            "category": "BL_COMPARISON",
            "status": "MISMATCH",
            "defect_fields": ["shipper"],
            "documents": {
                "si": {
                    "fields": {"shipper": "APRIL FINE PAPER TRADING"},
                    "evidence_details": {
                        "shipper": {"source_text": "Shipper: APRIL FINE PAPER TRADING"},
                    },
                },
                "bl": {
                    "fields": {"shipper": "OTHER PAPER COMPANY"},
                    "evidence_details": {
                        "shipper": {"source_text": "Shipper: OTHER PAPER COMPANY"},
                    },
                },
            },
        },
    ]
    for report in reports:
        case_root = tmp_path / report["email_id"]
        case_root.mkdir()
        (case_root / "report.json").write_text(json.dumps(report), encoding="utf-8")
    client = TestClient(create_app(tmp_path))

    response = client.post("/reviews/batch-rule-corrections/preview")

    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 2
    assert payload["ready"] == 1
    by_email_id = {item["email_id"]: item for item in payload["results"]}
    assert by_email_id["email_rule_fixed"]["ready"] is True
    assert by_email_id["email_rule_review"]["unresolved_fields"] == ["shipper"]
    for report in reports:
        stored = json.loads((tmp_path / report["email_id"] / "report.json").read_text())
        assert stored == report




