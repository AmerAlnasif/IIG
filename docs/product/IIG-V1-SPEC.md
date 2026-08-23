# IIG v1 product spec

## Why this doc exists

IIG was rebranded from a GBrain-derived personal-knowledge tool into the umbrella project name in PR #3. Since then, the actual target has come into focus: IIG is going to be a branch for a wealth management company, not a general-purpose second brain. That changes what "a better v1" means. This doc benchmarks IIG against the two product categories it actually competes with, lists the gaps that matter for a regulated wealth-management deployment, and proposes a scoped v1. No code changes ship in this PR — it's meant to be agreed on before anything gets built.

## Positioning

IIG v1 should be a compliance-aware agent memory and advisor workspace: technically grounded in the same patterns used by the leading AI-agent-memory infrastructure products, wrapped in the meeting-capture-to-task workflow used by the leading wealth-tech "agentic OS" tools — but owned and self-hosted by the firm rather than a third-party SaaS relationship.

## What we're benchmarking against

### AI agent memory infrastructure

| Product | What it does | How it works | vs. IIG's inherited engine |
| --- | --- | --- | --- |
| Mem0 | Persistent memory layer for agents; remembers preferences and history across sessions. | Single-pass extraction into a vector store, multi-signal retrieval (semantic + BM25 + entity matching) fused into one ranking. Scopes memories by user/agent/run/app id. Leads published benchmarks: 92.5 LoCoMo, 94.4 LongMemEval. | IIG's hybrid search (vector + BM25 + RRF + reranker) is architecturally comparable. IIG has no identity-scoped memory model (user/agent/run tags) today. |
| Zep (Graphiti) | Persistent memory as a temporal knowledge graph over chat, documents, and business data. | Extracts entities and facts into a graph; when new information contradicts an old fact, the old fact is invalidated rather than left contradictory. Sub-200ms retrieval, 90%+ on LoCoMo/LongMemEval. | IIG's self-wiring graph (typed edges on every write) is the same idea in spirit. IIG has no temporal invalidation — a changed fact becomes a second fact, not a correction. |
| Letta (MemGPT) | Agents with a managed memory hierarchy instead of one flat context window. | Three tiers: core memory (pinned, always in context), recall memory (full conversation history, searchable), archival memory (external vector/graph store, retrieved on demand). | IIG has one tier: everything is a page, searched the same way. Nothing is guaranteed to stay in context. |
| LangMem | SDK for agents to manage their own long-term memory during a conversation. | Agent-driven extraction (`create_manage_memory_tool`) and retrieval (`create_search_memory_tool`) against a pluggable store; a background manager consolidates memory without a human in the loop. | IIG's MCP surface already exposes comparable tool-call primitives. LangMem's fully agent-driven, no-review storage model is close to what compliance below rules out. |

### Wealth-management AI notetaker / "agentic OS" tools

| Segment | Products | What they do |
| --- | --- | --- |
| Specialist agentic OS | Jump, Zocks, Zeplyn, Mili, CogniCor | Started as meeting-summary tools, evolved into orchestration layers: turn a transcript directly into opened accounts, tax-loss-harvest flags, wallet-share detection, and referral-ready signals — not just a summary. |
| Generic notetakers | Fathom, Fireflies, Grain, Granola, Microsoft Copilot, Zoom AI Companion | Transcription and summarization, adapted to advisor use rather than purpose-built for it. |
| CRM-native | Wealthbox, Altruist Hazel, Advisor360 Parrot AI, Nitrogen, Practifi, Slant | AI notetaking bolted onto an existing CRM the firm already runs on. |

Jump and Zocks alone have raised over $170M, and the trade press describes the shift as the notetaker displacing the CRM as the advisor's actual system of record: "a transcript with intent is more valuable than a database with balances." Whoever captures the client conversation first controls the workflow layer under it.

### Compliance baseline (SEC / FINRA)

Every one of the wealth-tech products above is built around the same regulatory floor. The Investment Advisers Act of 1940 puts AI-assisted recordkeeping in scope: prompts and outputs that lead to a recommendation are books-and-records, and must be archived and auditable. FINRA Rule 3110 requires a supervisory system, which in practice means human review before an AI output is used, not after. FINRA Regulatory Notice 24-09 confirms AI tools get no special exemption — the same recordkeeping and communication rules apply as to any other technology. Zocks specifically markets no raw audio retention, configurable PII redaction, consent management, and hierarchical enterprise access control as baseline requirements for firms to even consider a tool.

## What IIG's inherited engine already gets right

The hybrid search stack (vector HNSW + BM25 + reciprocal-rank fusion + reranker) is architecturally in the same class as Mem0's multi-signal retrieval. The self-wiring knowledge graph is the same core idea as Zep's Graphiti — typed edges created on every write, no LLM call needed. The MCP surface (30+ tools, stdio and HTTP) already gives IIG the same tool-call integration story as LangMem. Schema packs give a real foundation for per-client, per-household page types instead of a fixed taxonomy. None of this needs to be thrown out — the gaps below are what's missing to point it at a regulated wealth-management workflow, not reasons to start over.

