from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .attachments import AttachmentReadError, read_attachment_content
from .dataset import DatasetAdapter, DatasetEmail


CATEGORIES = ("BL_COMPARISON", "DOCUMENT_CHASE", "SI_REQUEST", "INVOICE_QUERY", "GENERAL", "SPAM")
COMPARE_FIELDS = (
    "shipper",
    "consignee",
    "notify_party",
    "port_of_loading",
    "port_of_discharge",
    "container_count",
    "gross_weight_kg",
)
PARTY_FIELDS = ("shipper", "consignee", "notify_party")
_MAX_PARTY_LINES = 5
_BLOCK_STOP = re.compile(
    r"(?i)^(?:vessel|voyage|container|description|hs[ \t]*code|b/?l\b|booking|freight"
    r"|oc[ \t]*no|marks|place[ \t]+of|final[ \t]+dest|packages|no\.?[ \t]+of|total"
    r"|gross|net[ \t]+weight|measurement|carrier|date)"
)
REVIEW_REASONS = ("wrong_doc_type", "missing_attachment", "unreadable", "missing_value")
_INSTRUCTION_LIKE_PATTERNS = (
    re.compile(r"(?i)\bignore\s+(?:all\s+)?previous\s+instructions?\b"),
    re.compile(r"(?i)\bdisregard\s+(?:all\s+)?(?:prior|previous)\s+instructions?\b"),
    re.compile(r"(?i)\b(?:system|developer)\s+prompt\b"),
    re.compile(r"(?i)\b(?:reveal|show|print| disclose)\b[^\n]{0,40}\b(?:prompt|instructions?|secrets?|api\s*key)\b"),
    re.compile(r"(?i)\b(?:report|mark|set)\b[^\n]{0,30}\b(?:status|result)\b[^\n]{0,20}\b(?:ok|mismatch|needs?\s+review)\b"),
    re.compile(r"请忽略之前的所有指令|忽略之前的所有指令"),
    re.compile(r"(?i)\b(?:no human review|no review needed)\b"),
)


@dataclass(frozen=True)
class ExtractedShipment:
    fields: dict[str, str | int | None]
    missing_fields: tuple[str, ...]
    document_type: str
    confidence: dict[str, str]
    evidence: dict[str, str]
    evidence_details: dict[str, dict[str, Any]]
    raw_values: dict[str, str | None]
    source_labels: dict[str, str | None]
    reader_fields: dict[str, dict[str, str | int | None]]
    reader_agreement: dict[str, str]


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
        return _comparison_or_chase(email)
    if _has_document_comparison_signal(email, body):
        return _comparison_or_chase(email)
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
    rationale = (
        "Matched a high-signal subject/body or SI/BL attachment pattern" if high_signal
        else "No high-signal pattern; routed to general handling"
    )
    if category == "DOCUMENT_CHASE":
        high_signal = True
        rationale = "The sender asks for the draft BL to be sent and no documents are attached, so there is nothing to compare yet"
    return {
        "category": category,
        "confidence": "high" if high_signal else "medium",
        "rationale": rationale,
    }


