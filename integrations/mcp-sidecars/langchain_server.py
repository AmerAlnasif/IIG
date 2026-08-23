"""LangChain MCP sidecar.

Exposes a single, real LangChain agent invocation as an MCP tool so IIG's
TypeScript/Bun engine (see src/integrations/agents/langchain.ts) can call
it as a subprocess over stdio.

The submodule vendored in PR #1 (integrations/langchain) is the Python
langchain repo, not LangChain.js — that's the reason this goes through a
sidecar process instead of an in-process import. This wrapper installs
the langchain package from PyPI rather than importing from the vendored
submodule checkout directly, since the submodule is a pinned source
snapshot without its own build/install step; the submodule stays useful
as the exact reference version this wrapper was written against.

Scope: one tool, one turn. No memory across calls, no tool-use loop beyond
what create_agent's default harness does internally. Multi-turn
conversations and a real LangChain tool belt are the natural v1.1
expansion — see docs/integrations/agent-frameworks.md.

Setup:
    pip install -r integrations/mcp-sidecars/requirements.txt
    export OPENAI_API_KEY=...
    export LANGCHAIN_MODEL=gpt-4o-mini   # optional, defaults below

Run standalone for local testing:
    python3 integrations/mcp-sidecars/langchain_server.py
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

mcp = FastMCP(name="iig-langchain-sidecar")

DEFAULT_MODEL = os.environ.get("LANGCHAIN_MODEL", "gpt-4o-mini")


@mcp.tool()
def run_agent(prompt: str) -> dict:
    """Run one LangChain agent turn on `prompt` and return its final output."""
    from langchain.agents import create_agent

    agent = create_agent(model=DEFAULT_MODEL, tools=[])
    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})

    messages = result.get("messages", []) if isinstance(result, dict) else []
    final_text = ""
    if messages:
        last = messages[-1]
        final_text = getattr(last, "content", None) or (
            last.get("content", "") if isinstance(last, dict) else ""
        )

    return {
        "model": DEFAULT_MODEL,
        "prompt": prompt,
        "output": final_text,
    }


if __name__ == "__main__":
    mcp.run()
