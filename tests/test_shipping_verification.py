from __future__ import annotations

from agents.shipping import (
    DatasetAdapter,
    DatasetEmail,
    classify_email,
    compare_shipments,
    extract_shipment_fields,
)
from agents.shipping.verification import classify_email_details


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


def test_generic_subject_with_si_bl_attachments_is_comparison() -> None:
    uploaded = DatasetEmail(
        "image_pdf_test",
        "sender@example.com",
        "test",
        "",
        ("attachments/email_512_SI.pdf", "attachments/email_512_BL.pdf"),
        {},
    )

    assert classify_email(uploaded) == "BL_COMPARISON"
    assert classify_email_details(uploaded)["confidence"] == "high"


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


def test_dummy_si_bl_reports_only_container_mismatch() -> None:
    si = extract_shipment_fields(
        """SHIPPING INSTRUCTION
Shipper: ACME
Consignee: BUYER
Notify Party: BUYER
Port of Loading: SINGAPORE
Port of Discharge: KOBE
Container Count: 3
Gross Weight (KG): 22000
"""
    )
    bl = extract_shipment_fields(
        """BILL OF LADING
Shipper: ACME
Consignee: BUYER
Notify Party: BUYER
Port of Loading: SINGAPORE
Port of Discharge: KOBE
Container Count: 4
Gross Weight (KG): 22000
"""
    )

    result = compare_shipments(si, bl)

    assert result["status"] == "MISMATCH"
    assert result["defect_fields"] == ["container_count"]
    assert result["ignored_differences"] == []


def test_normalizes_weight_units_labels_case_and_punctuation() -> None:
    si = extract_shipment_fields(
        """SHIPPING INSTRUCTION
Shipper: ACME, LTD.
Consignee: BUYER
Notify Party: BUYER
Load Port: SINGAPORE
Port of Discharge: KOBE
Container Count: 3
Gross Weight: 22,000 KG
"""
    )
    bl = extract_shipment_fields(
        """BILL OF LADING
Shipper: acme ltd
Consignee: BUYER
Notify Party: BUYER
Port of Loading: SINGAPORE
Port of Discharge: KOBE
Container Count: 3
Gross Weight: 22 MT
"""
    )

    result = compare_shipments(si, bl)

    assert result["status"] == "OK"
    assert result["defect_fields"] == []
    assert result["ignored_differences"] == [
        {"field": "shipper", "reason": "formatting_case_or_punctuation"},
        {"field": "port_of_loading", "reason": "equivalent_label"},
        {
            "field": "gross_weight_kg",
            "reason": "unit_conversion",
            "si_normalized_kg": 22000,
            "bl_normalized_kg": 22000,
        },
    ]


def test_ocr_corruption_does_not_hide_shipper_mismatch() -> None:
    si = extract_shipment_fields(
        """SHIPPING INSTRUCTION
Shipper: APRIL FAR EAST (M) SDN BHD
    Consignee: BUYER
    Notify Party: BUYER
    Port of Loading: ORIGIN
    Port of Discharge: DESTINATION
    Containers: 1 x 40HC
Gross Weight 128,544 KG
"""
    )
    bl = extract_shipment_fields(
        """BILL OF LADING (DRAFT)
Shipper: APRIL FAR EAST (M) SDN SHD
    Consignee: BUYER
    Notify Party: BUYER
    Port of Loading: ORIGIN
    Port of Discharge: DESTINATION
    Containers: 1 x 40HC
Giross Weight 128,544 KG
"""
    )

    result = compare_shipments(si, bl)

    assert result["status"] == "OK"
    assert result["defect_fields"] == []
    assert result["normalized_equivalences"] == ["shipper"]


