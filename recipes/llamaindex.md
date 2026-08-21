---
id: llamaindex
name: LlamaIndex (LlamaParse Document Parsing)
version: 1.0.0
description: |
  Adds skills/llamaindex-parse to the skillpack: high-fidelity document
  parsing/OCR (130+ formats) via LlamaParse, LlamaIndex's hosted document
  agent platform, called directly over its public HTTP API. LlamaIndex's core
  Python framework (indices, retrievers, query engines) is not ported —
  gbrain already has its own hybrid RAG search engine (see brain-ops, query
  skills) and gbrain's runtime is Bun/TypeScript only, with no Python
  interpreter. LlamaParse is the one piece of the LlamaIndex ecosystem that
  is a plain HTTP API and therefore genuinely portable into gbrain as-is.
category: act
requires: []
secrets:
  - name: LLAMA_CLOUD_API_KEY
    description: LlamaCloud API key (starts with `llx-`), from cloud.llamaindex.ai -> API Keys
    where: "~/.gbrain/integrations/llamaindex/session.json (never a brain page)"
health_checks:
  - type: http
    url: "https://api.cloud.llamaindex.ai/api/parsing/supported-file-extensions"
    label: "LlamaParse API"
setup_time: 5 min
cost_estimate: "Free tier: 1,000 pages/day. Paid: metered per page beyond that -- see cloud.llamaindex.ai/pricing"
---

# LlamaIndex: LlamaParse Document Parsing

## Why this, and not the rest of LlamaIndex

[LlamaIndex](https://github.com/run-llama/llama_index) is a large Python
framework for building RAG applications: data connectors, indices, retrievers,
query engines, agents. Almost all of that is Python-only — `llama-index-core`
and its 300+ integration packages assume a Python interpreter, `pip`, and (for
most backends) real API keys for whichever LLM/embedding/vector-store the
integration wraps.

**gbrain's runtime is Bun/TypeScript, with no Python interpreter**, and gbrain
already ships its own hybrid RAG search engine (brain-first lookup, 3-layer
search, citation propagation — see `skills/brain-ops/SKILL.md` and
`skills/query/SKILL.md`). Re-implementing LlamaIndex's Python indexing stack
inside gbrain would duplicate that, not extend it.

What *is* directly usable: **LlamaParse**, LlamaIndex's hosted document-parsing
platform, which is a plain authenticated HTTP API — no Python required. It
does agentic OCR/parsing across 130+ formats (scanned PDFs, complex tables,
slide decks, spreadsheets) at a quality most local parsers can't match. That's
a real capability gap gbrain doesn't otherwise fill, so this recipe adds it as
`skills/llamaindex-parse/SKILL.md` — a utility skill gbrain's own ingestion
skills (`media-ingest`, `book-mirror`, `article-enrichment`) can call when they
hit a document that needs better-than-default parsing.

## What this adds

| File | Purpose |
|------|---------|
| `skills/llamaindex-parse/SKILL.md` | Parse a document into clean Markdown/text via LlamaParse's HTTP API |

## Setup

### Step 1: Get an API key

Sign up at [cloud.llamaindex.ai](https://cloud.llamaindex.ai) (free tier: 1,000
pages/day) and create an API key under Settings → API Keys. This is a
**mutating, user-facing step** — never invent a key or ask the user for one
speculatively; only do this when the user actually wants document parsing.

### Step 2: Store it

```bash
mkdir -p ~/.gbrain/integrations/llamaindex
echo '{"api_key": "llx-..."}' > ~/.gbrain/integrations/llamaindex/session.json
```

Never write the key into a brain page or print it in full in chat output.

### Step 3: Health check

```bash
curl -sf https://api.cloud.llamaindex.ai/api/parsing/supported-file-extensions > /dev/null \
  && echo "PASS: LlamaParse API reachable" \
  || echo "FAIL: could not reach api.cloud.llamaindex.ai -- check network/DNS"
```

### Step 4: Verify the key

```bash
curl -sf -H "Authorization: Bearer $LLAMA_CLOUD_API_KEY" \
  https://api.cloud.llamaindex.ai/api/parsing/supported-file-extensions \
  && echo "PASS: key valid" \
  || echo "FAIL: key invalid or missing -- re-run Step 1"
```

## Safety notes (read before enabling)

- **Third-party upload.** Every parse sends the file's full contents to
  LlamaCloud's servers. Confirm with the user before parsing anything
  sensitive (secrets, medical/legal/financial records) — this is not a local
  operation.
- **Costs money past the free tier.** 1,000 pages/day is free; beyond that it's
  metered. Tell the user the rough page count before parsing a large batch.
- **Not a brain-writing skill.** `llamaindex-parse` returns text; it never
  files a brain page itself. The calling ingestion skill still applies
  gbrain's normal quality/filing gates.
- **Key handling.** Store the API key outside the brain repo's synced content
  (`~/.gbrain/integrations/llamaindex/`, not a brain page), and never print it
  in full in chat output.

## Troubleshooting

- **401 on every call:** key missing or invalid; re-run Step 1/Step 2.
- **Job stuck in `PENDING` for minutes:** large or complex documents (scanned
  handwriting, huge slide decks) can genuinely take a few minutes — this is
  expected, not a bug. If it never resolves, check LlamaCloud's status page.
- **Parsed output looks worse than expected:** try adding a
  `parsing_instruction` hint (e.g. "extract this table exactly as rows and
  columns") — LlamaParse responds well to natural-language steering.
- **Rate limited:** free tier is 1,000 pages/day; confirm the user isn't
  hitting that ceiling before assuming a bug.
