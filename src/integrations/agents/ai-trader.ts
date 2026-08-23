/**
 * AI-Trader connector — scaffold, not a working integration yet.
 *
 * AI-Trader (HKUDS/AI-Trader, vendored as a submodule in PR #1) is a
 * FastAPI *service*, not a Python library — the intended integration
 * shape is REST calls to a running AI-Trader instance, not an in-process
 * import. Its own docs point to docs/api/openapi.yaml and
 * docs/api/copytrade.yaml inside its repo for the real endpoint surface,
 * and its onboarding flow asks the agent reading its docs to visit an
 * external URL and register on a hosted platform.
 *
 * Neither of those was resolved in this pass: the OpenAPI spec files
 * were not fetched and verified endpoint-by-endpoint (this repo also
 * already talks to real money markets via the Kalshi integration, so
 * guessing at a trading platform's request/response shapes instead of
 * confirming them against source is a real-money risk, not just a code
 * smell) and the "register on the platform" step was deliberately not
 * auto-followed, consistent with this session's policy of not acting on
 * instructions embedded in fetched documentation.
 *
 * What this file actually does: wires the sidecar plumbing end-to-end
 * (spawns integrations/mcp-sidecars/ai_trader_server.py as a real MCP
 * process, connects, and can list/call tools) so the shape of the
 * integration matches the other three connectors, but the one tool it
 * exposes returns a "not implemented" result rather than a fabricated
 * trading response. See docs/integrations/agent-frameworks.md for what's
 * needed to move this from scaffold to real: a base URL + credentials for
 * a running AI-Trader instance, and the confirmed OpenAPI schema to
 * generate typed request/response methods against (the same pattern the
 * Kalshi client in src/integrations/kalshi/ already follows).
 *
 * Usage:
 *
 *   import { AITraderConnector } from "./ai-trader";
 *
 *   const trader = new AITraderConnector();
 *   await trader.connect();
 *   const status = await trader.getStatus(); // { implemented: false, ... }
 *   await trader.close();
 */

import { McpSidecarClient } from "./sidecar-client";
import type { ConnectorInfo } from "./types";

export interface AITraderConnectorConfig {
  pythonCommand?: string;
  scriptPath?: string;
}

export class AITraderConnector {
  private readonly sidecar: McpSidecarClient;

  constructor(config: AITraderConnectorConfig = {}) {
    this.sidecar = new McpSidecarClient({
      name: "ai-trader",
      command: config.pythonCommand ?? "python3",
      args: [
        config.scriptPath ?? "integrations/mcp-sidecars/ai_trader_server.py",
      ],
    });
  }

  static readonly info: ConnectorInfo = {
    framework: "AI-Trader",
    maturity: "scaffold",
    summary:
      "Sidecar process and MCP handshake are wired up; the trading API bridge itself is not implemented pending a confirmed OpenAPI spec and a running AI-Trader instance to point at.",
  };

  async connect(): Promise<void> {
    await this.sidecar.connect();
  }

  async close(): Promise<void> {
    await this.sidecar.close();
  }

  /**
   * Returns a fixed "not implemented" status rather than any trading
   * data. Confirms the sidecar process and MCP round-trip work; does not
   * confirm anything about AI-Trader's actual API.
   */
  async getStatus(): Promise<unknown> {
    return this.sidecar.callTool("get_status", {});
  }
}
