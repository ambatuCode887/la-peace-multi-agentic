from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .attachments import AttachmentReadError, read_attachment_text
from .dataset import DatasetAdapter, DatasetEmail


CATEGORIES = ("BL_COMPARISON", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM")
COMPARE_FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)
REVIEW_REASONS = ("wrong_doc_type", "missing_attachment", "unreadable", "missing_value")


@dataclass(frozen=True)
class ExtractedShipment:
    fields: dict[str, str | int | None]
    missing_fields: tuple[str, ...]
    document_type: str
    confidence: dict[str, str]
    evidence: dict[str, str]


def classify_email(email: DatasetEmail | Mapping[str, Any]) -> str:
    """Classify an inbox record using high-signal subject/body rules."""
    subject = _email_value(email, "subject").lower()
    body = _email_value(email, "body").lower()

    if any(signal in f"{subject}\n{body}" for signal in (
        "congratulations", "won a", "parcel is on hold", "mailbox is full",
        "bitcoin investment", "hot singles", "claim now", "verify your account",
        "increase your shipping revenue", "undelivered messages", "exclusive offer",
        "valued customer", "email storage is full", "bank officer",
        "bank details",
    )):
        return "SPAM"
    if "_rpa_" in subject and "billing process completed" in subject:
        return "GENERAL"
    if any(signal in subject for signal in (
        "invoice", "billing", "local charges", "d & d", "detention",
        "missing gr", "total freight", "cancel invoice", "freight",
    )):
        return "INVOICE_QUERY"
    if re.search(r"\b(request\s+si|cust\s+si|latest\s+si|si\s+needed|si\s*-)", subject):
        return "SI_REQUEST"
    if any(signal in subject for signal in (
        "to confirm docs", "request bl draft", "draft bl", "confirm docs",
    )) or re.search(r"\b525007\d+\b", subject):
        return "BL_COMPARISON"
    if _has_document_comparison_signal(email, body):
        return "BL_COMPARISON"
    return "GENERAL"


def classify_email_details(email: DatasetEmail | Mapping[str, Any]) -> dict[str, str]:
    """Return the rule classification with an operator-facing confidence rationale."""
    category = classify_email(email)
    subject = _email_value(email, "subject").lower()
    body = _email_value(email, "body").lower()
    combined = f"{subject}\n{body}"
    high_signal = category == "SPAM" or any(
        signal in combined for signal in ("draft bl", "to confirm docs", "request si", "invoice", "billing")
    ) or _has_document_comparison_signal(email, body)
    return {
        "category": category,
        "confidence": "high" if high_signal else "medium",
        "rationale": "Matched a high-signal subject/body or SI/BL attachment pattern" if high_signal else "No high-signal pattern; routed to general handling",
    }


def extract_shipment_fields(text: str, filename: str = "") -> ExtractedShipment:
    """Extract the seven comparison fields from a plain-text SI or BL."""
    document_type = _document_type(text, filename)
    values: dict[str, str | int | None] = {}
    confidence: dict[str, str] = {}
    evidence: dict[str, str] = {}
    for field, pattern in _FIELD_PATTERNS.items():
        match = pattern.search(text)
        if field in {"container_count", "gross_weight_kg"}:
            numeric_matches = [
                candidate
                for candidate in pattern.finditer(text)
                if re.search(r"\d", candidate.group(1))
            ]
            if numeric_matches:
                match = numeric_matches[-1]
        next_line = not match
        value = match.group(1) if match else _next_line_value(text, field)
        if field == "notify_party" and value and re.fullmatch(
            r"(?i)party\s*/?\s*intermediate\s+consignee|party", value.strip()
        ):
            match = None
            next_line = True
            value = _next_line_value(text, field)
        values[field] = _parse_field(field, value)
        if values[field] is None:
            confidence[field] = "low"
            evidence[field] = "No usable value found"
        elif match:
            confidence[field] = "high"
            evidence[field] = f"Matched label in text: {match.group(0).strip()}"
        elif next_line:
            confidence[field] = "medium"
            evidence[field] = "Value found on the line following the field label"
    missing = tuple(field for field in COMPARE_FIELDS if values[field] is None)
    return ExtractedShipment(
        fields=values,
        missing_fields=missing,
        document_type=document_type,
        confidence=confidence,
        evidence=evidence,
    )


