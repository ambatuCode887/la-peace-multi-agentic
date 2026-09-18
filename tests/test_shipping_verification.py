from __future__ import annotations

from agents.shipping import (
    DatasetAdapter,
    DatasetEmail,
    classify_email,
    compare_shipments,
    extract_shipment_fields,
)


def email(subject: str, body: str = "") -> DatasetEmail:
    return DatasetEmail("email_001", "sender@example.com", subject, body, (), {})


def test_classifies_one_example_from_each_category() -> None:
    assert classify_email(email("TO CONFIRM DOCS _ draft BL")) == "BL_COMPARISON"
    assert classify_email(email("REQUEST SI _ 5ABC-12345")) == "SI_REQUEST"
    assert classify_email(email("REQUEST TO CANCEL INVOICE")) == "INVOICE_QUERY"
    assert classify_email(email("UPDATE SUMMARY - vessel report")) == "GENERAL"
    assert classify_email(email("Congratulations! You have WON a prize")) == "SPAM"
    assert classify_email(email("URGENT: Your email storage is full")) == "SPAM"
    assert classify_email(email("Re: Invoice payment", "Please confirm your bank details")) == "SPAM"


def test_extracts_and_compares_known_si_bl_values() -> None:
    si = extract_shipment_fields(
        """SHIPPING INSTRUCTION
Shipper: APRIL FAR EAST (M) SDN BHD
Consignee (Non-Negotiable): EAST BRIGHT FZ-LLC
Notify: EAST BRIGHT FZ-LLC
Port of Loading (POL): NANTONG, CHINA (CNNTG)
POD: KARACHI, PAKISTAN (PKKHI)
Total Containers: 6 x 40'HC
Gross Wt (kgs): 131,058 KG
"""
    )
    bl = extract_shipment_fields(
        """BILL OF LADING (DRAFT)
SHIPPER: APRIL FAR EAST (M) SDN BHD
To the Order of: UAB NOVAKOPA
Notify Party: UAB NOVAKOPA
Port of Loading (POL): NANTONG, CHINA (CNNTG)
POD: KARACHI, PAKISTAN (PKKHI)
Container Count: 6 x 40'HC
Gross Weight (KG): 131,058 KG
"""
    )

    result = compare_shipments(si, bl)

    assert result["status"] == "MISMATCH"
    assert result["defect_fields"] == ["consignee", "notify_party"]
    assert si.fields["container_count"] == 6
    assert si.fields["gross_weight_kg"] == 131058


def test_extracts_pipe_separated_workbook_rows() -> None:
    document = extract_shipment_fields(
        """BL INSTRUCTION | 3154303911
SHIPPER | PAPER COMPANY
CONSIGNEE | BUYER COMPANY
NOTIFY PARTY | BUYER COMPANY
Load Port | SINGAPORE
POD | KOPER, SLOVENIA
No. of Containers or Packages | 15 x 20'GP
Gross Weight (KG) | 341715
"""
    )

    assert document.document_type == "SI"
    assert document.missing_fields == ()
    assert document.fields["container_count"] == 15
    assert document.fields["gross_weight_kg"] == 341715


def test_extracts_multilingual_table_labels() -> None:
    document = extract_shipment_fields(
        """BILL OF LADING (DRAFT)
SHIPPER (发货人) | PAPER COMPANY
To the Order of (收货人) | BUYER COMPANY
Notify Party (通知人) | NOTIFY COMPANY
Total Containers (箱数) | 3 x 40'HC
Gross Weight毛重(KGS) (毛重 KGS) | 66000
"""
    )

    assert document.missing_fields == (
        "port_of_loading",
        "port_of_discharge",
    )
    assert document.fields["shipper"] == "PAPER COMPANY"
    assert document.fields["consignee"] == "BUYER COMPANY"
    assert document.fields["notify_party"] == "NOTIFY COMPANY"
    assert document.fields["container_count"] == 3
    assert document.fields["gross_weight_kg"] == 66000


def test_extracts_next_line_pdf_labels() -> None:
    document = extract_shipment_fields(
        """BILL OF LADING INSTRUCTION
Shipper/Exporter
PAPER COMPANY
To the Order of
BUYER COMPANY
NOTIFY PARTY
NOTIFY COMPANY
Load Port
SINGAPORE
Port of Discharge
KARACHI, PAKISTAN
Total Containers: 5 x 40'HC
TOTAL GROSS WEIGHT: 118,270 KG
"""
    )

    assert document.document_type == "SI"
    assert document.missing_fields == ()
    assert document.fields["shipper"] == "PAPER COMPANY"
    assert document.fields["gross_weight_kg"] == 118270


def test_blank_inline_value_does_not_consume_next_label() -> None:
    document = extract_shipment_fields(
        """SHIPPING INSTRUCTION
SHIPPER:
CONSIGNEE: BUYER COMPANY
NOTIFY PARTY: NOTIFY COMPANY
PORT OF LOADING: SINGAPORE
Discharge Port: BUSAN, SOUTH KOREA
No. of Containers:
Gross Weight (KG): 70000 KG
"""
    )

    assert "shipper" in document.missing_fields
    assert "container_count" in document.missing_fields
    assert document.fields["shipper"] is None
    assert document.fields["container_count"] is None


def test_review_result_contains_structured_evidence(tmp_path) -> None:
    root = tmp_path / "data_v2"
    (root / "inbox").mkdir(parents=True)
    (root / "attachments").mkdir()
    (root / "attachments" / "email_501_SI.txt").write_text(
        "SHIPPING INSTRUCTION\nSHIPPER: ACME", encoding="utf-8"
    )
    (root / "attachments" / "email_501_BL.txt").write_text(
        "COMMERCIAL INVOICE\nSeller: ACME", encoding="utf-8"
    )
    (root / "inbox" / "email_501.json").write_text(
        __import__("json").dumps(
            {
                "email_id": "email_501",
                "subject": "TO CONFIRM DOCS",
                "body": "Please check the attached documents.",
                "attachments": [
                    "attachments/email_501_SI.txt",
                    "attachments/email_501_BL.txt",
                ],
            }
        ),
        encoding="utf-8",
    )

    from agents.shipping.verification import build_submission

    result = build_submission(DatasetAdapter(root))["email_501"]

    assert result["status"] == "NEEDS_REVIEW"
    assert result["review_reason"] == "wrong_doc_type"
    assert result["review_context"]["email_id"] == "email_501"
    assert result["review_context"]["documents"][1]["document_type"] == "OTHER"