## The gaps that actually matter for a wealth-management deployment

### 1. No temporal fact invalidation

When a client's risk tolerance or allocation changes, IIG's graph gets a second, contradictory fact rather than a correction to the first. For a fiduciary, an agent confidently citing a stale risk profile is a real failure mode, not a cosmetic one. Zep's invalidate-on-contradiction model is the reference pattern.

### 2. No memory tiering

Everything in IIG is a page, retrieved the same way regardless of importance. There's no guarantee that a client's household, risk profile, or restricted-securities list stays in context the way Letta's core memory does — it has to win a retrieval race like everything else.

### 3. No compliance-grade audit trail

IIG's system of record is a git repo with soft-deletes. That's a reasonable model for a personal knowledge base; it does not satisfy SEC Rule 17a-4-style immutable recordkeeping, and there's no human-review-before-use gate anywhere in the pipeline the way FINRA Rule 3110 requires. This is the one gap that should block any real client data from touching IIG until it's closed.

### 4. No PII or consent controls

No configurable redaction, no raw-audio retention policy, no consent capture. Every wealth-tech competitor above treats this as table stakes, not a differentiator.

### 5. No per-client or per-advisor access scoping

IIG's brain/source model is built for one person's knowledge base. A firm needs a real hierarchy — firm, team, advisor, household, client — with access enforced at each level. Mem0's user/agent/run identity tags are a reasonable pattern to adapt to an org chart instead of a single user.

### 6. No wealth-specific intent extraction

`gbrain think` gives a synthesized, cited answer plus a gap analysis. The wealth-tech leaders go one step further and turn a transcript directly into next-best-actions — tax-loss-harvest flags, rebalance flags, referral-ready signals, disclosure-due reminders. This is the single highest-leverage gap: it's the actual thing advisors are paying Jump and Zocks for, not just a better search box.

## Proposed v1 scope

Closing all six gaps at once isn't realistic as a first version. v1.0 should ship gaps #3, #4, and #5 together — compliance, PII/consent, and access scoping — because none of them are optional once real client data is involved, and none of them are useful half-done. Alongside them, v1.0 should ship a first pass at #6, the intent-extraction layer, since that's the actual value proposition and the reason to build this instead of buying Zocks or Jump outright. Gaps #1 and #2 — temporal invalidation and memory tiering — are engine-level upgrades that matter more at scale than on day one; they're the natural v1.1 once the compliance and workflow layer is proven against real usage.

## What v1 explicitly does not include

No multi-tenant SaaS hosting — this is one firm's deployment. No real custodian or CRM integration yet — that needs the firm to name a target system first (see open questions). No new UI beyond the existing admin dashboard. No rewrite of the underlying engine — this extends it, it doesn't replace it.

## Open questions before implementation starts

Which custodian or CRM does this integrate with first — Wealthbox, Redtail, Salesforce Financial Services Cloud, or something else? Is the firm SEC-registered, state-registered, or both, and are there non-US jurisdictions in scope — the compliance baseline above is US-only. Does IIG stay self-hosted on the firm's own infrastructure, or move to the firm's cloud tenant? Who is the human in the human-review-before-use gate — a compliance officer, the advisor themselves, or both? And what happens to the existing Kalshi Trade API integration — prediction-market trading isn't a wealth-advisory workflow, so it likely stays in the repo as the reference pattern for "how an integration is structured" rather than as a feature this deployment actually uses.

## Sources

- [Mem0: State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)
- - [Zep — Agent Memory product page](https://www.getzep.com/product/agent-memory/)
  - - [A Visual Guide to Knowledge Graphs for AI Agents — Zep blog](https://blog.getzep.com/a-visual-guide-to-knowledge-graphs-for-ai-agents/)
    - - [Zep: A Temporal Knowledge Graph Architecture for Agent Memory (arXiv)](https://arxiv.org/abs/2501.13956)
      - - [Agent Memory: How to Build Agents That Learn and Remember — Letta](https://www.letta.com/blog/agent-memory/)
        - - [LangMem SDK for agent long-term memory — LangChain](https://www.langchain.com/blog/langmem-sdk-launch)
          - - [langchain-ai/langmem — GitHub](https://github.com/langchain-ai/langmem)
            - - [AI Notetakers & Agentic OS for Financial Advisors: The 2026 Strategic Buyer's Guide — WealthTech Today](https://wealthtechtoday.com/ai-notetakers-financial-advisors-2026/)
              - - [The AI Notetaker Is Eating Your CRM — WealthTech Today](https://wealthtechtoday.com/2026/05/18/the-ai-notetaker-is-eating-your-crm-you-just-havent-noticed-yet/)
                - - [AI Compliance Guide for Financial Advisory Firms — Zocks](https://www.zocks.io/blog/ai-compliance-guide-for-financial-advisory-firms)
                  - 