def compare_shipments(si: ExtractedShipment, bl: ExtractedShipment) -> dict[str, Any]:
    """Compare BL values against SI values and return a submission-ready result."""
    if si.document_type != "SI" or bl.document_type != "BL":
        return {"status": "NEEDS_REVIEW", "review_reason": "wrong_doc_type", "defect_fields": []}
    if si.missing_fields or bl.missing_fields:
        return {"status": "NEEDS_REVIEW", "review_reason": "missing_value", "defect_fields": []}

    normalized_equivalences = [
        field
        for field in COMPARE_FIELDS
        if si.fields[field] != bl.fields[field]
        and _normalized_field_value(field, si.fields[field])
        == _normalized_field_value(field, bl.fields[field])
    ]
    defects = [
        field for field in COMPARE_FIELDS
        if _normalized_field_value(field, si.fields[field])
        != _normalized_field_value(field, bl.fields[field])
    ]
    return {
        "status": "MISMATCH" if defects else "OK",
        "review_reason": None,
        "defect_fields": defects,
        "normalized_equivalences": normalized_equivalences,
    }


def build_submission(adapter: DatasetAdapter) -> dict[str, dict[str, Any]]:
    """Create a result for every inbox email using the text-only baseline."""
    submission: dict[str, dict[str, Any]] = {}
    for email in adapter:
        category = classify_email(email)
        result: dict[str, Any] = {
            "category": category,
            "classification": classify_email_details(email),
            "status": "OK",
            "review_reason": None,
            "has_defect": False,
            "defect_fields": [],
            "decided_by": "rule",
        }
        if category == "BL_COMPARISON":
            result.update(_compare_email(adapter, email))
        submission[email.email_id] = result
    return submission


def write_submission(adapter: DatasetAdapter, output_path: str | Path) -> dict[str, dict[str, Any]]:
    submission = build_submission(adapter)
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(submission, indent=2) + "\n", encoding="utf-8")
    return submission


def _compare_email(adapter: DatasetAdapter, email: DatasetEmail) -> dict[str, Any]:
    if len(email.attachments) < 2:
        return _review_result(
            email,
            "missing_attachment",
            attachment_count=len(email.attachments),
        )
    documents = []
    failed_reference: str | None = None
    try:
        for reference in email.attachments:
            failed_reference = reference
            documents.append(
                extract_shipment_fields(
                    read_attachment_text(adapter, reference),
                    filename=reference,
                )
            )
    except AttachmentReadError as error:
        return _review_result(
            email,
            "unreadable",
            failed_attachment=failed_reference,
            error=str(error),
        )
    si = next((document for document in documents if document.document_type == "SI"), None)
    bl = next((document for document in documents if document.document_type == "BL"), None)
    if si is None or bl is None:
        return _review_result(
            email,
            "wrong_doc_type",
            documents=_document_evidence(email, documents),
        )
    if si.missing_fields or bl.missing_fields:
        return _review_result(
            email,
            "missing_value",
            documents=_document_evidence(email, documents),
            missing_fields={
                "si": list(si.missing_fields),
                "bl": list(bl.missing_fields),
            },
        )
    comparison = compare_shipments(si, bl)
    comparison["has_defect"] = comparison["status"] == "MISMATCH"
    comparison["documents"] = _document_evidence(email, documents)
    comparison["ignored_attachments"] = [
        reference
        for reference, document in zip(email.attachments, documents)
        if document.document_type not in {"SI", "BL"}
    ]
    return comparison


