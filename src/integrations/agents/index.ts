/**
 * Agent-framework MCP sidecar bridge.
 *
 * Connects IIG's TypeScript/Bun engine to the four Python frameworks
 * vendored as submodules under integrations/ (PR #1): AI-Trader,
 * LlamaIndex, LangChain, AutoGen. Each framework runs as its own MCP
 * server process (integrations/mcp-sidecars/*.py); the classes exported
 * here are thin typed clients over that connection.
 *
 * See docs/integrations/agent-frameworks.md for setup, environment
 * variables, and an honest per-framework status (real vs. scaffold).
 */

export { McpSidecarClient, SidecarError } from "./sidecar-client";
export type { SidecarConfig, SidecarTool } from "./sidecar-client";
export type { ConnectorInfo, ConnectorMaturity } from "./types";

export { LlamaIndexConnector } from "./llamaindex";
export type { LlamaIndexConnectorConfig } from "./llamaindex";

export { LangChainConnector } from "./langchain";
export type { LangChainConnectorConfig } from "./langchain";

export { AutoGenConnector } from "./autogen";
export type { AutoGenConnectorConfig } from "./autogen";

export { AITraderConnector } from "./ai-trader";
export type { AITraderConnectorConfig } from "./ai-trader";
