from __future__ import annotations

from pathlib import Path
from typing import Any

from .attachments import AttachmentReadError, read_attachment_content
from .dataset import DatasetAdapter
from .verification import (
    AWAITING_DOCUMENTS_MESSAGE,
    COMPARE_FIELDS,
    classify_email,
    classify_email_details,
    compare_shipments,
    extract_shipment_fields,
    _prompt_injection_metadata,
    write_submission,
)


def run_shipping_verification(
    data_root: str = "http://localhost:8080",
    output_path: str = ".artifacts/shipping-submission.json",
) -> dict[str, Any]:
    """Run deterministic inbox classification and SI/BL verification.

    This is the ADK-facing entry point. It returns a compact summary while
    writing the complete email-keyed submission JSON to ``output_path``.
    The default uses the local challenge server; pass a local ``data_v2``
    path when running against the static dataset.
    """
    output = Path(output_path).expanduser().resolve()
    submission = write_submission(DatasetAdapter(data_root), output)
    category_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    for result in submission.values():
        category = result["category"]
        status = result["status"]
        category_counts[category] = category_counts.get(category, 0) + 1
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "ok": True,
        "output_path": str(output),
        "email_count": len(submission),
        "category_counts": category_counts,
        "status_counts": status_counts,
    }


def inspect_shipping_email(
    email_id: str,
    data_root: str = "http://localhost:8080",
) -> dict[str, Any]:
    """Inspect one email and explain its SI/BL result with evidence."""
    adapter = DatasetAdapter(data_root)
    email = adapter.get(email_id)
    category = classify_email(email)
    classification = classify_email_details(email)
    
    if category != "BL_COMPARISON" and email.raw.get("source") == "upload" and len(email.attachments) >= 2:
        category = "BL_COMPARISON"
        classification = {
            "category": category,
            "confidence": "high",
            "rationale": "Two attachments were uploaded for verification, so they are compared.",
        }
    result: dict[str, Any] = {
        "email_id": email_id,
        "category": category,
        "sender": email.sender,
        "classification": classification,
        "subject": email.subject,
        "body": email.body,
        "attachments": list(email.attachments),
    }
    security_texts: dict[str, str] = {"email": email.body}
    result.update(_prompt_injection_metadata(security_texts))
    if category != "BL_COMPARISON":
        result.update({
            "status": "OK",
            "review_reason": None,
            "has_defect": False,
            "defect_fields": [],
            "message": (
                AWAITING_DOCUMENTS_MESSAGE
                if category == "DOCUMENT_CHASE"
                else "This email is not a document-comparison request."
            ),
        })
        return result
    if len(email.attachments) < 2:
        result.update({"status": "NEEDS_REVIEW", "review_reason": "missing_attachment"})
        return result

    documents = []
    try:
        for reference in email.attachments:
            content = read_attachment_content(adapter, reference)
            security_texts[reference] = content.text
            document = extract_shipment_fields(
                content.text,
                filename=reference,
                source_spans=content.spans,
                alternate_readings=content.reader_texts,
            )
            documents.append({"reference": reference, "document": document})
        result.update(_prompt_injection_metadata(security_texts))
    except AttachmentReadError as error:
        result.update({
            "status": "NEEDS_REVIEW",
            "review_reason": "unreadable",
            "error": str(error),
        })
        return result

    si_item = next((item for item in documents if item["document"].document_type == "SI"), None)
    bl_item = next((item for item in documents if item["document"].document_type == "BL"), None)

    # Heuristic fallback if 2 documents are present
    if len(documents) >= 2:
        if si_item is None and bl_item is not None:
            candidate = next((item for item in documents if item != bl_item), None)
            if candidate:
                si_item = candidate
        elif bl_item is None and si_item is not None:
            candidate = next((item for item in documents if item != si_item), None)
            if candidate:
                bl_item = candidate
        elif si_item is None and bl_item is None:
            si_item = documents[0]
            bl_item = documents[1]

    # Always attach extracted documents if candidates exist
    if si_item and bl_item:
        si = si_item["document"]
        bl = bl_item["document"]
        result["documents"] = {
            "si": {
                "attachment": si_item["reference"],
                "fields": si.fields,
                "missing_fields": list(si.missing_fields),
                "confidence": si.confidence,
                "evidence": si.evidence,
                "evidence_details": si.evidence_details,
                "reader_fields": si.reader_fields,
                "reader_agreement": si.reader_agreement,
            },
            "bl": {
                "attachment": bl_item["reference"],
                "fields": bl.fields,
                "missing_fields": list(bl.missing_fields),
                "confidence": bl.confidence,
                "evidence": bl.evidence,
                "evidence_details": bl.evidence_details,
                "reader_fields": bl.reader_fields,
                "reader_agreement": bl.reader_agreement,
            },
        }
    elif documents:
        result["documents"] = {
            f"doc_{idx+1}": {
                "attachment": item["reference"],
                "fields": item["document"].fields,
                "missing_fields": list(item["document"].missing_fields),
                "confidence": item["document"].confidence,
                "evidence": item["document"].evidence,
                "evidence_details": item["document"].evidence_details,
            }
            for idx, item in enumerate(documents)
        }

    if si_item is None or bl_item is None:
        result.update({"status": "NEEDS_REVIEW", "review_reason": "wrong_doc_type"})
        return result

    si = si_item["document"]
    bl = bl_item["document"]

    if si.document_type != "SI" or bl.document_type != "BL":
        result.update({"status": "NEEDS_REVIEW", "review_reason": "wrong_doc_type"})
        return result

    if si.missing_fields or bl.missing_fields:
        result.update({"status": "NEEDS_REVIEW", "review_reason": "missing_value"})
        return result

    comparison = compare_shipments(si, bl)
    differences = {
        field: {"si": si.fields[field], "bl": bl.fields[field]}
        for field in COMPARE_FIELDS
        if field in comparison["defect_fields"]
    }
    result.update(comparison)
    result["ignored_attachments"] = [
        item["reference"]
        for item in documents
        if item["document"].document_type not in {"SI", "BL"}
    ]
    result["has_defect"] = comparison["status"] == "MISMATCH"
    result["differences"] = differences
    return result