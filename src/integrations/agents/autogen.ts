/**
 * AutoGen connector.
 *
 * Bridges to integrations/mcp-sidecars/autogen_server.py, a Python MCP
 * server built on AutoGen's AgentChat API (AssistantAgent +
 * OpenAIChatCompletionClient).
 *
 * Note on project status: Microsoft's own AutoGen docs describe the
 * project as being in maintenance mode with community management, and
 * point new projects at "Microsoft Agent Framework" as the supported
 * successor. This connector keeps AutoGen rather than switching, per an
 * explicit decision made when this integration was scoped — AutoGen is
 * still functional and its AgentChat API is stable, it just isn't where
 * Microsoft is investing new feature work. If AutoGen becomes
 * unmaintained to the point of being a security or compatibility risk,
 * that's a reason to revisit this file specifically, not a reason this
 * integration silently drifted off of what was asked for.
 *
 * Real, working tool call: run a single AssistantAgent against a task and
 * stream back its final response.
 *
 * Usage:
 *
 *   import { AutoGenConnector } from "./autogen";
 *
 *   const ag = new AutoGenConnector();
 *   await ag.connect();
 *   const result = await ag.runTask("Draft a follow-up email for this meeting.");
 *   await ag.close();
 */

import { McpSidecarClient } from "./sidecar-client";
import type { ConnectorInfo } from "./types";

export interface AutoGenConnectorConfig {
  pythonCommand?: string;
  scriptPath?: string;
  apiKey?: string;
  model?: string;
}

export class AutoGenConnector {
  private readonly sidecar: McpSidecarClient;

  constructor(config: AutoGenConnectorConfig = {}) {
    this.sidecar = new McpSidecarClient({
      name: "autogen",
      command: config.pythonCommand ?? "python3",
      args: [
        config.scriptPath ?? "integrations/mcp-sidecars/autogen_server.py",
      ],
      env: {
        ...(config.apiKey ? { OPENAI_API_KEY: config.apiKey } : {}),
        ...(config.model ? { AUTOGEN_MODEL: config.model } : {}),
      },
    });
  }

  static readonly info: ConnectorInfo = {
    framework: "autogen",
    maturity: "real",
    summary:
      "Runs a single AutoGen AssistantAgent task via AgentChat and returns its response.",
  };

  async connect(): Promise<void> {
    await this.sidecar.connect();
  }

  async close(): Promise<void> {
    await this.sidecar.close();
  }

  /** Run `task` through a single AssistantAgent turn and return its response. */
  async runTask(task: string): Promise<unknown> {
    return this.sidecar.callTool("run_task", { task });
  }
}
