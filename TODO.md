# Shipping Document Verification TODO

## Project decisions

- [x] Use Google as the current AI provider choice. The repository already uses Google ADK and supports Google Gemini models and embeddings.
- [ ] Confirm whether the required deployment target is Google Cloud Vertex AI or Google AI Studio/Gemini API.
- [ ] Decide whether Qdrant remains local for development or is deployed as a managed/hosted service.
- [ ] Keep Confluence as an optional reporting destination, separate from the required evaluation output.

## Dataset and evaluation

- [x] Obtain the prepared dataset folder at `C:\Users\User\Downloads\sdoc-hackathon-docker`.
- [x] Confirm the dataset layout: `data_v2/inbox/`, `data_v2/attachments/`, `sample_submission.json`, and `server/loader.py`.
- [x] Inspect representative normal and edge-case records, including `email_004` and `email_501`.
- [x] Inventory the supplied data: 520 emails and 250 attachments (192 TXT, 28 PDF, 22 XLSX, 8 DOCX).
- [x] Support both dataset access modes: static files and the local Docker server at `http://localhost:8080`.
- [x] Generate one output object for every `email_id`.
- [x] Submit results through `POST /submit` or `inbox.submit(...)`.
- [x] Record self-evaluation scores and investigate classification or discrepancy errors.

## Do this first

- [x] Create a small dataset adapter that reads the supplied `data_v2/inbox/` records and resolves attachment paths.
- [x] Build a plain-text-only baseline for the 192 `.txt` attachments before adding PDF, DOCX, or XLSX parsing.
- [x] Implement classification as a standalone function and test it against one example from each category.
- [x] Implement extraction and comparison for the seven fields on one known SI/BL pair.
- [x] Generate a valid submission for all 520 emails, using `GENERAL`/`OK` only as a temporary fallback for unimplemented cases.
- [x] Start the supplied Docker server and submit the baseline to `/submit` to establish a score.

Do not start with Google ADK, Qdrant, Confluence, OCR, or a multi-agent graph. First make the local batch pipeline correct and measurable; add agents and cloud services around the verified comparison core afterward.

## Basic workflow

- [x] Add an inbox loader for JSON email records.
- [x] Define the five categories: document comparison, new SI request, invoice query, general message, and spam.
- [x] Implement email classification with a confidence and review reason.
- [x] Route only document-comparison requests to document checking.
- [x] Resolve and read the referenced SI and BL attachments.
- [x] Define a typed shipment schema for the seven required fields.
- [x] Extract shipper, consignee, notify party, port of loading, port of discharge, container count, and gross weight in kilograms.
- [x] Normalize field labels, whitespace, case, punctuation, port aliases, container counts, and weight units.
- [x] Compare SI values against BL values, using SI as the reference.
- [x] Report only mismatched fields with side-by-side SI and BL values.
- [x] Return `No mismatch detected.` when all seven fields match.
- [x] Produce the required submission JSON shape.

## Reliability and human review

- [x] Escalate missing attachments, missing required fields, unreadable documents, ambiguous extraction, and processing failures.
- [x] Include `email_id`, category, reason, source attachments, extracted values, and evidence in review cases.
- [ ] Avoid making a mismatch decision when extraction confidence is insufficient.
- [ ] Add retry handling for recoverable attachment and model failures.
- [x] Add an upload API that stores new emails and attachments, runs verification, and returns a report.
- [x] Add a review result path that accepts human corrections and persists the corrected submission record.

## Advanced challenge

- [x] Test PDF attachments and Word attachments, including tables and varied layouts.
- [x] Add XLSX attachment text extraction for workbook rows.
- [x] Add optional OCR processing for scanned/image-only documents; Tesseract remains a machine prerequisite.
- [ ] Test misleading subjects, varied labels, formatting differences, and missing attachments.
- [x] Compare extraction quality against the plain-text baseline before enabling advanced processing by default.

## Testing

- [ ] Add fixtures for every email category.
- [ ] Add extraction tests for all seven fields and common label variants.
- [ ] Add comparison tests for exact matches, real mismatches, numeric formatting, units, and missing values.
- [ ] Add escalation tests for unreadable and incomplete inputs.
- [x] Add an end-to-end test from inbox record to submission JSON.
- [x] Keep the existing test suite passing with `python -m pytest -q`.

## Recommended architecture

Use agents for classification, extraction, evidence explanation, and human-review summaries. Use deterministic Python for field normalization, SI/BL comparison, output validation, and submission generation. RAG/Qdrant should support evidence retrieval where useful, but should not replace the comparison rules.