def _review_result(email: DatasetEmail, reason: str, **details: Any) -> dict[str, Any]:
    return {
        "status": "NEEDS_REVIEW",
        "review_reason": reason,
        "review_context": {
            "email_id": email.email_id,
            "attachments": list(email.attachments),
            **details,
        },
    }


def _document_evidence(
    email: DatasetEmail, documents: list[ExtractedShipment]
) -> list[dict[str, Any]]:
    return [
        {
            "attachment": email.attachments[index],
            "document_type": document.document_type,
            "fields": document.fields,
            "missing_fields": list(document.missing_fields),
            "confidence": document.confidence,
            "evidence": document.evidence,
        }
        for index, document in enumerate(documents)
    ]


def _email_value(email: DatasetEmail | Mapping[str, Any], name: str) -> str:
    if isinstance(email, DatasetEmail):
        return getattr(email, "sender" if name == "from" else name, "")
    return str(email.get(name, ""))


def _email_attachments(email: DatasetEmail | Mapping[str, Any]) -> tuple[str, ...]:
    if isinstance(email, DatasetEmail):
        return email.attachments
    attachments = email.get("attachments", ())
    return tuple(attachments) if isinstance(attachments, (list, tuple)) else ()


def _has_document_comparison_signal(
    email: DatasetEmail | Mapping[str, Any], body: str = ""
) -> bool:
    body_has_both_documents = bool(
        re.search(r"\bsi\b", body) and re.search(r"\bbl\b", body)
    )
    attachment_names = [Path(reference).stem.lower() for reference in _email_attachments(email)]
    named_si = any(re.search(r"(?:^|[_\-\s])si(?:$|[_\-\s])", name) for name in attachment_names)
    named_bl = any(re.search(r"(?:^|[_\-\s])bl(?:$|[_\-\s])", name) for name in attachment_names)
    return bool(_email_attachments(email)) and (body_has_both_documents or (named_si and named_bl))


def _document_type(text: str, filename: str = "") -> str:
    norm_text = re.sub(r"\s+", " ", text.upper())

    if (
        re.search(r"\bSHIPPING\s*INSTRUC\s*T", norm_text)
        or re.search(r"\bBL\s*INSTRUC\s*T", norm_text)
        or re.search(r"\bBILL\s*OF\s*LAD\s*ING\s*INSTRUC\s*T", norm_text)
    ):
        return "SI"
    if re.search(r"\bBILL\s*OF\s*LAD\s*ING\b", norm_text):
        return "BL"

    return "OTHER"


def _parse_field(field: str, value: str | None) -> str | int | None:
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned or cleaned.upper() in {"???", "_______", "TBA", "TBC", "N/A"}:
        return None
    if field == "container_count":
        match = re.search(r"\b(\d+)\s*(?:X|x|CONTAINERS?|UNIT)", cleaned)
        if not match:
            match = re.search(r"\b(\d+)\b", cleaned)
        return int(match.group(1)) if match else None
    if field == "gross_weight_kg":
        # Handle OCR comma misread as dot or European thousands separator (e.g. 237.750 KG)
        cleaned_weight = re.sub(r"(\d+)\.(\d{3})(?=\D|$)", r"\1\2", cleaned)
        match = re.search(r"([\d][\d, ]*(?:\.\d+)?)", cleaned_weight)
        if not match:
            return None
        return int(float(match.group(1).replace(",", "").replace(" ", "")))
    return cleaned.splitlines()[0].strip()


def _normalized_value(value: str | int | None) -> str | int | None:
    if isinstance(value, int) or value is None:
        return value
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def _normalized_field_value(field: str, value: str | int | None) -> str | int | None:
    """Normalize comparison values while keeping the raw OCR value for evidence."""
    if field in {"shipper", "consignee", "notify_party"} and isinstance(value, str):
        value = re.sub(r"\bSDN\s+SHD\b", "SDN BHD", value, flags=re.IGNORECASE)
    return _normalized_value(value)


