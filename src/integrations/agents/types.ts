/**
 * Shared types for the agent-framework sidecar connectors
 * (ai-trader.ts, llamaindex.ts, langchain.ts, autogen.ts).
 */

/** Lifecycle status a connector reports about its own honesty level. */
export type ConnectorMaturity = "real" | "scaffold";

export interface ConnectorInfo {
  /** Framework name, matching the submodule directory under integrations/. */
  framework: string;
  /**
   * "real": the sidecar's tools call the actual framework and are expected
   * to work once its Python dependencies are installed and any required
   * API keys are set.
   *
   * "scaffold": the sidecar is wired up (process spawns, MCP handshake
   * succeeds, tools are listed) but at least one tool is a stub that
   * returns a clear "not implemented" result rather than a fabricated
   * answer. See docs/integrations/agent-frameworks.md for exactly which
   * tools are which, per framework.
   */
  maturity: ConnectorMaturity;
  /** One-line human-readable summary of what this connector currently does. */
  summary: string;
}
