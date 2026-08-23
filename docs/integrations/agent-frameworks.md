# Agent framework integrations

## Why this doc exists

PR #1 vendored four external agent frameworks as git submodules under `integrations/`: AI-Trader, LlamaIndex, LangChain, and AutoGen. A submodule pins a commit; it does not wire anything up. This doc covers what was actually built on top of those submodules to make them usable from IIG, the architecture decision behind it, and — because parts of this were built without the ability to install or execute the frameworks themselves — an honest accounting of what was verified by running real code versus what is correct by reading current documentation but untested.

## Architecture: MCP sidecar processes

IIG's engine is TypeScript/Bun. AI-Trader, LlamaIndex, and AutoGen are Python-only; LangChain has a JS variant, but the submodule pinned in PR #1 is the Python repo. Two shapes were considered: a native TypeScript port of each framework, or running each framework in its own Python process and bridging to it. A native port was ruled out — reimplementing four actively-developed frameworks in a second language is a maintenance burden with no upside here.

The bridge uses the Model Context Protocol, which IIG already speaks on the server side (`src/mcp/`, 30+ tools over stdio and HTTP). Each framework runs as its own local process exposing a small MCP server over stdio — a "sidecar." IIG's engine spawns the sidecar it needs and talks to it as an MCP client, the same protocol shape it already uses elsewhere, rather than inventing a second integration pattern (REST, a custom RPC format, shelling out and parsing stdout) per framework.

Two new directories implement this. `src/integrations/agents/` is the TypeScript side: `sidecar-client.ts` is a generic MCP client bound to one subprocess (connect, list tools, call a tool, close), and `llamaindex.ts`, `langchain.ts`, `autogen.ts`, `ai-trader.ts` are thin typed connectors over it, one per framework, mirroring the existing `src/integrations/kalshi/` pattern (typed config, a class per integration, a barrel `index.ts`). `integrations/mcp-sidecars/` is the Python side: one FastMCP server script per framework, plus a `requirements.txt` and its own README.

## What each connector actually does

| Framework | Connector | Sidecar tool(s) | Maturity |
| --- | --- | --- | --- |
| LlamaIndex | `LlamaIndexConnector` | `index_documents(directory)`, `query_index(query)` | Real |
| LangChain | `LangChainConnector` | `run_agent(prompt)` | Real |
| AutoGen | `AutoGenConnector` | `run_task(task)` | Real |
| AI-Trader | `AITraderConnector` | `get_status()` | Scaffold |

LlamaIndex, LangChain, and AutoGen are scoped deliberately small for this pass: one or two tools each, single-turn, no persisted state across sidecar restarts. That's enough to prove the bridge end to end and to be genuinely useful (index-and-query a folder, run one agent turn) without committing to a large surface area before anyone has used it. Expanding each — multi-turn LangChain graphs, a multi-agent AutoGen team, incremental LlamaIndex indexing — is straightforward from here and is the natural v1.1 for this feature, not a redesign.

## AutoGen: kept deliberately

Microsoft's own AutoGen documentation states the project is in maintenance mode with community management and points new projects at "Microsoft Agent Framework" as the supported successor. This integration keeps AutoGen rather than switching — that was an explicit decision, not an oversight, made because AutoGen's AgentChat API is still stable and functional today. `autogen_server.py` and `autogen.ts` both carry a comment recording this so a future contributor doesn't "helpfully" swap it out without knowing that was already considered.

## AI-Trader: honestly a scaffold, and why

