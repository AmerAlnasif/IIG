/**
 * LlamaIndex connector.
 *
 * Bridges to integrations/mcp-sidecars/llamaindex_server.py, a Python MCP
 * server that wraps LlamaIndex's SimpleDirectoryReader + VectorStoreIndex.
 * Real, working tool calls — not a stub — but the sidecar's own vector
 * index is separate from IIG's native hybrid-search engine (vector HNSW +
 * BM25 + RRF + reranker, see src/core/). This connector is useful for
 * ad-hoc document Q&A over a folder that isn't in IIG's brain yet, or for
 * comparing retrieval quality against IIG's own engine — it does not
 * replace it. See docs/integrations/agent-frameworks.md.
 *
 * Usage:
 *
 *   import { LlamaIndexConnector } from "./llamaindex";
 *
 *   const li = new LlamaIndexConnector();
 *   await li.connect();
 *   await li.indexDocuments("./some/folder");
 *   const answer = await li.query("What does this folder say about X?");
 *   await li.close();
 */

import { McpSidecarClient } from "./sidecar-client";
import type { ConnectorInfo } from "./types";

export interface LlamaIndexConnectorConfig {
  /** Python executable to spawn. Defaults to "python3". */
  pythonCommand?: string;
  /** Path to the sidecar script. Defaults to the bundled wrapper. */
  scriptPath?: string;
  /** OpenAI (or compatible) API key passed through to the sidecar. */
  apiKey?: string;
}

export class LlamaIndexConnector {
  private readonly sidecar: McpSidecarClient;

  constructor(config: LlamaIndexConnectorConfig = {}) {
    this.sidecar = new McpSidecarClient({
      name: "llamaindex",
      command: config.pythonCommand ?? "python3",
      args: [
        config.scriptPath ?? "integrations/mcp-sidecars/llamaindex_server.py",
      ],
      env: config.apiKey ? { OPENAI_API_KEY: config.apiKey } : undefined,
    });
  }

  static readonly info: ConnectorInfo = {
    framework: "llama_index",
    maturity: "real",
    summary:
      "Indexes a local folder with VectorStoreIndex and answers queries against it.",
  };

  async connect(): Promise<void> {
    await this.sidecar.connect();
  }

  async close(): Promise<void> {
    await this.sidecar.close();
  }

  /** Build (or rebuild) an in-memory vector index over every file in `directory`. */
  async indexDocuments(directory: string): Promise<unknown> {
    return this.sidecar.callTool("index_documents", { directory });
  }

  /** Query the most recently built index. Call indexDocuments() first. */
  async query(question: string): Promise<unknown> {
    return this.sidecar.callTool("query_index", { query: question });
  }
}
