from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from agents.shipping import api as shipping_api

from agents.shipping.api import _run_manager_review, _save_upload, create_app
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


def test_case_list_returns_more_than_100_cases_in_one_response(tmp_path) -> None:
    for index in range(125):
        case_id = f"email_{index:03d}"
        case_root = tmp_path / case_id
        case_root.mkdir()
        (case_root / "report.json").write_text(json.dumps({
            "email_id": case_id,
            "category": "BL_COMPARISON",
            "status": "OK",
        }), encoding="utf-8")
    client = TestClient(create_app(tmp_path))

    response = client.get("/cases", params={"page_size": 1000})

    assert response.status_code == 200
    assert len(response.json()["cases"]) == 125
    assert response.json()["has_more"] is False


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
                "supporting_evidence": "Operations email confirms the approved carrier alias.",
            "si_fields": {"shipper": "A"},
            "bl_fields": {"shipper": "A"},
        },
    )
    assert response.status_code == 200
    assert response.json()["result"]["status"] == "NEEDS_REVIEW"
    assert response.json()["result"]["override_status"] == "operator_override_not_verified"


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


def test_mailpit_sync_imports_new_message(tmp_path, monkeypatch) -> None:
    class FakeResponse:
        def __init__(self, payload: dict, content: bytes = b"") -> None:
            self.payload = payload
            self.content = content

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self.payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url: str, **kwargs):
            if url.endswith("/messages"):
                return FakeResponse({"messages": [{"ID": "mailpit-message-1"}]})
            if url.endswith("/part/2"):
                return FakeResponse({}, b"attached document")
            return FakeResponse({
                "ID": "mailpit-message-1",
                "From": {"Address": "demo@example.com"},
                "Subject": "Mailpit test",
                "Text": "This message came from Mailpit.",
                "Attachments": [{"PartID": "2", "FileName": "document.txt"}],
            })

    monkeypatch.setattr(shipping_api.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    client = TestClient(create_app(tmp_path))

    response = client.post("/inbox/mailpit/sync")

    assert response.status_code == 200
    assert response.json()["imported"] == 1
    assert client.get("/cases").json()["cases"][0]["category"] != "UNPROCESSED"
    attachment = next(tmp_path.rglob("document.txt"))
    assert attachment.read_bytes() == b"attached document"
    assert client.post("/inbox/mailpit/sync").json()["imported"] == 0


def test_mailpit_summaries_fetches_all_pages() -> None:
    messages = [{"ID": f"message-{index}"} for index in range(123)]

    class FakeResponse:
        def __init__(self, payload: dict) -> None:
            self.payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self.payload

    class FakeClient:
        def __init__(self) -> None:
            self.offsets = []

        async def get(self, url: str, *, params: dict):
            self.offsets.append(params["start"])
            start = params["start"]
            limit = params["limit"]
            return FakeResponse({
                "messages": messages[start : start + limit],
                "total": len(messages),
            })

    fake_client = FakeClient()

    summaries = asyncio.run(
        shipping_api._mailpit_summaries(fake_client, "http://mailpit")
    )

    assert len(summaries) == 123
    assert fake_client.offsets == [0, 50, 100]


def test_mailpit_sync_imports_all_pages_and_is_idempotent(tmp_path, monkeypatch) -> None:
    messages = [{"ID": f"batch-message-{index:03d}"} for index in range(51)]
    offsets = []

    class FakeResponse:
        def __init__(self, payload: dict, content: bytes = b"") -> None:
            self.payload = payload
            self.content = content

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self.payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url: str, **kwargs):
            if url.endswith("/messages"):
                start = kwargs["params"]["start"]
                limit = kwargs["params"]["limit"]
                offsets.append(start)
                return FakeResponse({
                    "messages": messages[start : start + limit],
                    "total": len(messages),
                })
            if url.endswith("/part/2"):
                message_id = url.split("/message/")[1].split("/part/")[0]
                return FakeResponse({}, f"attachment for {message_id}".encode())
            message_id = url.rsplit("/", 1)[-1]
            return FakeResponse({
                "ID": message_id,
                "From": {"Address": "demo@example.com"},
                "Subject": f"General test {message_id}",
                "Text": "Batch import test.",
                "Attachments": [{"PartID": "2", "FileName": f"{message_id}.txt"}],
            })

    monkeypatch.setattr(shipping_api.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    client = TestClient(create_app(tmp_path))

    first_sync = client.post("/inbox/mailpit/sync")

    assert first_sync.status_code == 200
    assert first_sync.json()["imported"] == 51
    assert offsets == [0, 50]
    assert len(client.get("/cases", params={"page_size": 100}).json()["cases"]) == 51
    saved_attachment = next(tmp_path.rglob("batch-message-000.txt"))
    assert saved_attachment.read_bytes() == b"attachment for batch-message-000"

    second_sync = client.post("/inbox/mailpit/sync")

    assert second_sync.status_code == 200
    assert second_sync.json()["imported"] == 0
    assert offsets == [0, 50, 0, 50]
    assert len(client.get("/cases", params={"page_size": 100}).json()["cases"]) == 51


def test_mailpit_sync_renames_existing_case_from_attachment_index(tmp_path, monkeypatch) -> None:
    message_id = "mailpit-message-600"
    old_id = f"mailpit_{hashlib.sha256(message_id.encode()).hexdigest()[:24]}"
    old_root = tmp_path / old_id
    (old_root / "attachments").mkdir(parents=True)
    (old_root / "inbox").mkdir()
    (old_root / "attachments" / "email_600_SI.txt").write_text("SI", encoding="utf-8")
    (old_root / "attachments" / "email_600_BL.txt").write_text("BL", encoding="utf-8")
    (old_root / "inbox" / f"{old_id}.json").write_text(json.dumps({
        "email_id": old_id,
        "mailpit_id": message_id,
        "attachments": ["attachments/email_600_SI.txt", "attachments/email_600_BL.txt"],
    }), encoding="utf-8")
    (old_root / "report.json").write_text(json.dumps({
        "email_id": old_id,
        "mailpit_id": message_id,
        "category": "OK",
        "status": "OK",
        "attachments": ["attachments/email_600_SI.txt", "attachments/email_600_BL.txt"],
    }), encoding="utf-8")

    class FakeResponse:
        def __init__(self, payload: dict) -> None:
            self.payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self.payload

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url: str, **kwargs):
            if url.endswith("/messages"):
                return FakeResponse({"messages": [{"ID": message_id}]})
            return FakeResponse({
                "ID": message_id,
                "From": {"Address": "demo@example.com"},
                "Subject": "Mailpit test",
                "Text": "Existing imported message.",
                "Attachments": [
                    {"PartID": "2", "FileName": "email_600_SI.txt"},
                    {"PartID": "3", "FileName": "email_600_BL.txt"},
                ],
            })

    monkeypatch.setattr(shipping_api.httpx, "AsyncClient", lambda **kwargs: FakeClient())
    client = TestClient(create_app(tmp_path))

    response = client.post("/inbox/mailpit/sync")

    assert response.status_code == 200
    assert response.json()["imported"] == 0
    cases = client.get("/cases").json()["cases"]
    assert [case["email_id"] for case in cases] == ["email_600"]
    assert not old_root.exists()
    assert (tmp_path / "email_600" / "attachments" / "email_600_SI.txt").read_text(encoding="utf-8") == "SI"


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


