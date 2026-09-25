from __future__ import annotations

import re
from typing import Any

from .verification import COMPARE_FIELDS, values_match


def _evidence_supports_value(value: str | int | None, evidence: str) -> bool:
    if value is None or not evidence:
        return False
    if isinstance(value, int):
        return re.search(rf"(?<!\d){value}(?!\d)", evidence) is not None
    normalized_value = re.sub(r"[^A-Z0-9]", "", value.upper())
    normalized_evidence = re.sub(r"[^A-Z0-9]", "", evidence.upper())
    return len(normalized_value) >= 3 and normalized_value in normalized_evidence


def preview_rule_correction(report: dict[str, Any]) -> dict[str, Any]:
    """Propose extraction fixes only when both source snippets support one value."""
    documents = report.get("documents", {})
    si = documents.get("si", {})
    bl = documents.get("bl", {})
    si_fields = dict(si.get("fields", {}))
    bl_fields = dict(bl.get("fields", {}))
    changes: list[dict[str, Any]] = []
    unresolved_fields: list[str] = []
    source_evidence: dict[str, dict[str, str]] = {}

    for field in report.get("defect_fields", []):
        if field not in COMPARE_FIELDS:
            unresolved_fields.append(field)
            continue
        si_value = si_fields.get(field)
        bl_value = bl_fields.get(field)
        si_evidence = str(
            si.get("evidence_details", {}).get(field, {}).get("source_text")
            or si.get("evidence", {}).get(field)
            or ""
        )
        bl_evidence = str(
            bl.get("evidence_details", {}).get(field, {}).get("source_text")
            or bl.get("evidence", {}).get(field)
            or ""
        )
        source_evidence[field] = {
            "si": si_evidence[:600],
            "bl": bl_evidence[:600],
        }
        if si_value is None or bl_value is None or values_match(field, si_value, bl_value):
            unresolved_fields.append(field)
            continue

        si_supports_si = _evidence_supports_value(si_value, si_evidence)
        si_supports_bl = _evidence_supports_value(bl_value, si_evidence)
        bl_supports_si = _evidence_supports_value(si_value, bl_evidence)
        bl_supports_bl = _evidence_supports_value(bl_value, bl_evidence)

        if si_supports_bl and not si_supports_si and bl_supports_bl and not bl_supports_si:
            si_fields[field] = bl_value
            changes.append({
                "field": field,
                "document": "si",
                "before": si_value,
                "after": bl_value,
                "reason": "Both source snippets support the BL value; the SI extraction conflicts with its own source text.",
            })
        elif si_supports_si and not si_supports_bl and bl_supports_si and not bl_supports_bl:
            bl_fields[field] = si_value
            changes.append({
                "field": field,
                "document": "bl",
                "before": bl_value,
                "after": si_value,
                "reason": "Both source snippets support the SI value; the BL extraction conflicts with its own source text.",
            })
        else:
            unresolved_fields.append(field)

    defects = list(report.get("defect_fields", []))
    return {
        "email_id": report.get("email_id"),
        "subject": report.get("subject", ""),
        "defect_fields": defects,
        "changes": changes,
        "unresolved_fields": unresolved_fields,
        "ready": bool(defects) and not unresolved_fields and len(changes) > 0,
        "source_evidence": source_evidence,
        "si_fields": si_fields,
        "bl_fields": bl_fields,
    }


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


def preview_ai_field_correction(report: dict[str, Any], request: str = "") -> dict[str, Any]:
    """Prepare an editable correction proposal from the deterministic SI source values."""
    documents = report.get("documents", {})
    si_fields = documents.get("si", {}).get("fields", {})
    bl_fields = documents.get("bl", {}).get("fields", {})
    changes = []
    proposed_bl = dict(bl_fields)
    for field in report.get("defect_fields", []):
        si_value = si_fields.get(field)
        bl_value = bl_fields.get(field)
        if si_value is not None and si_value != bl_value:
            proposed_bl[field] = si_value
            changes.append({"document": "bl", "field": field, "before": bl_value, "after": si_value})
    return {
        "action": "ai_field_correction",
        "requires_confirmation": True,
        "persisted": False,
        "request": request,
        "changes": changes,
        "si_fields": dict(si_fields),
        "bl_fields": proposed_bl,
        "explanation": "Proposal uses the Shipping Instruction as the deterministic source of truth. Review every change before applying it.",
    }
