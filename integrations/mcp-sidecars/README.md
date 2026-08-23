# Agent-framework MCP sidecars

This folder holds one Python MCP server per framework vendored as a submodule in PR #1: `llamaindex_server.py`, `langchain_server.py`, `autogen_server.py`, `ai_trader_server.py`. Each one is a small, standalone process that speaks MCP over stdio. IIG's TypeScript/Bun engine spawns whichever one it needs and talks to it as an MCP client — see `src/integrations/agents/` for the TypeScript side, and `docs/integrations/agent-frameworks.md` for the full write-up of why this shape was chosen and what's real versus scaffolded.

## Why sidecars instead of a native port

AI-Trader, LlamaIndex, and AutoGen are Python-only. LangChain has a JS variant, but the submodule pinned in PR #1 is the Python repo. Rather than reimplement four frameworks in TypeScript, each one keeps running in Python, in its own process, and exposes a handful of MCP tools. IIG's engine already speaks MCP fluently on the server side (`src/mcp/`); this extends that same protocol to the client side instead of introducing a second integration pattern.

## Running a sidecar by hand

Every wrapper is a normal Python script and can be run directly for local testing, independent of IIG:

    pip install -r integrations/mcp-sidecars/requirements.txt
    export OPENAI_API_KEY=...
    python3 integrations/mcp-sidecars/llamaindex_server.py

It will sit and wait on stdin/stdout for an MCP client. IIG's connectors (`LlamaIndexConnector`, `LangChainConnector`, `AutoGenConnector`, `AITraderConnector`) do this spawning for you.

## Status per framework

| Framework | Wrapper | Status | What it does |
| --- | --- | --- | --- |
| LlamaIndex | `llamaindex_server.py` | Real | Builds a VectorStoreIndex over a folder and answers queries against it. |
| LangChain | `langchain_server.py` | Real | Runs one `create_agent()` turn on a prompt and returns the output. |
| AutoGen | `autogen_server.py` | Real | Runs one `AssistantAgent` task via AgentChat and returns the response. |
| AI-Trader | `ai_trader_server.py` | Scaffold | MCP plumbing works end to end; the actual trading API bridge is not implemented. See the module docstring for exactly why. |

"Real" here means the MCP process, tool registration, and request/response round trip were verified against the actual `mcp` Python package during development. It does not mean the underlying framework calls (an actual OpenAI request through LlamaIndex, LangChain, or AutoGen) were executed in that same verification pass — that requires API credentials this repository does not have configured. `docs/integrations/agent-frameworks.md` spells out exactly what was and wasn't run.