def test_manager_review_citations_come_from_retrieval_and_are_deduplicated(tmp_path, monkeypatch) -> None:
    case_root = tmp_path / "email_cite_001"
    case_root.mkdir()
    (case_root / "report.json").write_text(
        json.dumps({"status": "MISMATCH", "defect_fields": ["container_count"]}), encoding="utf-8"
    )
    chunk = {
        "text": "### Container count mismatch\nDifferent container quantities need review.",
        "source": r"C:\Users\someone\knowledge\data.md",
        "chunk_index": 3,
        "score": 0.8123,
    }
    # The same chunk stored twice, as happens when a file is ingested from two machines.
    monkeypatch.setattr(
        "agents.shipping.api.retrieve_knowledge",
        lambda query, limit=5: {"results": [chunk, dict(chunk)]},
    )

    review = asyncio.run(_run_manager_review("email_cite_001", case_root))

    assert len(review["citations"]) == 1
    assert review["citations"][0]["source"] == "data.md"
    assert review["citations"][0]["chunk_index"] == 3
    assert review["citations"][0]["relevance"] == 0.812
    assert review["retrieved_guidance"] == [review["citations"][0]["excerpt"]]
    # Built-in rule text is reported separately and is never presented as retrieved.
    assert len(review["field_guidance"]) == 1
    assert review["field_guidance"][0] not in review["retrieved_guidance"]


def test_manager_review_reports_no_citations_when_retrieval_is_empty(tmp_path, monkeypatch) -> None:
    case_root = tmp_path / "email_cite_002"
    case_root.mkdir()
    (case_root / "report.json").write_text(
        json.dumps({"status": "NEEDS_REVIEW", "review_reason": "ambiguous_field"}), encoding="utf-8"
    )
    monkeypatch.setattr("agents.shipping.api.retrieve_knowledge", lambda query, limit=5: {"results": []})

    review = asyncio.run(_run_manager_review("email_cite_002", case_root))

    assert review["retrieved_guidance"] == []
    assert review["citations"] == []
    assert review["field_guidance"] == []


_KNOWLEDGE_CHUNK = {
    "text": (
        "tail of a section cut off at the previous chunk boundary, mentioning port and container.\n\n"
        "### Port mismatch\nCompare the named port and UN/LOCODE for the port of loading and port of discharge.\n\n"
        "### Gross-weight mismatch\nNormalize both gross weights to kilograms and compare the normalized values.\n\n"
        "### Shipper, consignee, or party mismatch\nCompare the complete legal entity name, address, and country.\n\n"
        "### Container count mismatch\nCompare the number of containers and package descriptions on the SI and BL."
    ),
    "source": "data.md",
    "chunk_index": 2,
    "score": 0.75,
}


