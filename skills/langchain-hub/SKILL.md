---
name: langchain-hub
version: 1.0.0
description: |
  Growing hub skill for LangChain-ecosystem HTTP APIs that are genuinely
  callable from gbrain's Bun/TypeScript runtime with no Python interpreter:
  LangSmith (tracing/eval, hosted SaaS) today, LangGraph Platform (deployed
  agent runs, conditional on the user having a deployment) also today. This
  is a single deliberately-extendable file -- new LangChain-ecosystem HTTP
  capabilities get appended here as new "## Capability" sections rather than
  spawning a new skill folder each time. See "Extending this file" at the
  bottom before adding a capability.
triggers:
  - "langchain"
  - "log this run to LangSmith"
  - "trace this with LangSmith"
  - "LangSmith eval"
  - "run my LangGraph deployment"
  - "call my langgraph agent"
  - "LangGraph Platform"
  - "does gbrain support langchain"
tools:
  - http_fetch
mutating: true
---

# LangChain Ecosystem Hub

Requires a LangSmith API key (`LANGSMITH_API_KEY`) for Capability A, and
(optionally, only if the user has actually deployed a graph) a LangGraph
Platform deployment URL + key for Capability B — see `recipes/langchain.md`
for signup and storage.

This skill is marked `mutating: true` because Capability B can execute a
user-authored agent graph with real side effects. Capability A alone
(tracing/eval) is low-risk, closer to logging — but the file-level flag stays
conservative since both capabilities share this file.

## Contract

This skill guarantees:

- Never invents or guesses an API key; if unset, point the user at
  `recipes/langchain.md` rather than failing silently.
- Never calls LangGraph Platform (Capability B) against a graph the user
  hasn't explicitly named/confirmed for this session — an agent run can take
  real actions depending on what that graph does, so this is treated like any
  other mutating, consequential action gbrain gates.
- LangSmith calls (Capability A) are additive telemetry only — they never
  block or alter the underlying operation being traced; a failed trace call
  is reported once and otherwise ignored, never retried in a tight loop.
- Never fabricates trace/eval data. If asked to "log this run" and no real
  run data exists yet, say so instead of inventing plausible-looking output.

## Capability A: LangSmith Tracing & Evaluation

Stable, hosted, low-risk. LangSmith is LangChain's tracing/eval/observability
SaaS with a plain REST API — no Python or the `langchain` package required.

### Phases

1. **Confirm scope.** Tracing a single run is fine to do without asking;
   creating a new eval dataset/experiment, or posting feedback that will be
   visible to a team, is worth a one-line confirmation first.
2. **Create/update a run.** `POST /runs` to start a trace, `PATCH
   /runs/{run_id}` to close it out with outputs/end time. A "run" here means
   any traceable unit of work the user wants visibility into (an agent step,
   a tool call, a full task) — not necessarily a LangChain-authored chain.
3. **Query runs.** `POST /runs/query` with filters (project, time range,
   status) to look up past traces when the user asks "what happened in that
   run."
4. **Evaluate.** `POST /sessions` to create an experiment, `GET
   /examples?dataset={id}` to pull dataset examples, `POST /feedback` to
   attach a score/label to a run.

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/runs` | Start a trace for a run |
| PATCH | `/runs/{run_id}` | Update/close a trace |
| POST | `/runs/query` | Query past runs |
| POST | `/sessions` | Create an experiment |
| GET | `/examples?dataset={id}` | Fetch dataset examples |
| POST | `/feedback` | Attach score/label feedback to a run |

Base URL: `https://api.smith.langchain.com/api/v1` (self-hosted/regional
deployments use a different base — check the user's `session.json`). Auth
header: `x-api-key: {LANGSMITH_API_KEY}`. Full schema:
`https://api.smith.langchain.com/docs`.

## Capability B: LangGraph Platform — Deployed Agent Runs

Conditional — only usable if the user has already deployed a graph to
LangGraph Platform (via LangChain, Python or JS). This skill does not author
or deploy graphs; it only invokes ones that already exist.

### Phases

1. **Confirm the target.** Ask (or read from `session.json`) which
   deployment URL and which assistant/graph the user means. Never guess.
2. **Create or resume a thread.** `POST /threads` for a new conversation
   thread, or reuse an existing `thread_id` the user gives.
3. **Run it.** `POST /threads/{thread_id}/runs` (or `/runs/stream` for
   streaming) with the input payload the graph expects. This is the
   consequential step — the graph can call tools, hit external services, or
   take actions defined in its own logic, which gbrain has no visibility
   into ahead of time. Tell the user what's about to run before triggering
   it if the graph's purpose isn't already obvious from context.
4. **Report the result.** Summarize the run's output; on failure, surface
   the actual error rather than a generic "something went wrong."

### API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/assistants/search` | List available assistants/graphs on this deployment |
| POST | `/threads` | Create a conversation thread |
| POST | `/threads/{thread_id}/runs` | Run the graph on a thread |
| POST | `/threads/{thread_id}/runs/stream` | Same, streamed |
| GET | `/threads/{thread_id}/state` | Read current thread state |

Base URL is deployment-specific (a local dev server, e.g.
`http://localhost:8124`, or the user's LangGraph Cloud deployment URL — never
assume one). Auth header: `X-Api-Key: {LANGSMITH_API_KEY}` (LangGraph
Platform reuses LangSmith keys). Full schema:
`https://docs.langchain.com/langsmith/server-api-ref`.

## Output Format

State which capability handled the request, the outcome (trace logged / eval
created / graph run result), and any follow-up the user needs to take
(e.g. a LangSmith project URL to view the trace) — never a raw JSON dump.

## Anti-Patterns

- Guessing or hardcoding an API key or a LangGraph deployment URL.
- Triggering a LangGraph Platform run (Capability B) without confirming
  which graph/deployment and, when its purpose isn't obvious, what it does.
- Retrying a failed LangSmith trace call in a tight loop — log once, move on.
- Fabricating trace, eval, or run output when no real data exists.
- Treating this skill as a way to run arbitrary LangChain Python code —
  it only reaches hosted HTTP APIs, never a Python interpreter (gbrain has
  none).

## Tools Used

- `http_fetch` — `https://api.smith.langchain.com/api/v1/*` (Capability A);
  the user's own LangGraph Platform deployment host (Capability B).

## Extending this file

This file is intentionally one growing skill rather than a folder-per-service
split, per how the LangChain ecosystem integration was scoped. When adding a
new LangChain-ecosystem HTTP capability (e.g. a future hosted LangGraph
Studio API, a new LangSmith endpoint surface):

1. Add a new `## Capability <Letter>: <Name>` section in the same shape as
   A/B above (Phases, API Reference).
2. Add any new trigger phrases to the frontmatter `triggers` list.
3. Add any new required tools to `tools` (stay `http_fetch`-only unless a
   capability genuinely needs something else — that's a sign it may deserve
   its own skill file instead of living here).
4. If the new capability is read-only/low-risk, note that explicitly in its
   own section rather than downgrading the file-level `mutating: true` — one
   risky capability in the file means the file stays conservative.
5. Update `recipes/langchain.md` with any new secret/health-check the
   capability needs.

Do not use this file as a place to reimplement LangChain's Python (or even
JS) internals — chains, agents, LCEL, retrievers. If a future need requires
actually running LangChain code, that's an npm dependency question for
gbrain's own codebase (the official `langchain` / `@langchain/core` packages
are real, Bun-compatible TS packages — see `recipes/langchain.md` for why
that path was deliberately not taken here), not something this skill format
can do.
