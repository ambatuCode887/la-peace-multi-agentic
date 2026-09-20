from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

from agents.shipping.api import _save_upload, create_app
from agents.storage import CaseStore


class FakeUpload:
    def __init__(self, filename: str, content: bytes) -> None:
        self.filename = filename
        self.file = SimpleNamespace(read=lambda: content)


class InMemoryCaseStore(CaseStore):
    def __init__(self, *reports: dict) -> None:
        self.reports = {report["email_id"]: report for report in reports}

    def list_cases(self) -> list[dict]:
        return [
            {
                "email_id": report["email_id"],
                "category": report.get("category", "UNKNOWN"),
                "status": report.get("status", "UNPROCESSED"),
                "review_reason": report.get("review_reason"),
                "deletable": False,
                "updated_at": report.get("updated_at"),
            }
            for report in self.reports.values()
        ]

    def list_reports(self) -> list[dict]:
        return list(self.reports.values())

    def get_case(self, email_id: str) -> dict | None:
        return self.reports.get(email_id)

    def save_report(self, report: dict) -> None:
        self.reports[report["email_id"]] = report

    def delete_case(self, email_id: str) -> bool:
        return self.reports.pop(email_id, None) is not None


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
    assert any(route.path == "/cases/{email_id}/manager-review" for route in application.routes)


def test_delete_case_removes_database_record(tmp_path) -> None:
    store = InMemoryCaseStore({
        "email_id": "email_db_only",
        "category": "GENERAL",
        "status": "OK",
    })
    client = TestClient(create_app(tmp_path, case_store=store))

    response = client.delete("/cases/email_db_only")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "email_id": "email_db_only"}
    assert store.get_case("email_db_only") is None
    assert client.delete("/cases/email_db_only").status_code == 404


def test_manager_review_returns_advisory_result_without_changing_report(tmp_path, monkeypatch) -> None:
    root = _save_upload(
        tmp_path,
        "email_manager_001",
        "docs@example.com",
        "Subject",
        "Body",
        [FakeUpload("si.txt", b"SI"), FakeUpload("bl.txt", b"BL")],
    )
    report = {
        "email_id": "email_manager_001",
        "category": "BL_COMPARISON",
        "status": "MISMATCH",
        "defect_fields": ["gross_weight_kg"],
    }
    report_path = root / "report.json"
    report_path.write_text(json.dumps(report), encoding="utf-8")

    async def fake_manager_review(email_id, dataset_root):
        assert email_id == "email_manager_001"
        assert dataset_root == root
        return {"text": "route: human_review"}

    monkeypatch.setattr("agents.shipping.api._run_manager_review", fake_manager_review)
    response = TestClient(create_app(tmp_path)).post(
        "/cases/email_manager_001/manager-review"
    )

    assert response.status_code == 200
    assert response.json()["deterministic_status"] == "MISMATCH"
    assert response.json()["deterministic_defects"] == ["gross_weight_kg"]
    assert response.json()["manager_review"]["text"] == "route: human_review"
    assert json.loads(report_path.read_text(encoding="utf-8")) == report