def _review(tmp_path, monkeypatch, report: dict, results=None):
    case_root = tmp_path / "email_gate"
    case_root.mkdir(exist_ok=True)
    (case_root / "report.json").write_text(json.dumps(report), encoding="utf-8")
    monkeypatch.setattr(
        "agents.shipping.api.retrieve_knowledge",
        lambda query, limit=5: {"results": [_KNOWLEDGE_CHUNK] if results is None else results},
    )
    return asyncio.run(_run_manager_review("email_gate", case_root))


@pytest.mark.parametrize(
    "report",
    [
        {"status": "OK", "category": "BL_COMPARISON"},
        {"status": "OK", "category": "SI_REQUEST"},
        {"status": "MISMATCH", "category": "INVOICE_QUERY", "defect_fields": ["container_count"]},
        {"status": "NEEDS_REVIEW", "category": "SPAM", "review_reason": "missing_value"},
        {"status": "NEEDS_REVIEW", "category": "BL_COMPARISON", "review_reason": None},
    ],
)
def test_manager_review_skips_citations_when_they_add_nothing(tmp_path, monkeypatch, report) -> None:
    def fail(*_args, **_kwargs):
        raise AssertionError("retrieval must not run for a case that gets no citations")

    monkeypatch.setattr("agents.shipping.api.retrieve_knowledge", fail)
    case_root = tmp_path / "email_gate"
    case_root.mkdir()
    (case_root / "report.json").write_text(json.dumps(report), encoding="utf-8")

    review = asyncio.run(_run_manager_review("email_gate", case_root))

    assert review["guidance_applicable"] is False
    assert review["guidance_note"]
    assert review["citations"] == []
    assert review["retrieved_guidance"] == []


def test_manager_review_cites_only_the_section_for_the_mismatched_field(tmp_path, monkeypatch) -> None:
    review = _review(
        tmp_path, monkeypatch,
        {"status": "MISMATCH", "category": "BL_COMPARISON", "defect_fields": ["port_of_discharge"]},
    )

    assert review["guidance_applicable"] is True
    assert len(review["citations"]) == 1
    assert review["citations"][0]["excerpt"].startswith("Port mismatch")
    # Neither another field's section nor the headless fragment is cited.
    assert "Gross-weight" not in review["citations"][0]["excerpt"]
    assert not review["citations"][0]["excerpt"].startswith("tail of")


def test_manager_review_for_ambiguity_cites_the_ambiguous_field_first(tmp_path, monkeypatch) -> None:
    review = _review(
        tmp_path, monkeypatch,
        {
            "status": "NEEDS_REVIEW",
            "category": "BL_COMPARISON",
            "review_reason": "ambiguous_field",
            "defect_fields": ["container_count"],
            "routing_telemetry": {"ambiguous_fields": ["shipper"]},
        },
    )

    assert review["citations"][0]["excerpt"].startswith("Shipper, consignee, or party mismatch")


def test_manager_review_reports_applicable_but_empty_when_nothing_matches(tmp_path, monkeypatch) -> None:
    unrelated = {"text": "### Weather\nIt is sunny today and the sea is calm across every route.", "source": "data.md"}
    review = _review(
        tmp_path, monkeypatch,
        {"status": "MISMATCH", "category": "BL_COMPARISON", "defect_fields": ["container_count"]},
        results=[unrelated],
    )

    assert review["guidance_applicable"] is True
    assert review["citations"] == []


_ROUTING_CHUNK = {
    "text": (
        "### Compared fields\n\nA missing, unreadable, or low-confidence value should be routed to human review.\n\n"
        "### Review routing\n\n"
        "- Automatic match: all required fields are present, readable, and deterministically equivalent.\n"
        "- Human review: any required field is missing, unreadable, low-confidence, or deterministically mismatched.\n"
        "- Clarification needed: the documents conflict and the correct value cannot be established from the supplied evidence.\n\n"
        "For a shipper mismatch, compare the full legal name and address on both documents.\n\n"
        "### Container count mismatch\n\nCompare the number of containers and package descriptions on the SI and BL."
    ),
    "source": "data.md",
    "chunk_index": 1,
    "score": 0.7,
}


@pytest.mark.parametrize("reason", ["missing_value", "missing_attachment", "wrong_doc_type"])
def test_manager_review_cites_the_routing_rule_for_missing_or_wrong_documents(tmp_path, monkeypatch, reason) -> None:
    review = _review(
        tmp_path, monkeypatch,
        {"status": "NEEDS_REVIEW", "category": "BL_COMPARISON", "review_reason": reason},
        results=[_ROUTING_CHUNK],
    )

    assert review["guidance_applicable"] is True
    assert review["citations"], "a missing or wrong document must cite the routing rule"
    excerpts = [citation["excerpt"] for citation in review["citations"]]
    assert any(excerpt.startswith("Review routing") for excerpt in excerpts)
    # The unrelated shipper paragraph and the container section are not dragged in.
    assert not any("shipper mismatch" in excerpt for excerpt in excerpts)
    assert not any("Container count" in excerpt for excerpt in excerpts)
