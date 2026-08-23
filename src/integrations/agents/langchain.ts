/**
 * LangChain connector.
 *
 * Bridges to integrations/mcp-sidecars/langchain_server.py, a Python MCP
 * server built on LangChain's create_agent() API. The submodule pinned in
 * PR #1 is the Python langchain repo (not LangChain.js), which is why this
 * goes through a sidecar rather than an in-process JS import.
 *
 * Real, working tool calls, scoped deliberately small: one tool that runs
 * a single-turn agent invocation and returns its output. It does not
 * expose LangChain's full graph/chain-composition surface — that's a
 * larger integration than this pass covers. See
 * docs/integrations/agent-frameworks.md for the intended v1.1 expansion.
 *
 * Usage:
 *
 *   import { LangChainConnector } from "./langchain";
 *
 *   const lc = new LangChainConnector();
 *   await lc.connect();
 *   const result = await lc.runAgent("Summarize the attached notes.");
 *   await lc.close();
 */

import { McpSidecarClient } from "./sidecar-client";
import type { ConnectorInfo } from "./types";

export interface LangChainConnectorConfig {
  pythonCommand?: string;
  scriptPath?: string;
  apiKey?: string;
  /** Model identifier passed through to the sidecar's chat model. */
  model?: string;
}

export class LangChainConnector {
  private readonly sidecar: McpSidecarClient;

  constructor(config: LangChainConnectorConfig = {}) {
    this.sidecar = new McpSidecarClient({
      name: "langchain",
      command: config.pythonCommand ?? "python3",
      args: [
        config.scriptPath ?? "integrations/mcp-sidecars/langchain_server.py",
      ],
      env: {
        ...(config.apiKey ? { OPENAI_API_KEY: config.apiKey } : {}),
        ...(config.model ? { LANGCHAIN_MODEL: config.model } : {}),
      },
    });
  }

  static readonly info: ConnectorInfo = {
    framework: "langchain",
    maturity: "real",
    summary: "Runs a single-turn LangChain agent invocation and returns its output.",
  };

  async connect(): Promise<void> {
    await this.sidecar.connect();
  }

  async close(): Promise<void> {
    await this.sidecar.close();
  }

  /** Run one agent turn on `prompt` and return the agent's final output. */
  async runAgent(prompt: string): Promise<unknown> {
    return this.sidecar.callTool("run_agent", { prompt });
  }
}