def test_reader_disagreement_requires_human_review() -> None:
    si = extract_shipment_fields(
        """SHIPPING INSTRUCTION
Shipper: APRIL FAR EAST (M) SDN BHD
Port of Loading: NHAVA SHEVA INDIA
Port of Discharge: TUTICORIN, INDIA
Consignee: BUYER
Notify Party: BUYER
Container Count: 6
Gross Weight: 128544 KG
""",
        alternate_readings={
            "ollama_vision": """SHIPPING INSTRUCTION
Shipper: APRIL FAR EAST (MI) SDN BHD
Port of Loading: NAVA SHEVA INDIA
Port of Discharge: TUTICORIN, INDIA
Consignee: BUYER
Notify Party: BUYER
Container Count: 6
Gross Weight: 128544 KG
""",
        },
    )
    bl = extract_shipment_fields(
        """BILL OF LADING
Shipper: APRIL FAR EAST (M) SDN BHD
Port of Loading: NHAVA SHEVA INDIA
Port of Discharge: TUTICORIN, INDIA
Consignee: BUYER
Notify Party: BUYER
Container Count: 6
Gross Weight: 128544 KG
"""
    )

    result = compare_shipments(si, bl)

    assert si.reader_fields["ollama_vision"]["shipper"] == "APRIL FAR EAST (MI) SDN BHD"
    assert si.reader_agreement["shipper"] == "disagree"
    assert si.confidence["port_of_loading"] == "low"
    assert result["status"] == "NEEDS_REVIEW"
    assert result["review_reason"] == "low_confidence"
    assert result["uncertain_fields"] == ["port_of_loading", "shipper"]


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

PDF_STYLE_SI = """BILL OF LADING INSTRUCTION
Shipper/Exporter
APRIL FINE PAPER TRADING (MIDDLE EAST) FZE
#813, 4 EA, DUBAI AIRPORT FREE ZONE
P.O. BOX: 293775, DUBAI, UNITED ARAB EMIRATES
CONSIGNEE
TOPKOPY MIDDLE EAST FZE
P.O. BOX 17436
JEBEL ALI FREE ZONE, DUBAI, UAE
NOTIFY PARTY
TOPKOPY MIDDLE EAST FZE
P.O. BOX 17436
JEBEL ALI FREE ZONE, DUBAI, UAE
Port of Loading (POL)
PORT KLANG (WESTPORT), MALAYSIA
POD
HOCHIMINH CITY, VIETNAM
Vessel
SOLID 16 V.044NW2
No. of Containers: 2 x 40'HC
TOTAL Gross Wt (kgs): 40,326 KG
"""


def test_party_fields_keep_the_full_name_and_address_block() -> None:
    si = extract_shipment_fields(PDF_STYLE_SI)

    assert si.fields["shipper"] == (
        "APRIL FINE PAPER TRADING (MIDDLE EAST) FZE\n"
        "#813, 4 EA, DUBAI AIRPORT FREE ZONE\n"
        "P.O. BOX: 293775, DUBAI, UNITED ARAB EMIRATES"
    )
    # The block must stop at the next label instead of swallowing the ports.
    assert si.fields["consignee"].splitlines()[-1] == "JEBEL ALI FREE ZONE, DUBAI, UAE"
    assert si.fields["port_of_loading"] == "PORT KLANG (WESTPORT), MALAYSIA"


def test_standalone_notify_party_label_is_not_read_as_the_value() -> None:
    si = extract_shipment_fields(PDF_STYLE_SI)

    assert si.fields["notify_party"].splitlines()[0] == "TOPKOPY MIDDLE EAST FZE"


def test_parties_are_compared_on_company_name_not_address_layout() -> None:
    si = extract_shipment_fields(PDF_STYLE_SI)
    bl = extract_shipment_fields(
        PDF_STYLE_SI.replace("BILL OF LADING INSTRUCTION", "BILL OF LADING (DRAFT)")
        .replace("P.O. BOX 17436\nJEBEL ALI FREE ZONE, DUBAI, UAE\nNOTIFY", "PO BOX 17436, JEBEL ALI\nNOTIFY")
    )

    assert compare_shipments(si, bl)["defect_fields"] == []

    other_notify = extract_shipment_fields(
        PDF_STYLE_SI.replace("BILL OF LADING INSTRUCTION", "BILL OF LADING (DRAFT)")
        .replace("NOTIFY PARTY\nTOPKOPY MIDDLE EAST FZE", "NOTIFY PARTY\nSOMEONE ELSE LLC")
    )
    assert compare_shipments(si, other_notify)["defect_fields"] == ["notify_party"]


def test_table_headers_do_not_hide_the_real_container_and_weight_lines() -> None:
    si = extract_shipment_fields(
        """BILL OF LADING INSTRUCTION
CONTAINER NO.
DESCRIPTION
GROSS WEIGHT (KG)
CHRR1588144
40'HC COATED IVORY BOARD
20,163
No. of Containers: 2 x 40'HC
TOTAL Gross Wt (kgs): 40,326 KG
"""
    )

    assert si.fields["container_count"] == 2
    assert si.fields["gross_weight_kg"] == 40326
    assert not si.missing_fields or "container_count" not in si.missing_fields
