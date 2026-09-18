# Multi-Agentic RAG FYP

## Shipping verification project scope

The target workflow is an inbox-to-discrepancy-report system. The prepared dataset contains JSON inbox records and the SI/BL attachments referenced by those records. The expected workflow is:

1. classify every email as a document-comparison request, new SI request, invoice query, general message, or spam;
2. for comparison requests, read the SI and BL attachments;
3. extract and compare shipper, consignee, notify party, port of loading, port of discharge, container count, and gross weight in kilograms;
4. report mismatches side by side, or `No mismatch detected.` when all seven fields match; and
5. escalate missing, unreadable, incomplete, or uncertain cases for human review.

See [TODO.md](TODO.md) for the implementation checklist.

### Cloud provider decision

The current repository choice is **Google**: Google ADK orchestrates the agents, and Google Gemini is the default LLM and embedding provider. The code also supports Ollama for local model execution. The problem statement does not mandate a cloud provider, so confirm whether the project requirement is specifically **Google Cloud Vertex AI** or the **Google Gemini API/AI Studio**. Qdrant and Confluence are separate services and are not the AI cloud provider.

### Prepared dataset

The challenge data is expected as a static bundle or through the local Docker server. The bundle contains `inbox/`, `attachments/`, `sample_submission.json`, and `loader.py`. The local server is expected at `http://localhost:8080`; results can be checked through `POST /submit` or `inbox.submit(...)`. The dataset should be treated as the source for the verification pipeline, while the existing RAG knowledge files remain useful for the separate retrieval demonstration.

### Run the shipping verifier

Using the supplied static dataset:

```powershell
.\\.venv\\Scripts\\python.exe -m agents.shipping.baseline `
	C:\\Users\\User\\Downloads\\sdoc-hackathon-docker\\data_v2 `
	.artifacts\\final-submission.json
```

The adapter also supports the Docker server at `http://localhost:8080`:

```powershell
.\\.venv\\Scripts\\python.exe -c "from agents.shipping.tool import run_shipping_verification; print(run_shipping_verification('http://localhost:8080', '.artifacts/http-submission.json'))"
```

In ADK Web, you can simply ask: `Run shipping document verification on the challenge dataset and generate the submission JSON.` The tool defaults to `http://localhost:8080`.

Submit a generated result to the local evaluator:

```powershell
Invoke-RestMethod -Uri http://localhost:8080/submit -Method Post `
	-ContentType 'application/json' -InFile .artifacts\\final-submission.json
```

### Accept new shipping uploads

Start the upload API:

```powershell
.\\.venv\\Scripts\\python.exe -m uvicorn agents.shipping.api:app --reload --port 8090
```

Open `http://localhost:8090` for the upload dashboard. It displays verification status, side-by-side SI/BL fields, differences, review reasons, and a correction action.

The dashboard's **Process inbox** action processes every email from `SHIPPING_DATA_ROOT` (default: `http://localhost:8080`), stores each result in the case queue, and keeps source failures visible as `UNPROCESSED`. The same operation is available through `POST /inbox/process`; pass `{"data_root":"C:\\path\\to\\data_v2"}` for a static dataset. Add `{"include_ai":true}` when bulk AI explanations are desired.

When `GOOGLE_API_KEY` is configured, each uploaded case also receives a Gemini explanation and the dashboard chat can answer questions through `POST /chat/{email_id}`. Gemini explains and assists; the deterministic verifier remains the final authority for status and defect fields.

Upload an email and its SI/BL attachments:

```powershell
curl.exe -X POST http://localhost:8090/verify `
	-F "email_id=email_new_001" `
	-F "sender=docs@example.com" `
	-F "subject=TO CONFIRM DOCS" `
	-F "body=Please compare the SI and draft BL." `
	-F "attachments=@C:\\path\\email_new_001_SI.txt" `
	-F "attachments=@C:\\path\\email_new_001_BL.txt"
```

The response contains the generated report and saved report path. Reviewers can persist a correction with `POST /reviews/{email_id}` using a JSON body containing `category`, `status`, `review_reason`, `has_defect`, and `defect_fields`.

The verifier supports TXT, PDF, DOCX, and XLSX attachments. Image-only PDFs use OCR through Tesseract; if OCR fails, the case is escalated for review.

```mermaid
flowchart LR
		A[Inbox JSON or HTTP API] --> B[Classifier]
		B -->|BL comparison| C[Attachment reader]
		C --> D[Field extraction and normalization]
		D --> E[Deterministic SI vs BL comparison]
		E --> F[Submission or review evidence]
		B -->|Other categories| F
```

This project is a Google ADK multi-agent retrieval system that:

