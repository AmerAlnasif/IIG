# IIG

IIG is the umbrella project going forward: a Postgres-native knowledge engine at the core, with integrations layered on top as their own self-contained pieces. The engine (originally the open-source GBrain project) does the heavy lifting: hybrid retrieval, a knowledge graph that wires itself, and a synthesis layer that answers questions with citations instead of handing back a list of pages. Integrations plug into it, starting with a full Kalshi Trade API client.

## Layout

| Area | What it is |
| --- | --- |
| `src/core/`, `src/commands/`, `src/mcp/` | The knowledge engine: ingestion, hybrid search, knowledge graph, job queue, MCP server. |
| `src/integrations/kalshi/` | Kalshi Trade API v2 client, 76 endpoints. Setup: `recipes/kalshi-api.md`. |
| `skills/` | 43 bundled skills for capture, enrichment, querying, and brain operations. |
| `admin/` | Local web dashboard, built separately and embedded into the CLI binary. |
| `docs/` | Architecture, install paths, and integration guides. |

`src/integrations/` holds everything that isn't the engine itself, one folder per integration.

## Engine highlights

Hybrid search combines vector search (HNSW), BM25 keyword search, reciprocal-rank fusion, and a reranker. A self-wiring knowledge graph creates typed edges on every page write with no LLM calls involved. Two storage engines share one contract: PGLite for zero-config brains up to roughly 50K pages, or Postgres plus pgvector for shared and large-scale brains. A Postgres-native job queue, an eval framework, and a cron-driven overnight enrichment cycle round out the core. Over 30 MCP tools expose the engine to Claude Code, Codex, Cursor, Claude Desktop, and more.

Full engine documentation lives under `docs/`, `AGENTS.md`, and `CLAUDE.md`.

## Integrations

### Kalshi Trade API client

`src/integrations/kalshi/` is a typed TypeScript client covering every endpoint in Kalshi's public Trade API v2: market data, events, orders, order groups, portfolio, transfers and subaccounts, block trades, RFQs, quotes, and API key management. No dependencies beyond Node's `fetch` and `node:crypto`. Setup and usage examples: `recipes/kalshi-api.md`.

More integrations land the same way: their own folder under `src/integrations/`, with a matching setup recipe.

## Getting started

```bash
bun install
bun run typecheck
bun run test
```

To run the engine directly:

```bash
gbrain init --pglite
gbrain doctor
gbrain query "what themes show up in my notes?"
```

## Contributing

Run `bun run test` for the fast loop and `bun run verify` for the pre-push gate. Full test discipline in `CONTRIBUTING.md`. Security model and hardening defaults: `SECURITY.md`.

## License and credit

MIT. The core engine began as the open-source GBrain project. See `LICENSE` and `CHANGELOG.md` for full history and contributor credit.
