## Shipping document verification guidance

### Deterministic authority

The SI and BL comparison report is authoritative for status and defect fields. Retrieval may explain a result or suggest a review action, but it must never change the deterministic status, invent a matching value, or mark a mismatch as resolved.

### Compared fields

The standard comparison fields are shipper, consignee, notify party, port of loading, port of discharge, container count, and gross weight in kilograms. A missing, unreadable, or low-confidence value should be routed to human review.

### Field aliases

- Shipper: shipper, exporter, seller, consignor.
- Consignee: consignee, receiver, buyer, importer.
- Notify party: notify party, notify, notify address.
- Port of loading: POL, port of loading, loading port, place of receipt when explicitly used as the loading location.
- Port of discharge: POD, port of discharge, discharge port, destination port.
- Container count: container count, number of containers, containers, packages, quantity of containers.
- Gross weight: gross weight, gross wt, gross mass, weight in kilograms, kgs, KG.

Aliases identify candidate fields only. They do not prove that two values are equivalent.

### Name and address differences

Shipper, consignee, and notify-party values may differ in punctuation, capitalization, line breaks, legal suffixes, or formatting while referring to the same entity. These differences may be ignored only when deterministic normalization records the equivalence. A different company, country, or address without supporting evidence is a real mismatch and requires human review.

### Weight and unit rules

Normalize weights to kilograms before comparison. One metric tonne (MT or tonne) equals 1,000 kg. One pound (lb or lbs) equals 0.453592 kg. Preserve the original SI and BL values in the evidence, and report conversions as ignored differences only when the normalized values match within the configured tolerance.

### OCR and document quality

OCR can confuse characters, split labels, or misread abbreviations. Common examples include `Gross Wt` versus `Gross Weight`, `POD` versus `Port of Discharge`, and minor character substitutions in labels. Do not silently correct a value when the evidence is ambiguous; request a targeted re-read or human confirmation.

### Review routing

- Automatic match: all required fields are present, readable, and deterministically equivalent.
- Human review: any required field is missing, unreadable, low-confidence, or deterministically mismatched.
- Clarification needed: the documents conflict and the correct value cannot be established from the supplied evidence.

For a shipper mismatch, compare the full legal name and address on both documents, check for OCR or formatting explanations, and request confirmation before release. Do not recommend email-access troubleshooting or unrelated IT actions for a shipping-document exception.

### Container count mismatch

Compare the number of containers and package descriptions on the SI and BL. Do not treat different container quantities as a formatting difference. Route the case to human review and confirm the correct count with the source documents before release.

### Notify party mismatch

Compare the full notify-party name and address on the SI and BL. A punctuation or line-break difference may be equivalent, but a different company or address is a real mismatch. Check the booking or approved shipping instructions and request confirmation before release.

### Shipper, consignee, or party mismatch

Compare the complete legal entity name, address, and country on both documents. Check for OCR errors, abbreviations, trading names, and legal-suffix differences. Do not approve the case solely because the names look similar; request human confirmation when the entity or address cannot be established.

### Port mismatch

Compare the named port and UN/LOCODE for the port of loading and port of discharge. Port aliases may be equivalent when they identify the same location, but a different port or destination requires human review before release.

### Gross-weight mismatch

Normalize both gross weights to kilograms and compare the normalized values. Confirm the unit and the evidence line before escalating. A difference that remains after KG, MT, or LB conversion is a real mismatch and requires human review.