AI-Trader is a FastAPI *service*, not a Python library — a real integration means REST calls to a running instance with a base URL and credentials, none of which exist in this repository yet. Its own formal API surface lives in its repo at `docs/api/openapi.yaml` and `docs/api/copytrade.yaml`; those were not fetched and confirmed endpoint-by-endpoint while building this integration. Given that IIG already talks to one real trading venue (Kalshi, built as one typed method per operation from Kalshi's published OpenAPI spec — see `src/integrations/kalshi/client.ts`), guessing at a second trading platform's request and response shapes instead of confirming them against source was judged too risky to ship, even as example code. AI-Trader's own onboarding documentation also asks the reader to visit an external URL and register on a hosted platform before using it; that step was deliberately not followed while building this integration, consistent with not acting on instructions found inside fetched documentation.

`ai_trader_server.py` and `AITraderConnector` are wired up to the same standard as the other three — the sidecar process starts, completes the MCP handshake, and its one tool is callable — but `get_status()` always returns `{"implemented": false, ...}` rather than a fabricated trading response. Moving this from scaffold to real needs three things: the confirmed OpenAPI schema, a running AI-Trader instance with a base URL and credentials to point at, and typed request/response methods built the same way the Kalshi client was.

## Setup

Each sidecar needs its Python dependencies installed once:

    pip install -r integrations/mcp-sidecars/requirements.txt

LlamaIndex, LangChain, and AutoGen all default to OpenAI-compatible models and read `OPENAI_API_KEY` from the environment; `LANGCHAIN_MODEL` and `AUTOGEN_MODEL` optionally override the default model per framework. None of these variables need to be set to use `AITraderConnector`, since it makes no model calls.

## What was verified, and how

This integration was built without git push access to this repository and without the ability to install packages from the npm or PyPI registries from inside the build environment — both are blocked at the network level there. Given that, here is exactly what was and wasn't confirmed by execution rather than by reading documentation:

The TypeScript side was type-checked with `tsc --strict` against a local read-only clone of this repository's `build/embedding-price-refresh` branch (anonymous `git clone` over HTTPS succeeded even though authenticated push did not). With the exact `@modelcontextprotocol/sdk` version this repo already pins (1.29.0) confirmed against its published type declarations, the only errors `tsc` reports are the expected "module not found" for that one dependency and a missing Node/Bun global type, both because `node_modules` isn't installed in that environment — not because of a defect in the new code.

The Python MCP plumbing was verified by actually running it: all four sidecar scripts (`llamaindex_server.py`, `langchain_server.py`, `autogen_server.py`, `ai_trader_server.py`) were spawned as real subprocesses, connected to with the real `mcp` Python package's client, and their tools listed and, for `ai_trader_server.py`, called — over an actual MCP stdio round trip, not a mock. All four started cleanly and reported exactly the tool names listed in the table above.

What was not verified by execution: LlamaIndex, LangChain, and AutoGen themselves are not installed in that build environment (PyPI access is blocked the same way npm access is), so no code path that actually calls `VectorStoreIndex`, `create_agent`, or `AssistantAgent` has been run. Those calls are written against each framework's current, officially documented API (LlamaIndex's `SimpleDirectoryReader`/`VectorStoreIndex`, LangChain's `create_agent`/`.invoke()`, AutoGen AgentChat's `AssistantAgent`/`OpenAIChatCompletionClient`/`.run()`), fetched from each project's own docs at the time this was written, but that's a weaker guarantee than having actually run them. Before this ships as a real feature, someone with the ability to `pip install` these three packages and set a real `OPENAI_API_KEY` should run each sidecar once against a live request and confirm the response shape matches what the connector expects.

## Open questions before this goes further

Should the LlamaIndex sidecar's index be persisted to disk instead of rebuilt in memory on every `index_documents()` call, once it's used on anything beyond small folders? Should LangChain's and AutoGen's tools accept a caller-supplied model and system prompt instead of only an environment-variable default, once there's a real caller in IIG's engine deciding that per request? And, unresolved from the v1 product spec (`docs/product/IIG-V1-SPEC.md`): once IIG is handling real client data for a wealth-management deployment, does routing that data through a third-party model API from inside a LangChain or AutoGen sidecar need the same compliance review as anything else that touches client information — the recordkeeping and human-review gaps identified there apply here too, not just to IIG's own engine.
