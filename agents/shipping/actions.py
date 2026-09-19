from __future__ import annotations

from typing import Any

from .verification import COMPARE_FIELDS


def draft_correction_email(report: dict[str, Any], requested_correction: str = "") -> dict[str, Any]:
    """Create a correction-email preview without sending or persisting it."""
    defects = list(report.get("defect_fields", []))
    documents = report.get("documents", {})
    lines = []
    for field in defects:
        si_value = documents.get("si", {}).get("fields", {}).get(field)
        bl_value = documents.get("bl", {}).get("fields", {}).get(field)
        lines.append(f"- {field}: SI={si_value!r}; BL={bl_value!r}")
    email_id = report.get("email_id", "shipment")
    return {
        "action": "draft_correction_email",
        "requires_confirmation": True,
        "sent": False,
        "to": report.get("sender", ""),
        "subject": f"Correction required for shipping documents - {email_id}",
        "body": (
            "Hello,\n\nPlease confirm the following shipping-document difference(s):\n"
            + "\n".join(lines)
            + f"\n\nRequested correction: {requested_correction or 'Please confirm the correct value.'}\n\nRegards,\nShipping Operations"
        ),
    }


def preview_false_alarm(report: dict[str, Any], note: str = "") -> dict[str, Any]:
    """Prepare a false-alarm review proposal without changing the report."""
    return {
        "action": "false_alarm",
        "requires_confirmation": True,
        "persisted": False,
        "proposed_status": "OK",
        "defect_fields": list(report.get("defect_fields", [])),
        "note": note or "Reviewer confirmation required before accepting this difference as a false alarm.",
    }


def preview_targeted_reread(report: dict[str, Any], field: str) -> dict[str, Any]:
    """Prepare a targeted re-read request for one comparison field."""
    if field not in COMPARE_FIELDS:
        raise ValueError(f"Unsupported comparison field: {field}")
    return {
        "action": "targeted_reread",
        "requires_confirmation": True,
        "persisted": False,
        "field": field,
        "request": f"Re-read the {field.replace('_', ' ')} field in the SI and BL and compare the source evidence.",
    }