def test_case_queue_and_review_correction(tmp_path) -> None:
    root = _save_upload(
        tmp_path,
        "email_review_001",
        "docs@example.com",
        "Subject",
        "Body",
        [FakeUpload("si.txt", b"SI"), FakeUpload("bl.txt", b"BL")],
    )
    (root / "report.json").write_text(
        json.dumps({
            "email_id": "email_review_001",
            "category": "BL_COMPARISON",
            "status": "NEEDS_REVIEW",
            "review_reason": "missing_value",
            "documents": {
                "si": {"fields": {"shipper": "A"}},
                "bl": {"fields": {"shipper": "B"}},
            },
        }),
        encoding="utf-8",
    )
    client = TestClient(create_app(tmp_path))
    assert client.get("/cases").json()["cases"][0]["email_id"] == "email_review_001"
    response = client.post(
        "/reviews/email_review_001",
        json={
            "category": "BL_COMPARISON",
            "status": "NEEDS_REVIEW",
            "review_reason": "missing_value",
            "has_defect": False,
            "defect_fields": [],
            "decision": "false_alarm",
            "note": "Confirmed with operations.",
            "si_fields": {"shipper": "A"},
            "bl_fields": {"shipper": "A"},
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["status"] == "OK"


def test_chat_history_must_be_role_content_messages(tmp_path) -> None:
    case_root = tmp_path / "missing"
    (case_root / "inbox").mkdir(parents=True)
    (case_root / "inbox" / "missing.json").write_text("{}", encoding="utf-8")
    (case_root / "report.json").write_text("{}", encoding="utf-8")
    client = TestClient(create_app(tmp_path))
    response = client.post("/chat/missing", json={"message": "Hi", "history": ["bad"]})
    assert response.status_code == 422


def test_process_inbox_materializes_cases_and_reports_failures(tmp_path) -> None:
    data_root = tmp_path / "data_v2"
    (data_root / "inbox").mkdir(parents=True)
    (data_root / "attachments").mkdir()
    (data_root / "inbox" / "email_good.json").write_text(
        json.dumps({
            "email_id": "email_good",
            "from": "ops@example.com",
            "subject": "Operational update",
            "body": "No documents attached.",
            "attachments": [],
        }),
        encoding="utf-8",
    )
    (data_root / "inbox" / "email_bad.json").write_text(
        json.dumps({
            "email_id": "email_bad",
            "from": "ops@example.com",
            "subject": "Operational update",
            "body": "Attachment is missing from the source.",
            "attachments": ["attachments/missing.txt"],
        }),
        encoding="utf-8",
    )

    upload_root = tmp_path / "uploads"
    client = TestClient(create_app(upload_root))
    response = client.post("/inbox/process", json={"data_root": str(data_root)})

    assert response.status_code == 200
    assert response.json()["processed"] == 2
    assert response.json()["failed"] == 1
    assert json.loads((upload_root / "email_good" / "report.json").read_text())["status"] == "OK"
    assert json.loads((upload_root / "email_bad" / "report.json").read_text())["status"] == "UNPROCESSED"
    assert {item["email_id"] for item in client.get("/cases").json()["cases"]} == {"email_good", "email_bad"}


def test_dashboard_exposes_process_inbox_control(tmp_path) -> None:
    client = TestClient(create_app(tmp_path))

    response = client.get("/")

    assert response.status_code == 200
    assert 'id="process-inbox"' in response.text
    assert 'option value="UNPROCESSED"' in response.text
    assert 'option value="MISMATCH"' in response.text
    assert "SI blueprint" in response.text
    assert "ai-summary-grid" in response.text
    assert "Verification evidence" in response.text
    assert "Differences ignored" in response.text
    assert "field-difference" in response.text
    assert "comparison-card.reference .field" not in response.text
    assert 'id="new-verification"' in response.text
    assert "resetVerification" in response.text
    assert 'id="manager-review"' in response.text
    assert "/manager-review" in response.text


def test_uploaded_si_and_bl_are_compared_even_with_an_unrelated_subject(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    si = (
        b"BILL OF LADING INSTRUCTION\nShipper: ACME LTD\nConsignee: BETA CO\nNotify Party: BETA CO\n"
        b"Port of Loading: SHANGHAI, CHINA\nPOD: ROTTERDAM, NETHERLANDS\n"
        b"Total Containers: 2 x 40'HC\nGross Wt (kgs): 40,000 KG\n"
    )
    bl = si.replace(b"BILL OF LADING INSTRUCTION", b"BILL OF LADING (DRAFT)").replace(b"40,000", b"41,000")
    client = TestClient(create_app(tmp_path))

    response = client.post(
        "/verify",
        data={"email_id": "my_upload", "subject": "my files", "body": "here are my two files"},
        files=[
            ("attachments", ("si.txt", si, "text/plain")),
            ("attachments", ("bl.txt", bl, "text/plain")),
        ],
    )

    report = response.json()["report"]
    assert report["category"] == "BL_COMPARISON"
    assert report["status"] == "MISMATCH"
    assert report["defect_fields"] == ["gross_weight_kg"]
    assert report["differences"]["gross_weight_kg"] == {"si": 40000, "bl": 41000}
    assert "available" in report["verifier"]


def test_case_detail_includes_the_email_body_for_new_and_older_reports(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    si = (
        b"BILL OF LADING INSTRUCTION\nShipper: ACME LTD\nConsignee: BETA CO\nNotify Party: BETA CO\n"
        b"Port of Loading: SHANGHAI, CHINA\nPOD: ROTTERDAM, NETHERLANDS\n"
        b"Total Containers: 2 x 40'HC\nGross Wt (kgs): 40,000 KG\n"
    )
    bl = si.replace(b"BILL OF LADING INSTRUCTION", b"BILL OF LADING (DRAFT)")
    client = TestClient(create_app(tmp_path))

    posted = client.post(
        "/verify",
        data={
            "email_id": "with_body",
            "sender": "docs@example.com",
            "subject": "TO CONFIRM DOCS",
            "body": "Please compare the SI and draft BL.\nThanks, Sam",
        },
        files=[
            ("attachments", ("si.txt", si, "text/plain")),
            ("attachments", ("bl.txt", bl, "text/plain")),
        ],
    ).json()["report"]
    assert posted["body"] == "Please compare the SI and draft BL.\nThanks, Sam"
    assert client.get("/cases/with_body").json()["report"]["body"].endswith("Thanks, Sam")

    # A report saved before the body was stored still shows it, read from the saved email.
    report_path = tmp_path / "with_body" / "report.json"
    older = json.loads(report_path.read_text(encoding="utf-8"))
    for key in ("body", "sender", "subject"):
        older.pop(key)
    report_path.write_text(json.dumps(older), encoding="utf-8")

    restored = client.get("/cases/with_body").json()["report"]
    assert restored["body"].startswith("Please compare the SI and draft BL.")
    assert restored["sender"] == "docs@example.com"
    assert restored["subject"] == "TO CONFIRM DOCS"


def test_only_form_created_cases_can_be_deleted(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    txt = (
        b"BILL OF LADING INSTRUCTION\nShipper: ACME LTD\nConsignee: BETA CO\nNotify Party: BETA CO\n"
        b"Port of Loading: SHANGHAI, CHINA\nPOD: ROTTERDAM, NETHERLANDS\n"
        b"Total Containers: 2 x 40'HC\nGross Wt (kgs): 40,000 KG\n"
    )
    client = TestClient(create_app(tmp_path))
    client.post(
        "/verify",
        data={"email_id": "my_test", "subject": "x"},
        files=[("attachments", ("si.txt", txt, "text/plain")), ("attachments", ("bl.txt", txt, "text/plain"))],
    )

    # A case saved from the inbox (Docker) looks like this on disk.
    inbox_case = tmp_path / "email_004"
    (inbox_case / "inbox").mkdir(parents=True)
    (inbox_case / "inbox" / "email_004.json").write_text(json.dumps({"email_id": "email_004"}), encoding="utf-8")
    (inbox_case / "report.json").write_text(json.dumps({"email_id": "email_004", "source": "inbox"}), encoding="utf-8")

    listed = {case["email_id"]: case["deletable"] for case in client.get("/cases").json()["cases"]}
    assert listed == {"my_test": True, "email_004": False}

    assert client.delete("/cases/email_004").status_code == 403
    assert inbox_case.is_dir()
    assert client.delete("/cases/nope").status_code == 404
    assert client.delete("/cases/..%2Fescape").status_code in {404, 405, 422}

    assert client.delete("/cases/my_test").json() == {"ok": True, "email_id": "my_test"}
    assert not (tmp_path / "my_test").exists()
    assert [case["email_id"] for case in client.get("/cases").json()["cases"]] == ["email_004"]


def test_delete_copes_with_read_only_files_and_repeat_requests(tmp_path, monkeypatch) -> None:
    import os
    import stat

    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    txt = (
        b"BILL OF LADING INSTRUCTION\nShipper: ACME LTD\nConsignee: BETA CO\nNotify Party: BETA CO\n"
        b"Port of Loading: SHANGHAI, CHINA\nPOD: ROTTERDAM, NETHERLANDS\n"
        b"Total Containers: 2 x 40'HC\nGross Wt (kgs): 40,000 KG\n"
    )
    client = TestClient(create_app(tmp_path))
    client.post(
        "/verify",
        data={"email_id": "locked_case", "subject": "x"},
        files=[("attachments", ("si.txt", txt, "text/plain")), ("attachments", ("bl.txt", txt, "text/plain"))],
    )
    # Windows refuses to delete read-only files; the delete must still succeed.
    os.chmod(tmp_path / "locked_case" / "attachments" / "si.txt", stat.S_IREAD)

    assert client.delete("/cases/locked_case").status_code == 200
    assert not (tmp_path / "locked_case").exists()
    # A repeated request (double click) finds nothing and reports it cleanly.
    assert client.delete("/cases/locked_case").status_code == 404


def test_bulk_processing_skips_the_slow_ai_verifier_and_runs_it_once_on_open(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    calls: list[str] = []

    def fake_verifier(report):
        calls.append(report["email_id"])
        return {"available": True, "rulings": []}

    monkeypatch.setattr("agents.shipping.api.verify_shipping_discrepancies", fake_verifier)

    data = tmp_path / "data"
    (data / "inbox").mkdir(parents=True)
    (data / "attachments").mkdir()
    si = (
        b"BILL OF LADING INSTRUCTION\nShipper: ACME LTD\nConsignee: BETA CO\nNotify Party: BETA CO\n"
        b"Port of Loading: SHANGHAI, CHINA\nPOD: ROTTERDAM, NETHERLANDS\n"
        b"Total Containers: 2 x 40'HC\nGross Wt (kgs): 40,000 KG\n"
    )
    (data / "attachments" / "email_100_SI.txt").write_bytes(si)
    (data / "attachments" / "email_100_BL.txt").write_bytes(
        si.replace(b"BILL OF LADING INSTRUCTION", b"BILL OF LADING (DRAFT)").replace(b"40,000", b"41,000")
    )
    (data / "inbox" / "email_100.json").write_text(json.dumps({
        "email_id": "email_100", "from": "docs@example.com", "subject": "TO CONFIRM DOCS",
        "body": "Please compare the SI and draft BL.",
        "attachments": ["attachments/email_100_SI.txt", "attachments/email_100_BL.txt"],
    }), encoding="utf-8")

    client = TestClient(create_app(tmp_path / "cases"))
    processed = client.post("/inbox/process", json={"data_root": str(data)}).json()
    assert processed["processed"] == 1 and processed["failed"] == 0
    assert calls == []  # bulk processing never waits on the AI

    first = client.get("/cases/email_100").json()["report"]
    assert first["status"] == "MISMATCH"
    assert first["verifier"] == {"available": True, "rulings": []}
    assert calls == ["email_100"]

    client.get("/cases/email_100")
    assert calls == ["email_100"]  # already saved, not asked again