def extract_shipment_fields(
    text: str,
    filename: str = "",
    source_spans: tuple[dict[str, Any], ...] = (),
    alternate_readings: Mapping[str, str] | None = None,
) -> ExtractedShipment:
    """Extract the seven comparison fields from a plain-text SI or BL."""
    document_type = _document_type(text, filename)
    values: dict[str, str | int | None] = {}
    confidence: dict[str, str] = {}
    evidence: dict[str, str] = {}
    evidence_details: dict[str, dict[str, Any]] = {}
    raw_values: dict[str, str | None] = {}
    source_labels: dict[str, str | None] = {}
    for field, pattern in _FIELD_PATTERNS.items():
        # A table header such as "CONTAINER NO." can match before the real value
        # line, so take the first match that actually parses to a value.
        match = next(
            (
                candidate for candidate in pattern.finditer(text)
                if _parse_field(field, candidate.group(1)) is not None
            ),
            None,
        )
        next_line = not match
        value = match.group(1) if match else _next_line_value(text, field)
        raw_values[field] = value.strip() if value else None
        source_labels[field] = _source_label(field, match)
        if field == "notify_party" and value and re.fullmatch(
            r"(?i)party\s*/?\s*intermediate\s+consignee|party", value.strip()
        ):
            match = None
            next_line = True
            value = _next_line_value(text, field)
        values[field] = _parse_field(field, value)
        if field in PARTY_FIELDS and isinstance(values[field], str):
            values[field] = _party_block(text, field, values[field])
        if values[field] is None:
            confidence[field] = "low"
            evidence[field] = "No usable value found"
            evidence_details[field] = _evidence_detail(filename, -1, -1, source_spans, None, "unresolved")
        elif match:
            confidence[field] = "high"
            evidence[field] = f"Matched label in text: {match.group(0).strip()}"
            evidence_details[field] = _evidence_detail(
                filename, match.start(), match.end(), source_spans, match.group(0).strip(), "label_match"
            )
        elif next_line:
            confidence[field] = "medium"
            evidence[field] = "Value found on the line following the field label"
            value_start = text.find(value) if value else -1
            evidence_details[field] = _evidence_detail(
                filename, value_start, value_start + len(value or ""), source_spans, value, "next_line"
            )
    reader_fields: dict[str, dict[str, str | int | None]] = {}
    reader_agreement: dict[str, str] = {}
    for reader, alternate_text in (alternate_readings or {}).items():
        alternate = extract_shipment_fields(alternate_text, filename=filename)
        reader_fields[reader] = alternate.fields
        for field in COMPARE_FIELDS:
            if values[field] is None or alternate.fields[field] is None:
                reader_agreement[field] = "unavailable"
                confidence[field] = "low"
            elif values_match(field, values[field], alternate.fields[field]):
                reader_agreement.setdefault(field, "agree")
            else:
                reader_agreement[field] = "disagree"
                confidence[field] = "low"

    missing = tuple(field for field in COMPARE_FIELDS if values[field] is None)
    return ExtractedShipment(
        fields=values,
        missing_fields=missing,
        document_type=document_type,
        confidence=confidence,
        evidence=evidence,
        evidence_details=evidence_details,
        raw_values=raw_values,
        source_labels=source_labels,
        reader_fields=reader_fields,
        reader_agreement=reader_agreement,
    )


