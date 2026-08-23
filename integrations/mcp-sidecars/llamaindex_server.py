"""LlamaIndex MCP sidecar.

Exposes a small, real slice of LlamaIndex as MCP tools so IIG's
TypeScript/Bun engine (see src/integrations/agents/llamaindex.ts) can call
it as a subprocess over stdio, the same shape as any other MCP server.

This wraps LlamaIndex's own indexing pipeline (SimpleDirectoryReader ->
VectorStoreIndex -> query engine) directly. It does not use IIG's native
hybrid-search engine (vector HNSW + BM25 + RRF + reranker) or share state
with it — this is a separate, in-memory index scoped to whatever
directory index_documents() was last called on. See
docs/integrations/agent-frameworks.md for when to reach for this versus
IIG's own `gbrain` search.

Setup:
    pip install -r integrations/mcp-sidecars/requirements.txt
    export OPENAI_API_KEY=...   # or configure Settings.llm/embed_model
                                  # for a different provider before running

Run standalone for local testing:
    python3 integrations/mcp-sidecars/llamaindex_server.py
"""

from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP

mcp = FastMCP(name="iig-llamaindex-sidecar")

# Holds the most recently built index/query engine for this process's
# lifetime. A sidecar process is spawned per IIG session (see
# sidecar-client.ts), so this is not shared across callers.
_state: dict[str, Any] = {"index": None, "query_engine": None, "directory": None}


@mcp.tool()
def index_documents(directory: str) -> dict:
    """Build a vector index over every file in `directory`.

    Must be called before query_index(). Rebuilds from scratch on every
    call — there is no incremental update in this pass.
    """
    from llama_index.core import SimpleDirectoryReader, VectorStoreIndex

    documents = SimpleDirectoryReader(directory).load_data()
    index = VectorStoreIndex.from_documents(documents)

    _state["index"] = index
    _state["query_engine"] = index.as_query_engine()
    _state["directory"] = directory

    return {
        "directory": directory,
        "documents_indexed": len(documents),
    }


@mcp.tool()
def query_index(query: str) -> dict:
    """Query the index built by the most recent index_documents() call."""
    query_engine = _state.get("query_engine")
    if query_engine is None:
        return {
            "error": "no index built yet — call index_documents(directory) first",
        }

    response = query_engine.query(query)
    return {
        "directory": _state.get("directory"),
        "query": query,
        "answer": str(response),
    }


if __name__ == "__main__":
    mcp.run()
