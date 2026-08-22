---
id: langchain
name: LangChain Ecosystem (LangSmith + LangGraph Platform)
version: 1.0.0
description: |
  Adds skills/langchain-hub to the skillpack: a single, deliberately-growing
  skill covering the parts of the LangChain ecosystem that are plain hosted
  HTTP APIs -- LangSmith (tracing/eval) and LangGraph Platform (deployed
  agent runs) -- callable from gbrain's Bun/TypeScript runtime with no
  Python interpreter and without adding langchain/@langchain packages as a
  gbrain dependency. LangChain's own chain/agent/retriever internals are not
  ported; gbrain has its own skill-based orchestration model already.
category: act
requires: []
secrets:
  - name: LANGSMITH_API_KEY
    description: LangSmith API key, from smith.langchain.com -> Settings -> API Keys
    where: "~/.gbrain/integrations/langchain/session.json (never a brain page)"
  - name: LANGGRAPH_DEPLOYMENT_URL
    description: Optional. Base URL of a LangGraph Platform deployment the user already runs, only needed for Capability B (agent runs). Reuses LANGSMITH_API_KEY for auth.
    where: "~/.gbrain/integrations/langchain/session.json"
health_checks:
  - type: http
    url: "https://api.smith.langchain.com/api/v1/info"
    label: "LangSmith API"
setup_time: 5 min (LangSmith only); +10 min if also wiring up LangGraph Platform
cost_estimate: "LangSmith: free tier covers personal/dev use (check smith.langchain.com/pricing for current limits). LangGraph Platform: only relevant if the user already pays for a deployment -- this recipe doesn't create one."
---

# LangChain Ecosystem: LangSmith + LangGraph Platform

## Why this, and not the rest of LangChain

[LangChain](https://github.com/langchain-ai/langchain) is unusual among the
frameworks integrated this round: unlike LlamaIndex, it has an **official,
actively maintained TypeScript port** —
[langchainjs](https://github.com/langchain-ai/langchainjs), published as the
`langchain` / `@langchain/core` npm packages, and it's genuinely
Bun-compatible in principle (pure JS/TS, no native Python bindings). So the
"can't port it, wrong runtime" reasoning that applied to LlamaIndex and
AutoGen does *not* fully apply here.

That said, this recipe deliberately does **not** add `langchain` /
`@langchain/core` as an npm dependency of gbrain itself. gbrain's own
philosophy is "thin harness, fat skills, markdown as recipes" — the engine
(`src/core/engine.ts`) is not the place external platform integrations live,
and gbrain already has its own orchestration model (skills + recipes +
`brain-ops`/`query` for RAG). Pulling in LangChain's own chain/agent/LCEL
runtime as a second, parallel orchestration layer inside the engine would
fight that architecture rather than extend it. If a future maintainer
decides gbrain's engine itself should depend on `@langchain/core` for a
specific capability, that's a deliberate engine-level architecture decision
to make explicitly — not something this skill-format integration should do
by default.

What this recipe *does* add: the two parts of the LangChain ecosystem that
are plain hosted HTTP APIs, reachable with `http_fetch` and zero new
dependencies —

- **LangSmith** — LangChain's tracing/eval/observability SaaS. Real,
  stable, hosted REST API.
- **LangGraph Platform** — hosted deployment/execution for agent graphs the
  user (or their team) has already built and deployed elsewhere. This
  recipe only lets gbrain *invoke* an existing deployment; it does not
  author or deploy graphs.

Both are documented as Capability A and B in
`skills/langchain-hub/SKILL.md`, which is written as a single growing file
(not a folder-per-capability split like the AI-Trader integration) since
more LangChain-ecosystem HTTP capabilities are expected to be added here
later — see that file's "Extending this file" section.

Note: **LangServe**, LangChain's older self-hosted deployment tool, was
deliberately excluded — it's been deprecated by LangChain itself since
November 2024 in favor of LangGraph Platform, and it requires the user to
run their own Python server anyway (no hosted API of its own).

## What this adds

| File | Purpose |
|------|---------|
| `skills/langchain-hub/SKILL.md` | LangSmith tracing/eval + LangGraph Platform agent-run invocation, over HTTP |

## Setup

### Step 1: Get a LangSmith API key

Sign up at [smith.langchain.com](https://smith.langchain.com) and create an
API key under Settings → API Keys. This is a **mutating, user-facing step**
— never invent a key or ask for one speculatively; only do this when the
user actually wants LangChain-ecosystem tracing/eval or LangGraph Platform
access.

### Step 2: Store it

```bash
mkdir -p ~/.gbrain/integrations/langchain
echo '{"api_key": "ls__..."}' > ~/.gbrain/integrations/langchain/session.json
```

### Step 3 (optional): Add a LangGraph Platform deployment

Only if the user already has one. Add its base URL to the same file:

```bash
python3 - <<'EOF'
import json, pathlib
p = pathlib.Path.home() / ".gbrain/integrations/langchain/session.json"
d = json.loads(p.read_text())
d["langgraph_deployment_url"] = "https://<their-deployment-host>"
p.write_text(json.dumps(d))
EOF
```

### Step 4: Health check

```bash
curl -sf https://api.smith.langchain.com/api/v1/info > /dev/null \
  && echo "PASS: LangSmith API reachable" \
  || echo "FAIL: could not reach api.smith.langchain.com -- check network/DNS"
```

### Step 5: Verify the key

```bash
curl -sf -H "x-api-key: $LANGSMITH_API_KEY" \
  https://api.smith.langchain.com/api/v1/info \
  && echo "PASS: key valid" \
  || echo "FAIL: key invalid or missing -- re-run Step 1"
```

## Safety notes (read before enabling)

- **Capability B can take real actions.** Invoking a LangGraph Platform run
  executes whatever agent logic the deployed graph contains — gbrain has no
  visibility into that logic ahead of time. Always confirm which
  deployment/graph and, if its purpose isn't obvious, what it does, before
  triggering a run.
- **Capability A is low-risk but not silent.** Tracing sends run
  metadata/inputs/outputs to LangSmith's servers — treat this like any
  other third-party data share; don't trace sensitive content without the
  user's awareness.
- **Key handling.** Store the key outside the brain repo's synced content
  (`~/.gbrain/integrations/langchain/`, not a brain page), never print it in
  full in chat output.
- **This is not a LangChain Python/JS runtime.** No chains, agents, or LCEL
  execute locally — only hosted HTTP endpoints are called.

## Troubleshooting

- **401 on every call:** key missing or invalid; re-run Step 1/Step 2.
- **LangGraph Platform calls fail with 404:** the deployment URL is wrong,
  or the assistant/graph ID doesn't exist on that deployment — use `POST
  /assistants/search` to list what's actually available.
- **Nothing shows up in the LangSmith UI after tracing:** check the project
  name in the run payload matches the project the UI is filtered to.
- **Rate limited:** check smith.langchain.com/pricing for current tier
  limits before assuming a bug.