def _evidence_detail(
    filename: str,
    start: int,
    end: int,
    source_spans: tuple[dict[str, Any], ...],
    fallback_text: str | None,
    method: str,
) -> dict[str, Any]:
    span = next(
        (
            candidate
            for candidate in source_spans
            if start >= 0 and candidate["start"] <= end and candidate["end"] >= start
        ),
        None,
    )
    return {
        "attachment": filename,
        "page": span.get("page") if span else None,
        "source_text": span.get("text", fallback_text) if span else fallback_text,
        "coordinates": span.get("coordinates") if span else None,
        "method": span.get("method", method) if span else method,
    }


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
    ignored_differences = _ignored_differences(si, bl)
    defects = [
        field for field in COMPARE_FIELDS
        if not values_match(field, si.fields[field], bl.fields[field])
    ]
    uncertain_fields = sorted({
        field
        for document in (si, bl)
        for field, agreement in document.reader_agreement.items()
        if agreement == "disagree"
    })
    return {
        "status": "NEEDS_REVIEW" if uncertain_fields else ("MISMATCH" if defects else "OK"),
        "review_reason": "low_confidence" if uncertain_fields else None,
        "defect_fields": defects,
        "uncertain_fields": uncertain_fields,
        "normalized_equivalences": normalized_equivalences,
        "ignored_differences": ignored_differences,
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
        result.update(_prompt_injection_metadata({"email": _email_value(email, "body")}))
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
    security_texts: dict[str, str] = {"email": _email_value(email, "body")}
    security = _prompt_injection_metadata(security_texts)
    if len(email.attachments) < 2:
        result = _review_result(
            email,
            "missing_attachment",
            attachment_count=len(email.attachments),
        )
        result.update(security)
        return result
    documents = []
    failed_reference: str | None = None
    try:
        for reference in email.attachments:
            failed_reference = reference
            content = read_attachment_content(adapter, reference)
            security_texts[reference] = content.text
            documents.append(extract_shipment_fields(
                content.text,
                filename=reference,
                source_spans=content.spans,
                alternate_readings=content.reader_texts,
            ))
    except AttachmentReadError as error:
        result = _review_result(
            email,
            "unreadable",
            failed_attachment=failed_reference,
            error=str(error),
        )
        result.update(security)
        return result
    security = _prompt_injection_metadata(security_texts)
    si = next((document for document in documents if document.document_type == "SI"), None)
    bl = next((document for document in documents if document.document_type == "BL"), None)
    if si is None or bl is None:
        result = _review_result(
            email,
            "wrong_doc_type",
            documents=_document_evidence(email, documents),
        )
        result.update(security)
        return result
    if si.missing_fields or bl.missing_fields:
        result = _review_result(
            email,
            "missing_value",
            documents=_document_evidence(email, documents),
            missing_fields={
                "si": list(si.missing_fields),
                "bl": list(bl.missing_fields),
            },
        )
        result.update(security)
        return result
    comparison = compare_shipments(si, bl)
    comparison["has_defect"] = comparison["status"] == "MISMATCH"
    comparison["documents"] = _document_evidence(email, documents)
    comparison["ignored_attachments"] = [
        reference
        for reference, document in zip(email.attachments, documents)
        if document.document_type not in {"SI", "BL"}
    ]
    comparison.update(security)
    return comparison


def _prompt_injection_metadata(texts: Mapping[str, str]) -> dict[str, Any]:
    matches: list[dict[str, str]] = []
    for source, text in texts.items():
        for pattern in _INSTRUCTION_LIKE_PATTERNS:
            match = pattern.search(text or "")
            if match:
                matches.append({"source": source, "text": match.group(0)[:120]})
    return {
        "prompt_injection_detected": bool(matches),
        "prompt_injection_matches": matches,
    }


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
            "evidence_details": document.evidence_details,
            "reader_fields": document.reader_fields,
            "reader_agreement": document.reader_agreement,
        }
        for index, document in enumerate(documents)
    ]


AWAITING_DOCUMENTS_MESSAGE = (
    "The sender is asking for the draft BL to be sent, so there is nothing to compare yet."
)
_QUOTED_THREAD = re.compile(r"(?i)^(?:from:|_{5,}|-{3,}\s*original|on .{5,80} wrote:)")
_SECURITY_BANNER = re.compile(r"(?i)^warning:.*(?:originated outside|external)")
_ASKS_TO_SEND_BL = re.compile(
    r"(?i)\b(?:send|forward|share)\b[^.\n]{0,40}?\b(?:draft\s+)?(?:bl|b/l|bill\s+of\s+lading)\b"
)
# Any hint that documents were meant to be included means it is not a plain chase.
_CLAIMS_DOCUMENTS = re.compile(r"(?i)\b(?:compare|attached|attachments?|enclosed|dropped|missing)\b")


def _sender_text(body: str) -> str:
    """The sender's own new message: no security banner and no quoted earlier thread."""
    kept: list[str] = []
    for line in body.splitlines():
        stripped = line.strip()
        if _QUOTED_THREAD.match(stripped):
            break
        if _SECURITY_BANNER.match(stripped):
            continue
        kept.append(stripped)
    return "\n".join(kept)


def is_document_chase(email: DatasetEmail | Mapping[str, Any]) -> bool:
    """True when a document-check email only asks for the draft BL to be sent.

    Such an email has nothing to compare yet and needs no human, so it gets its own category
    (DOCUMENT_CHASE) with status OK. Anything not clearly a chase (two files attached, or
    wording that mentions comparing or attached, dropped or missing documents) returns False
    and stays a document-comparison request, handled as before.
    """
    if len(_email_attachments(email)) >= 2:
        return False
    text = _sender_text(_email_value(email, "body"))
    return bool(_ASKS_TO_SEND_BL.search(text)) and not _CLAIMS_DOCUMENTS.search(text)


