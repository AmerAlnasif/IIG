# Compliance record log and human-review gate

## Why this doc exists

`docs/product/IIG-V1-SPEC.md` lists six gaps between IIG's inherited engine and a real wealth-management deployment. Gap #3, "No compliance-grade audit trail," is the one the spec itself flags as blocking: *"This is the one gap that should block any real client data from touching IIG until it's closed."* This PR closes a piece of it in code — `src/integrations/compliance/` and the first workflow built on it, `src/workflows/wealth/meeting-note-intake.ts`. This doc covers what was built, what it actually closes, and — because the honest answer is "not the whole gap, and not the other two gaps the spec says have to ship alongside it" — what it doesn't.

## What was built

**`src/integrations/compliance/record-log.ts`** — an append-only event log where every record includes the SHA-256 hash of the record before it. `verifyChain()` recomputes the whole chain and reports the first break, so an edited or deleted entry is detectable rather than silently possible. It's a sibling to the existing `src/core/audit/audit-writer.ts`, not a replacement — that module is explicitly scoped as an operational trace (best-effort, prunable, no tamper detection), which is the right tradeoff for debugging breadcrumbs and the wrong one for a compliance record.

**`src/integrations/compliance/review-gate.ts`** — a draft goes from `pending_review` to `approved` or `rejected` only through an explicit call from a reviewer whose id differs from the draft's author. `getApprovedContent()` is the only way to read a draft's content back out, and it throws for anything not in `approved` status. Every submission, approval, and rejection is written to the record log. This is the code-level version of the human-review-before-use principle behind FINRA Rule 3110.

**`src/workflows/wealth/meeting-note-intake.ts`** — the first real (if small) wealth-advisor workflow: raw meeting notes go in, a deterministic line-heuristic pass splits them into a summary and action items, and the result is routed through the review gate before anything can read it as final.

## What was actually verified, and how

Unlike the MCP sidecar work in PR #5, this code has no external dependencies — `node:fs`, `node:crypto`, `node:path`, and the repo's own modules only. That means it could be run directly rather than only type-checked. 18 tests across three files (`bun test`, no mocks, hermetic via a per-test tmpdir and a `GBRAIN_COMPLIANCE_DIR` override) all pass, covering: hash-chain linkage across sequential appends; `verifyChain()` correctly detecting both a tampered payload and a deleted record; the review gate refusing same-actor approval, double-approval, and any content read before approval; and the meeting-note workflow's action-item heuristic against a realistic sample note, end to end through submission and approval with a final chain-integrity check.

One repo-level note unrelated to this PR's own code: running the existing test suite here requires the `ai` npm package (pulled in by `bunfig.toml`'s test preload, which configures the embedding gateway before every test file), and the sandbox this was built in has npm registry access blocked — the same constraint noted in `docs/integrations/agent-frameworks.md`. The new tests were run with that preload temporarily disabled locally to work around the sandbox's network restriction; they make no changes to `bunfig.toml` and should run normally under the standard `bun test` in any environment with dependencies installed.

The new source files type-check cleanly under `tsc --strict` (verified against the repo's own compiler options, using globally-available `@types/node` since `node_modules` isn't installed in this sandbox). The three new test files report only "cannot find module 'bun:test'" under a standalone `tsc` invocation, which is the expected symptom of `bun-types` not being installed rather than a defect — the same class of noise documented in PR #5 — and is moot anyway since those files were verified by actually running them, not just type-checking them.

## What this does not close

This is a piece of gap #3, not the whole thing, and gap #3 alone was never the spec's proposed scope:

- **Not WORM storage.** `record-log.ts` writes to a normal, writable, deletable JSONL file. The hash chain makes tampering *detectable* — `verifyChain()` will report exactly where — it does not make tampering *impossible*. SEC Rule 17a-4 requires non-rewriteable, non-erasable storage. Pairing this with something like S3 Object Lock or a write-once volume is real future work, not done here.
- **Not concurrency-safe across processes.** `appendRecord()` reads the last line synchronously, then appends. A single process is fine; multiple processes writing at once have a race between the read and the append that could fork the chain. A production deployment needs a file lock or, better, a Postgres-backed sequence instead of a flat file.
- **Draft state is in-memory.** `review-gate.ts` keeps pending/approved/rejected drafts in a `Map`, not a database — the record log durably captures every transition regardless, but a process restart loses the ability to look up "is draft X still pending?" by id. Backing this with the engine's existing Postgres/PGLite storage is the natural next step.
- **Gaps #4 and #5 are untouched.** The spec explicitly scoped compliance (#3), PII/consent (#4), and access scoping (#5) to ship together, reasoning that none of them are safe half-done. Shipping #3 alone does not change that reasoning — it's a reason this is a code-level foundation, not a reason to consider real client data safe to route through IIG yet.
- **The meeting-note heuristic is not gap #6.** `structureNotes()` in `meeting-note-intake.ts` is a line-based keyword heuristic, not the "wealth-specific intent extraction" (next-best-action flags: tax-loss-harvesting, rebalancing, referrals) the spec describes as the highest-leverage gap and the actual reason a firm would build this instead of buying Jump or Zocks. The workflow is structured so a real extraction pass — via the LangChain or AutoGen sidecars from PR #5, once those are verified against a live model — has an obvious place to plug in, but that's not built or claimed here.
- **This does not make IIG compliant with anything.** No third party has reviewed this. "Passes 18 tests I wrote myself" is evidence the code does what it claims to do, not evidence that what it claims to do satisfies a regulator.

## Setup

No installation step — the module has no dependencies beyond Node/Bun builtins. `GBRAIN_COMPLIANCE_DIR` optionally overrides where records are written (defaults under the engine's config dir), matching the existing `GBRAIN_AUDIT_DIR` convention in `src/core/audit/audit-writer.ts`.
