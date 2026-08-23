/**
 * Generic MCP sidecar client.
 *
 * AI-Trader, LlamaIndex, LangChain, and AutoGen (vendored as git submodules
 * under integrations/, see PR #1) are Python-only. IIG's engine is
 * TypeScript/Bun. Rather than attempting a native port of four large
 * frameworks, each one runs as its own local process exposing an MCP
 * server over stdio ("sidecar"), and IIG talks to it as an MCP client —
 * the same protocol IIG already speaks on the server side in src/mcp/.
 *
 * This file is the one piece of client-side MCP plumbing all four
 * connectors share: spawn the sidecar's process, perform the MCP
 * handshake, list its tools, call a tool, and shut it down cleanly.
 * Per-framework connectors (ai-trader.ts, llamaindex.ts, langchain.ts,
 * autogen.ts) wrap this with typed, named methods for that framework's
 * specific tools.
 *
 * Usage:
 *
 *   import { McpSidecarClient } from "./sidecar-client";
 *
 *   const sidecar = new McpSidecarClient({
 *     name: "llamaindex",
 *     command: "python3",
 *     args: ["integrations/mcp-sidecars/llamaindex_server.py"],
 *   });
 *   await sidecar.connect();
 *   const tools = await sidecar.listTools();
 *   const result = await sidecar.callTool("query_index", { query: "..." });
 *   await sidecar.close();
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface SidecarConfig {
  /** Short identifier used in logs and error messages, e.g. "llamaindex". */
  name: string;
  /** Executable to spawn, e.g. "python3". */
  command: string;
  /** Arguments passed to the executable, e.g. the sidecar script path. */
  args?: string[];
  /** Extra environment variables merged into the spawned process's env. */
  env?: Record<string, string>;
  /** Working directory for the spawned process. Defaults to the repo root. */
  cwd?: string;
}

export interface SidecarTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export class SidecarError extends Error {
  constructor(
    public readonly sidecar: string,
    public readonly operation: string,
    cause: unknown,
  ) {
    super(
      `MCP sidecar "${sidecar}" failed during ${operation}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "SidecarError";
    this.cause = cause;
  }
}

/**
 * Thin MCP client bound to a single sidecar process. One instance per
 * framework connector; the underlying subprocess is only spawned on
 * connect() and only lives for that instance's lifetime.
 */
export class McpSidecarClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  constructor(private readonly config: SidecarConfig) {}

  get name(): string {
    return this.config.name;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      cwd: this.config.cwd,
      env: {
        ...(process.env as Record<string, string>),
        ...(this.config.env ?? {}),
      },
    });

    this.client = new Client(
      { name: `iig-agent-bridge-${this.config.name}`, version: "0.1.0" },
      { capabilities: {} },
    );

    try {
      await this.client.connect(this.transport);
      this.connected = true;
    } catch (err) {
      this.connected = false;
      throw new SidecarError(this.config.name, "connect", err);
    }
  }

  async listTools(): Promise<SidecarTool[]> {
    if (!this.client || !this.connected) {
      throw new SidecarError(
        this.config.name,
        "listTools",
        new Error("sidecar not connected — call connect() first"),
      );
    }
    try {
      const { tools } = await this.client.listTools();
      return tools.map(
        (t: { name: string; description?: string; inputSchema: unknown }) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown>,
        }),
      );
    } catch (err) {
      throw new SidecarError(this.config.name, "listTools", err);
    }
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.client || !this.connected) {
      throw new SidecarError(
        this.config.name,
        `callTool(${toolName})`,
        new Error("sidecar not connected — call connect() first"),
      );
    }
    try {
      const result = await this.client.callTool({
        name: toolName,
        arguments: args,
      });
      if (result.isError) {
        throw new Error(
          Array.isArray(result.content)
            ? result.content.map((c: { text?: string }) => c.text ?? "").join("\n")
            : "sidecar tool returned an error with no content",
        );
      }
      return result.content;
    } catch (err) {
      throw new SidecarError(this.config.name, `callTool(${toolName})`, err);
    }
  }

  async close(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.client?.close();
    } finally {
      this.connected = false;
      this.client = null;
      this.transport = null;
    }
  }
}