def _comparison_or_chase(email: DatasetEmail | Mapping[str, Any]) -> str:
    return "DOCUMENT_CHASE" if is_document_chase(email) else "BL_COMPARISON"


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
        amount = float(match.group(1).replace(",", "").replace(" ", ""))
        unit = _weight_unit(cleaned[match.end():])
        return int(round(amount * {"kg": 1, "tonne": 1000, "lb": 0.45359237}[unit]))
    return cleaned.splitlines()[0].strip()


def _normalized_value(value: str | int | None) -> str | int | None:
    if isinstance(value, int) or value is None:
        return value
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def _normalized_field_value(field: str, value: str | int | None) -> str | int | None:
    """Normalize comparison values while keeping the raw OCR value for evidence."""
    if field in {"shipper", "consignee", "notify_party"} and isinstance(value, str):
        value = re.sub(r"\bSDN\s+SHD\b", "SDN BHD", value, flags=re.IGNORECASE)
    if field in {"port_of_loading", "port_of_discharge"} and isinstance(value, str):
        value = re.sub(r"\s*\([^)]*\)\s*$", "", value)
        value = re.sub(r"\bPELABUHAN\b", "PORT", value, flags=re.IGNORECASE)
    return _normalized_value(value)


def _weight_unit(value: str) -> str:
    if re.search(r"(?i)\b(?:mt|metric\s+tons?|tonnes?|tons?|t)\b", value):
        return "tonne"
    if re.search(r"(?i)\b(?:lb|lbs|pounds?)\b", value):
        return "lb"
    return "kg"


def _source_label(field: str, match: re.Match[str] | None) -> str | None:
    if not match:
        return None
    label = match.group(0)
    value = match.group(1)
    if value:
        label = label[: -len(value)]
    return re.sub(r"[|:.,\s]+$", "", label).strip()


def _ignored_differences(si: ExtractedShipment, bl: ExtractedShipment) -> list[dict[str, Any]]:
    ignored: list[dict[str, Any]] = []
    for field in COMPARE_FIELDS:
        si_label = _normalized_value(si.source_labels.get(field))
        bl_label = _normalized_value(bl.source_labels.get(field))
        if si_label and bl_label and si_label != bl_label:
            ignored.append({"field": field, "reason": "equivalent_label"})

        if field == "gross_weight_kg":
            si_unit = _weight_unit(si.raw_values.get(field) or "")
            bl_unit = _weight_unit(bl.raw_values.get(field) or "")
            if si_unit != bl_unit:
                ignored.append({
                    "field": field,
                    "reason": "unit_conversion",
                    "si_normalized_kg": si.fields[field],
                    "bl_normalized_kg": bl.fields[field],
                })
        elif si.raw_values.get(field) != bl.raw_values.get(field) and values_match(
            field, si.fields[field], bl.fields[field]
        ):
            ignored.append({"field": field, "reason": "formatting_case_or_punctuation"})
    return ignored


def values_match(field: str, si_value: str | int | None, bl_value: str | int | None) -> bool:
    """Compare one field. Parties are matched on the company name (first line) only."""
    if field in PARTY_FIELDS:
        si_value, bl_value = (
            value.splitlines()[0] if isinstance(value, str) and value else value
            for value in (si_value, bl_value)
        )
    return _normalized_field_value(field, si_value) == _normalized_field_value(field, bl_value)


def _party_block(text: str, field: str, first_line: str) -> str:
    """Extend a party's first line with the address lines that follow it."""
    lines = text.splitlines()
    start = None
    for index, line in enumerate(lines):
        same_line = _FIELD_PATTERNS[field].match(line)
        if same_line and same_line.group(1).strip() == first_line:
            start = index
            break
        if _STANDALONE_LABEL_PATTERNS[field].match(line.strip()):
            following = index + 1
            while following < len(lines) and not lines[following].strip():
                following += 1
            if following < len(lines) and lines[following].strip() == first_line:
                start = following
                break
    if start is None:
        return first_line

    block = [first_line]
    for line in lines[start + 1:]:
        value = line.strip()
        if not value or len(block) > _MAX_PARTY_LINES or _is_section_label(value):
            break
        block.append(value)
    return "\n".join(block)