- ingests local documents into Qdrant
- chunks content with hybrid chunking (structure-aware + semantic boundaries)
- embeds chunks with Google Gemini embeddings
- retrieves relevant context for grounded answers
- prepares Confluence publish payloads
- supports optional Confluence MCP bridge or direct REST publishing

## Prerequisites

- Python 3.10+
- Docker Desktop (for the local Qdrant container)
- A Google API key for Gemini embeddings
- Optional: Confluence credentials if you want direct publishing
- Optional: Atlassian MCP server if you want the MCP bridge

## 1. Create your local environment

From the project root, create a virtual environment and install dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -U pip
.\.venv\Scripts\pip install -r requirements.txt
```

Then create your local environment file from the example template:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace the placeholders with your own values.

> Important: do not commit the real `.env` file. Keep secrets in your local machine only.

The project already supports loading environment variables from either the workspace root `.env` or `agents/.env`.

## 2. Start Qdrant locally

If you are using the local Docker-based setup, start Qdrant like this:

```powershell
docker run -p 6333:6333 -v ${PWD}\.qdrant:/qdrant/storage qdrant/qdrant
```

You can also point `QDRANT_URL` at a remote Qdrant instance if you prefer.

Check that the local endpoint is reachable:

```powershell
Test-NetConnection localhost -Port 6333
```

## 3. Run a smoke check

```powershell
.\.venv\Scripts\python -m agents.eval.smoke
```

This command validates that the chunking path and publish payload preparation work with the current configuration.

## 4. Ingest knowledge documents

The project includes a sample knowledge file and evaluation dataset:

- `agents/tools/knowledge/data.md`
- `agents/tools/knowledge/dataset.csv`

Run ingestion like this:

```powershell
.\.venv\Scripts\python -m agents.eval.ingest agents/tools/knowledge/data.md
```

Optional: disable semantic chunking and use the fallback fixed-size chunker:

```powershell
.\.venv\Scripts\python -m agents.eval.ingest agents/tools/knowledge/data.md --no-semantic
```

## 5. Run retrieval evaluation

First make sure your evaluation dataset has cases in `agents/tools/knowledge/dataset.csv`.

Then run:

```powershell
.\.venv\Scripts\python -m agents.eval.ragas
```

This writes a report to `.artifacts/retrieval-report.json`.

## 6. Start the ADK web app

```powershell
.\.venv\Scripts\adk web
```

Then open the local URL shown in the terminal (typically `http://127.0.0.1:8000`).

## 7. Optional: publish to Confluence

The project supports two publish paths:

- direct REST publishing using `CONFLUENCE_BASE_URL`, `CONFLUENCE_EMAIL`, and `CONFLUENCE_API_TOKEN`
- optional MCP bridge using `CONFLUENCE_MCP_URL` or `CONFLUENCE_MCP_COMMAND`

The direct publish helpers default to a `dry_run` preview, so you can validate the generated payload before writing to Confluence.

## 8. Environment variables

The project expects the following variables in `.env`:

```dotenv
GOOGLE_GENAI_USE_ENTERPRISE=0
GOOGLE_API_KEY=your_google_api_key_here

EMBEDDING_PROVIDER=google
EMBEDDING_MODEL=gemini-embedding-001
EMBEDDING_DIM=768

QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
QDRANT_COLLECTION=multi_agentic_rag

CONFLUENCE_BASE_URL=https://your-company.atlassian.net/wiki
CONFLUENCE_EMAIL=you@example.com
CONFLUENCE_API_TOKEN=your_confluence_api_token_here
CONFLUENCE_SPACE_KEY=YOUR_SPACE_KEY
CONFLUENCE_PARENT_ID=

ATLASSIAN_MCP_URL=
CONFLUENCE_MCP_URL=
CONFLUENCE_MCP_COMMAND=
CONFLUENCE_MCP_ARGS=
```

A reusable skeleton is already provided in `.env.example`.

## 9. Common troubleshooting

### `Missing required environment variable`

Make sure you copied `.env.example` to `.env` and filled in the real values.

### `Connection refused` to Qdrant

Check that Docker Desktop is running and that the Qdrant container is started on port `6333`.

### Embedding API errors

Verify that `GOOGLE_API_KEY` is valid and that `EMBEDDING_MODEL` matches a supported model.

### `adk web` fails to start

Make sure the virtual environment is active and dependencies were installed from `requirements.txt`.

## Main workflow summary

1. create `.env` from `.env.example`
2. start Qdrant
3. run `python -m agents.eval.smoke`
4. run `python -m agents.eval.ingest agents/tools/knowledge/data.md`
5. run `python -m agents.eval.ragas`
6. start `adk web`

This is the recommended local setup for running the project on a fresh machine.
