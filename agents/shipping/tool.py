from __future__ import annotations

from pathlib import Path
from typing import Any

from .attachments import AttachmentReadError, read_attachment_text
from .dataset import DatasetAdapter
from .verification import COMPARE_FIELDS, classify_email, compare_shipments, extract_shipment_fields, write_submission


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
    result: dict[str, Any] = {
        "email_id": email_id,
        "category": category,
        "subject": email.subject,
        "attachments": list(email.attachments),
    }
    if category != "BL_COMPARISON":
        result["message"] = "This email is not a document-comparison request."
        return result
    if len(email.attachments) != 2:
        result.update({"status": "NEEDS_REVIEW", "review_reason": "missing_attachment"})
        return result

    documents = []
    try:
        for reference in email.attachments:
            document = extract_shipment_fields(read_attachment_text(adapter, reference))
            documents.append({"reference": reference, "document": document})
    except AttachmentReadError as error:
        result.update({
            "status": "NEEDS_REVIEW",
            "review_reason": "unreadable",
            "error": str(error),
        })
        return result

    si_item = next((item for item in documents if item["document"].document_type == "SI"), None)
    bl_item = next((item for item in documents if item["document"].document_type == "BL"), None)
    if si_item is None or bl_item is None:
        result.update({"status": "NEEDS_REVIEW", "review_reason": "wrong_doc_type"})
        return result

    si = si_item["document"]
    bl = bl_item["document"]
    result["documents"] = {
        "si": {"attachment": si_item["reference"], "fields": si.fields, "missing_fields": list(si.missing_fields)},
        "bl": {"attachment": bl_item["reference"], "fields": bl.fields, "missing_fields": list(bl.missing_fields)},
    }
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
    result["has_defect"] = comparison["status"] == "MISMATCH"
    result["differences"] = differences
    return result