def _is_section_label(line: str) -> bool:
    return bool(_BLOCK_STOP.match(line)) or any(
        pattern.match(line) for pattern in _FIELD_PATTERNS.values()
    ) or any(pattern.match(line) for pattern in _STANDALONE_LABEL_PATTERNS.values())


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
    "shipper": re.compile(r"(?im)^\s*(?:shipper|pengirim|发货人)(?:[ \t]*/[ \t]*exporter)?(?:[ \t]*\([^)]*\))*[^|:\r\n]*(?:\||:|\.)[ \t]*([^|\r\n]+)"),
    "consignee": re.compile(r"(?im)^\s*(?:consignee|penerima|收货人|to[ \t]+the[ \t]+order[ \t]+of)(?:[ \t]*\([^)]*\))*(?:[ \t]*(?:\||:|\.)[ \t]*|[ \t]+)([^|\r\n]+)"),
    "notify_party": re.compile(r"(?im)^\s*(?:notify(?:[ \t]+party)?|also[ \t]+notify|pihak[ \t]+untuk[ \t]+dimaklumkan|通知方)(?![ \t]+party\b)(?:[ \t]*/[ \t]*intermediate[ \t]+consignee)?(?:[ \t]*\([^)]*\))*[^|:\r\n]*(?:\||:|\.)[ \t]*([^|\r\n]+)"),
    "port_of_loading": re.compile(r"(?im)^\s*(?:port[ \t]*of[ \t]*(?:loading|lcading)|load[ \t]+port|pol|pelabuhan[ \t]+pemuatan|装货港)(?:[ \t]*\([^)]*\))*[^|:\r\n]*(?:\||:|\.)[ \t]*([^|\r\n]+)"),
    "port_of_discharge": re.compile(r"(?im)^\s*(?:port[ \t]*of[ \t]*discharge|discharge[ \t]+port|pod|pelabuhan[ \t]+pelepasan|卸货港)(?:[ \t]*\([^)]*\))*[^|:\r\n]*(?:\||:|\.)[ \t]*([^|\r\n]+)"),
    "container_count": re.compile(r"(?im)^\s*(?:total[ \t]+containers?|no\.?[ \t]+of[ \t]+containers?(?:[ \t]+or[ \t]+packages)?|container[ \t]+count|containe[ \t]*rs?|containers?|bilangan[ \t]+kontena|集装箱数量)[^|:\r\n0-9]*(?:[:|.]|\b)[ \t]*([^|\r\n]+)"),
    "gross_weight_kg": re.compile(r"(?im)^\s*(?:total[ \t]+)?(?:g(?:ross|iross)[ \t]*(?:weight|wt)|berat[ \t]+kasar|毛重)[^|:\r\n0-9]*(?:[:|.]|\b)[ \t]*([^|\r\n]+)"),
}

_STANDALONE_LABEL_PATTERNS = {
    "shipper": re.compile(r"(?i)^shipper(?:\s*/\s*exporter)?(?:\s*\([^)]*\))*$"),
    "consignee": re.compile(r"(?i)^(?:consignee|to\s+the\s+order\s+of)(?:\s*\([^)]*\))*$"),
    "notify_party": re.compile(r"(?i)^(?:notify(?:\s+party)?|also\s+notify(?:\s+party)?)(?:\s*/\s*intermediate\s+consignee)?(?:\s*\([^)]*\))*$"),
    "port_of_loading": re.compile(r"(?i)^(?:port\s*of\s*(?:loading|lcading)|load\s+port|pol)(?:\s*\([^)]*\))*$"),
    "port_of_discharge": re.compile(r"(?i)^(?:port\s*of\s*discharge|discharge\s+port|pod)(?:\s*\([^)]*\))*$"),
    "container_count": re.compile(r"(?i)^(?:total\s+containers?|no\.?\s+of\s+containers?(?:\s+or\s+packages)?|container\s+count|containe\s*rs?|containers?)(?:\s*\([^)]*\))*$"),
    "gross_weight_kg": re.compile(r"(?i)^(?:total\s+)?gro?ss?\s*(?:weight|wt)(?:\s*\([^)]*\))*$"),
}