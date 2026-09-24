# Shipping Document Verification TODO

## Project decisions

- [x] Use Google as the current AI provider choice. The repository already uses Google ADK and supports Google Gemini models and embeddings.
- [ ] Confirm whether the required deployment target is Google Cloud Vertex AI or Google AI Studio/Gemini API.
- [ ] Decide whether Qdrant remains local for development or is deployed as a managed/hosted service.

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

The local batch pipeline is the verification baseline; agents, OCR, and retrieval services are optional layers around that verified comparison core.

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

## improvement/standout

These improvements are prioritized to make the demo distinctive beyond a standard ETL pipeline and generic chatbot.

### Priority 1: Prove normalization and false-alarm avoidance

- [x] Add explicit unit conversion for weights, including kilograms, tonnes/metric tons, and common unit labels.
- [x] Record and display differences that were intentionally ignored, such as equivalent labels, formatting, punctuation, case, port aliases, and converted units.
- [x] Show a concise `Differences ignored` section in each comparison report.
- [x] Add tests for `22,000 KG` versus `22 MT`, equivalent labels such as `Load Port` versus `Port of Loading`, and punctuation/case variations.

### Priority 2: Make evidence inspectable

- [x] Store source evidence for each extracted field with attachment, page number, source text, and coordinates when available.
- [x] Add PDF page extraction with PyMuPDF text coordinates for field-level evidence.
- [x] Let a reviewer click a field to open the SI and BL source evidence side by side.
- [x] Highlight the SI blueprint evidence and the corresponding BL value in the evidence viewer.
- [x] Keep plain-text evidence as a fallback for TXT, DOCX, XLSX, and documents without usable coordinates.

### Priority 3: Turn chatbot answers into workflow actions

- [] Add a proposal-only shipping-actions sub-agent and website action-preview endpoint.
- [] Draft correction emails with recipient, subject, mismatched fields, SI values, BL values, and requested correction.
- [] Preview accepting a difference as a false alarm through the existing review workflow.
- [] Preview a targeted re-read request for one field, such as BL gross weight or container count.
- [] Require explicit confirmation before changing a report or sending/persisting an email draft.
- [ ] Connect natural-language chatbot intent detection directly to the action-preview endpoint.

### Priority 4: Cross-check difficult documents

- [x] Add an independent vision-based reader for scanned or low-confidence documents.
- [x] Compare OCR and vision readings field by field.
- [x] Mark a field high-confidence only when independent readers agree.
- [x] Escalate disagreements with both readings visible to the reviewer.
- [ ] Add tests for scanned, rotated, low-quality, and partially unreadable documents.

### Priority 5: Demonstrate adversarial reliability

- [ ] Create a small adversarial fixture set with misleading subjects, missing attachments, wrong document types, rotated scans, unit differences, blank fields, and extra attachments.
- [ ] Run the adversarial fixture set as part of the test suite.
- [ ] Produce a demo scoreboard showing automatic matches, real mismatches, human-review escalations, and false mismatch decisions.
- [ ] Record the original failure, the fix, and the resulting test outcome for each hard case.
- [ ] Add a short README/demo walkthrough showing the hardest cases end to end.

### Priority 6 Add optional manager orchestration and RAG

- [x] Add a manager workflow that routes shipping exceptions to inspection and review guidance.
- [x] Keep deterministic SI/BL comparison as the source of truth.
- [ ] Add structured hand-off schemas between manager and specialist agents.
- [x] Add RAG retrieval for field aliases, carrier templates, unit rules, and approved corrections.
- [ ] Make agent/RAG orchestration optional through configuration.
- [ ] Ensure the system works when the LLM or vector database is unavailable.
- [ ] Add integration tests proving agent output cannot override deterministic status.

### how to handle edge case if SI is the missing value?

- make a pop out email draft if SI is missing.

### btw face two of hackathon

- jack make the end to end email
- when the scanning of PDF make sure it will shows the result of the VLLM actually in use
-

### UI updates

- shows the correction documentation for version control
- CHANGE THE ENTIRE UI/UX
- alot of testing

- Edit Extracted Ground-Truth Values drop down should be opened by default
- For general inquiries AI summary below email body
- Email category should not be drop down
- update the Open Review & Ai workspace -- draft email
- Operations tab - how we gonna improve it
- dashboard so we can easily categorise stuff instead of stuffing everything all at once

- add a archive to store old ass email so that it wont piles up on the dashboard when the user load up, add it's own supportive AI to help search the archive.