def _next_line_value(text: str, field: str) -> str | None:
    label_pattern = _STANDALONE_LABEL_PATTERNS.get(field)
    if label_pattern is None:
        return None
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if not label_pattern.match(line.strip()):
            continue
        for following in lines[index + 1:]:
            value = following.strip()
            if value:
                if any(
                    p.search(value)
                    for name, p in _FIELD_PATTERNS.items()
                    if name != field
                ):
                    return None
                return value
    return None


_FIELD_PATTERNS = {
    "shipper": re.compile(r"(?im)^\s*shipper(?:[ \t]*/[ \t]*exporter)?(?:[ \t]*\([^)]*\))*[ \t]*(?:\||:|\.|\b(?=[A-Z0-9]))[ \t]*([^|\r\n]+)"),
    "consignee": re.compile(r"(?im)^\s*(?:consignee|to[ \t]+the[ \t]+order[ \t]+of)(?:[ \t]*\([^)]*\))*[ \t]*(?:\||:|\.|\b(?=[A-Z0-9]))[ \t]*([^|\r\n]+)"),
    "notify_party": re.compile(r"(?im)^\s*(?:notify[ \t]+party[ \t]*/?[ \t]*intermediate[ \t]+consignee|notify(?:[ \t]+party)?|also[ \t]+notify)(?:[ \t]*\([^)]*\))*[ \t]*(?:\||:|\.|\b(?=[A-Z0-9]))[ \t]*([^|\r\n]+)"),
    "port_of_loading": re.compile(r"(?im)^\s*(?:port[ \t]*of[ \t]*(?:loading|lcading)|load[ \t]+port|pol)(?:[ \t]*\([^)]*\))*[ \t]*(?:\||:|\.|\b(?=[A-Z0-9]))[ \t]*([^|\r\n]+)"),
    "port_of_discharge": re.compile(r"(?im)^\s*(?:port[ \t]*of[ \t]*discharge|discharge[ \t]+port|pod)(?:[ \t]*\([^)]*\))*[ \t]*(?:\||:|\.|\b(?=[A-Z0-9]))[ \t]*([^|\r\n]+)"),
    "container_count": re.compile(r"(?im)^\s*(?:total[ \t]+containers?|no\.?[ \t]+of[ \t]+containers?(?:[ \t]+or[ \t]+packages)?|container[ \t]+count|containe[ \t]*rs?|containers?)[^|:\r\n0-9]*(?:[:|.]|\b)[ \t]*([^|\r\n]+)"),
    "gross_weight_kg": re.compile(r"(?im)^\s*(?:total[ \t]+)?g(?:ross|iross)[ \t]*(?:weight|wt)[^|:\r\n0-9]*(?:[:|.]|\b)[ \t]*([^|\r\n]+)"),
}

_STANDALONE_LABEL_PATTERNS = {
    "shipper": re.compile(r"(?i)^shipper(?:\s*/\s*exporter)?(?:\s*\([^)]*\))*$"),
    "consignee": re.compile(r"(?i)^(?:consignee|to\s+the\s+order\s+of)(?:\s*\([^)]*\))*$"),
    "notify_party": re.compile(r"(?i)^(?:notify(?:\s+party)?|also\s+notify)(?:\s*/\s*intermediate\s+consignee)?(?:\s*\([^)]*\))*$"),
    "port_of_loading": re.compile(r"(?i)^(?:port\s*of\s*(?:loading|lcading)|load\s+port|pol)(?:\s*\([^)]*\))*$"),
    "port_of_discharge": re.compile(r"(?i)^(?:port\s*of\s*discharge|discharge\s+port|pod)(?:\s*\([^)]*\))*$"),
    "container_count": re.compile(r"(?i)^(?:total\s+containers?|no\.?\s+of\s+containers?(?:\s+or\s+packages)?|container\s+count|containe\s*rs?|containers?)(?:\s*\([^)]*\))*$"),
    "gross_weight_kg": re.compile(r"(?i)^(?:total\s+)?gro?ss?\s*(?:weight|wt)(?:\s*\([^)]*\))*$"),
}