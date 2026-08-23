"""AI-Trader MCP sidecar — scaffold, not a working integration yet.

Exposes the MCP process/handshake shape that src/integrations/agents/
ai-trader.ts expects, so the sidecar pattern is consistent across all
four frameworks. It does not call AI-Trader's actual trading API.

Why this is a stub rather than a real bridge, honestly stated:

1. AI-Trader (HKUDS/AI-Trader, vendored as a submodule in PR #1) is a
   FastAPI *service*. Integrating with it means REST calls to a running
   instance, with a base URL and credentials this repo does not have
   configured anywhere yet.
2. Its formal API surface lives in its own repo at docs/api/openapi.yaml
   and docs/api/copytrade.yaml. Those were not fetched and verified
   endpoint-by-endpoint before writing this file. This repo already talks
   to a real trading venue through the Kalshi integration
   (src/integrations/kalshi/) built directly from Kalshi's published
   OpenAPI spec, one typed method per operation — the same standard
   should apply here before any tool claims to place or manage trades,
   rather than guessing at request/response shapes for a second trading
   surface.
3. AI-Trader's own onboarding docs ask the reader to visit an external
   URL and register on a hosted platform before using it. That step was
   deliberately not auto-followed while writing this integration.

What get_status() actually verifies: that this process starts, speaks
MCP correctly, and can be listed/called by the sidecar client — i.e. the
plumbing this connector will need once the real bridge is built. It does
not verify anything about AI-Trader itself.

To move this from scaffold to real, see docs/integrations/agent-frameworks.md
for the checklist: confirmed OpenAPI schema, a running AI-Trader instance
and its base URL/credentials, and typed request/response methods generated
the same way src/integrations/kalshi/client.ts was.

Run standalone for local testing:
    python3 integrations/mcp-sidecars/ai_trader_server.py
"""

from __future__ import annotations

from mcp.server.fastmcp import FastMCP

mcp = FastMCP(name="iig-ai-trader-sidecar")


@mcp.tool()
def get_status() -> dict:
    """Always returns implemented: false. See module docstring for why."""
    return {
        "implemented": False,
        "framework": "AI-Trader",
        "reason": (
            "AI-Trader's API is a running FastAPI service, not a library. "
            "This sidecar is wired up end-to-end but has no confirmed "
            "OpenAPI schema and no AI-Trader instance configured to call. "
            "See docs/integrations/agent-frameworks.md."
        ),
    }


if __name__ == "__main__":
    mcp.run()
