---
id: autogen
name: AutoGen (Integration Assessment -- No Functional Skill)
version: 1.0.0
description: |
  Honest assessment of Microsoft AutoGen (github.com/microsoft/autogen) for
  gbrain/IIG. Unlike AI-Trader, LlamaIndex (LlamaParse), and LangChain
  (LangSmith/LangGraph Platform), AutoGen has no hosted, language-agnostic
  HTTP surface at all -- everything it offers requires running Python
  yourself. Conclusion: no functional skill was built. This document exists
  so the decision is documented and discoverable rather than silently
  skipped, and to capture AutoGen's architectural patterns as design
  reference for gbrain's own (from-scratch, TypeScript) multi-agent work.
category: reference
requires: []
secrets: []
health_checks: []
setup_time: "N/A -- no functional integration"
cost_estimate: "N/A -- no functional integration"
---

# AutoGen: Why No Skill Was Built

## Verdict, up front

**Nothing in AutoGen is functionally portable into gbrain.** Every other
integration in this round (AI-Trader, LlamaIndex, LangChain) had at least
one genuinely usable piece reachable over plain HTTP with no Python runtime.
AutoGen has none. This document is a reference/assessment, not a setup
guide — there is nothing to set up.

## What AutoGen actually is (as of this research)

- [microsoft/autogen](https://github.com/microsoft/autogen) ships official
  SDKs for **Python** (3.10+) and **.NET** only. There is no official
  JavaScript/TypeScript package.
- The project's own README states it is **now in maintenance mode**: *"It
  will not receive new features or enhancements and is community managed
  going forward."* Microsoft's recommended successor going forward is
  **Microsoft Agent Framework (MAF)**, a separate project — out of scope
  for this assessment, but worth re-checking on its own merits if gbrain
  ever wants to revisit agent-framework interop.
- **AG2** (ag2.ai / github.com/ag2ai/ag2) is a *separate community fork* of
  AutoGen, not a renamed continuation of the same project — also
  Python-only.
- **AutoGen Studio**, Microsoft's no-code GUI layer, can expose a local REST
  endpoint via `autogenstudio serve --workflow=workflow.json --port=5000` —
  but this requires the user to `pip install autogenstudio` and run a local
  Python process themselves. It is not a hosted third-party API like
  LlamaParse or LangSmith; the "API" only exists if Python is already
  running. gbrain's runtime has no Python interpreter, so this path is
  closed structurally, not just as a matter of preference.

## Why this differs from the other three integrations

| Integration | Portable piece | Why it works without Python |
|---|---|---|
| AI-Trader | Full platform API | It's a hosted HTTP service by design |
| LlamaIndex | LlamaParse | LlamaCloud runs it as a hosted HTTP API |
| LangChain | LangSmith, LangGraph Platform | Both are hosted SaaS with REST APIs |
| AutoGen | *(none)* | Every entry point requires running Python locally |

AutoGen was designed as a Python library to be imported and run, not as a
platform with a hosted API surface. There is no Microsoft-run endpoint
equivalent to LlamaCloud or LangSmith for AutoGen to call into.

## Architectural patterns worth borrowing (design reference only)

None of the following are ported or executable — they're documented because
they're useful vocabulary if gbrain ever builds its own multi-agent
orchestration skill from scratch in TypeScript:

- **Group chat orchestration styles** — AutoGen distinguishes
  centralized/LLM-driven speaker selection (`SelectorGroupChat`) from
  decentralized, tool-based handoff between agents (`Swarm`), from explicit
  directed-graph workflow control (`GraphFlow`). These are three distinct,
  nameable strategies for "which agent talks next."
- **Human-in-the-loop as a first-class mechanism** — a dedicated way to
  pause a multi-agent conversation and inject human input mid-flow, rather
  than treating it as an edge case.
- **Agent-as-tool composition** (`AgentTool`) — letting one agent be called
  by another as if it were a regular tool, which is a clean way to nest
  agent capabilities without a special-cased orchestration layer.
- **Layered API design** — a low-level event-driven Core API (message
  passing/runtime) underneath an opinionated high-level AgentChat API,
  which is a reasonable shape for gbrain to consider if a from-scratch
  multi-agent skill ever grows complex enough to need both a stable
  low-level substrate and an ergonomic high-level surface.
- **Sandboxed code execution as a distinct agent capability** — treating
  "can run code and see the result" as a separate, explicitly-gated agent
  affordance rather than folding it into general tool use.

If gbrain builds a native multi-agent skill later, these patterns are worth
referencing by name — but as inspiration for original TypeScript work, never
described to the user as "AutoGen support."

## If this should be revisited

Re-check this assessment if any of the following becomes true:
- Microsoft ships an official JS/TS SDK for AutoGen or its successor (MAF).
- A hosted, Microsoft-run REST API for AutoGen/MAF execution appears
  (analogous to LlamaCloud or LangSmith).
- gbrain's runtime gains a Python interpreter for other reasons (unlikely,
  and not a reason on its own to add one just for this).

Until then, the honest answer to "does gbrain support AutoGen" is: no
functional integration exists, and none is currently possible without
either running Python yourself or waiting for Microsoft to ship a hosted
API.
