"""AutoGen MCP sidecar.

Exposes a single, real AutoGen AgentChat task as an MCP tool so IIG's
TypeScript/Bun engine (see src/integrations/agents/autogen.ts) can call it
as a subprocess over stdio.

Kept per explicit decision when this integration was scoped: Microsoft's
own AutoGen docs describe the project as being in maintenance mode and
point new projects at "Microsoft Agent Framework" as the supported
successor. This wrapper uses AutoGen anyway, not Microsoft Agent
Framework — do not swap this out without checking with whoever owns this
integration first.

Scope: one tool, one AssistantAgent, one task, no streaming exposed
through MCP (the tool call itself is request/response; run_stream is used
internally and collapsed into a single returned message list). A
multi-agent AutoGen team is a natural v1.1 expansion — see
docs/integrations/agent-frameworks.md.

Setup:
    pip install -r integrations/mcp-sidecars/requirements.txt
    export OPENAI_API_KEY=...
    export AUTOGEN_MODEL=gpt-4o-mini   # optional, defaults below

Run standalone for local testing:
    python3 integrations/mcp-sidecars/autogen_server.py
"""

from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

mcp = FastMCP(name="iig-autogen-sidecar")

DEFAULT_MODEL = os.environ.get("AUTOGEN_MODEL", "gpt-4o-mini")


@mcp.tool()
async def run_task(task: str) -> dict:
    """Run `task` through a single AutoGen AssistantAgent turn."""
    from autogen_agentchat.agents import AssistantAgent
    from autogen_agentchat.messages import TextMessage
    from autogen_ext.models.openai import OpenAIChatCompletionClient

    model_client = OpenAIChatCompletionClient(model=DEFAULT_MODEL)
    agent = AssistantAgent(
        name="iig_sidecar_agent",
        model_client=model_client,
        system_message="You are a helpful assistant.",
    )

    try:
        result = await agent.run(task=task)
        text_messages = [
            m.content
            for m in result.messages
            if isinstance(m, TextMessage) and m.source != "user"
        ]
        final_text = text_messages[-1] if text_messages else ""
    finally:
        await model_client.close()

    return {
        "model": DEFAULT_MODEL,
        "task": task,
        "output": final_text,
    }


if __name__ == "__main__":
    mcp.run()
