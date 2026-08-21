---
name: llamaindex-parse
version: 1.0.0
description: |
  Parse documents (PDF, DOCX, PPTX, images, spreadsheets, and 130+ other formats)
  into clean Markdown or plain text via LlamaParse (LlamaIndex's hosted document
  agent platform), using its public HTTP API directly — no Python runtime
  required. Use when gbrain's own ingestion skills (media-ingest, book-mirror,
  article-enrichment) hit a document that needs high-fidelity OCR/parsing before
  it can be filed as a brain page.
triggers:
  - "parse this PDF with LlamaParse"
  - "OCR this document"
  - "llama parse"
  - "high-fidelity document parsing"
  - "this PDF's text extraction is garbled"
tools:
  - http_fetch
mutating: false
---

# LlamaParse Document Parsing

Requires a LlamaCloud API key (`LLAMA_CLOUD_API_KEY`, prefix `llx-`) — see
`recipes/llamaindex.md` for signup and storage.

This skill is a **parsing utility**, not a brain-writing skill. It converts a
document into clean text/Markdown; the calling skill (`media-ingest`,
`book-mirror`, `article-enrichment`, etc.) is responsible for filing the result
into the brain per gbrain's usual quality gates.

## Contract

This skill guarantees:

- Never invents or guesses the API key; if unset, tell the user how to get one
  (see recipe) rather than failing silently or trying a hardcoded key.
- Every call is a parse job against the user's own LlamaCloud account — this
  costs the user's parsing credits. Confirm with the user before parsing a
  large batch (>5 files) or a very large file (>50 pages), since credits are
  metered per page.
- The uploaded file leaves the user's environment and is sent to LlamaCloud's
  servers. Flag this once per session before the first upload — some documents
  (e.g. anything containing secrets, medical/legal records) may not be
  appropriate to send to a third party without the user's explicit OK.
- This skill never falls back to a different parser silently; if LlamaParse
  fails or times out, report the failure and let the user decide whether to
  retry, wait, or use gbrain's built-in ingestion instead.

## Phases

1. **Confirm scope.** For >5 files or a single file >50 pages, tell the user
   the approximate page/credit cost and confirm before proceeding.
2. **Upload.** `POST /api/parsing/upload` (multipart/form-data, field `file`),
   header `Authorization: Bearer <LLAMA_CLOUD_API_KEY>`. Optional form fields:
   `parsing_instruction` (natural-language hint, e.g. "this is a scanned
   invoice, extract the table"), `result_type` (`markdown` default, or `text`).
   Response: `{"id": "<job_id>", "status": "PENDING"}`.
3. **Poll.** `GET /api/parsing/job/{job_id}` every 3-5s until `status` is
   `SUCCESS` or `ERROR`. Back off if it runs past ~60s (large/complex docs can
   take minutes) — do not hand-roll an unbounded tight loop; a handful of
   polls with waits between them is fine for a single foreground parse.
4. **Fetch result.** `GET /api/parsing/job/{job_id}/result/markdown` (or
   `/result/text`). Response: `{"markdown": "..."}` / `{"text": "..."}`.
5. **Hand off.** Pass the returned text to the ingestion skill that requested
   it (or, if invoked directly, summarize and ask the user where it should be
   filed — never write it to the brain without going through
   `brain-ingest-gate`/`repo-architecture` filing rules).

## Output Format

Confirm job status, page/credit cost if known, and either the parsed
Markdown/text (for a short document) or a summary + offer to file it (for a
long one) — never a raw JSON dump.

## Anti-Patterns

- Guessing or hardcoding an API key.
- Uploading a batch of files without telling the user the credit cost first.
- Polling faster than every ~3 seconds or looping unboundedly without
  surfacing progress.
- Writing the parsed output straight into a brain page without going through
  gbrain's normal filing/quality gates.
- Treating a parse failure as ingestion failure — report it distinctly so the
  user can choose to fall back to gbrain's own `media-ingest` parsing.

## Tools Used

- `http_fetch` — `https://api.cloud.llamaindex.ai/api/parsing/*`. Requires
  `Authorization: Bearer {LLAMA_CLOUD_API_KEY}`.

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/parsing/upload` | Upload a file, start a parse job |
| GET | `/api/parsing/job/{job_id}` | Poll job status |
| GET | `/api/parsing/job/{job_id}/result/markdown` | Fetch parsed Markdown |
| GET | `/api/parsing/job/{job_id}/result/text` | Fetch parsed plain text |
