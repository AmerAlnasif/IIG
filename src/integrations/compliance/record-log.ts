/**
 * Hash-chained, append-only compliance record log.
 *
 * This is a sibling to src/core/audit/audit-writer.ts, not a
 * replacement for it. The existing audit-writer is explicitly scoped
 * as "operational trace, not forensic insurance" — best-effort writes,
 * silently-skippable corrupt rows, a rolling window read-back, no
 * tamper detection. That's the right tradeoff for the things it backs
 * (rerank failures, shell job traces, supervisor heartbeats): losing an
 * entry costs you a debugging breadcrumb.
 *
 * A compliance record for a wealth-management workflow needs a
 * stronger property: if an entry is edited or deleted after the fact,
 * that has to be detectable, not just possible to miss. So this module
 * adds a hash chain — every record includes the SHA-256 hash of the
 * record before it, and verifyChain() recomputes the whole chain and
 * reports the first break. It reuses resolveGbrainDir()'s pattern
 * (gbrainPath + an env override) rather than the audit-writer's
 * ISO-week file rotation, because compliance records should not be
 * pruned by a rolling read-back window the way operational traces are
 * — retention here is "keep everything," not "keep 7-14 days."
 *
 * Honest limits, stated plainly:
 *
 * 1. This is a hash chain over a plain, writable JSONL file — it makes
 *    tampering DETECTABLE (verifyChain() will report a break), it does
 *    not make tampering IMPOSSIBLE. SEC Rule 17a-4 requires
 *    non-rewriteable, non-erasable storage (WORM). This module doesn't
 *    provide that; pairing it with WORM-backed storage (S3 Object Lock,
 *    a write-once volume, etc.) is real future work, not done here.
 * 2. appendRecord() is safe for a single process. It reads the last
 *    line synchronously to chain off of, then appends — under
 *    concurrent writers from multiple processes there is a race
 *    between the read and the append that could fork the chain. A
 *    production deployment with more than one writer needs either a
 *    file lock or (better) a Postgres-backed sequence instead of a
 *    flat file. Documented, not solved, here.
 * 3. Building this module does not make IIG SEC/FINRA compliant. It
 *    closes one code-level piece of gap #3 from
 *    docs/product/IIG-V1-SPEC.md. Gaps #4 (PII/consent) and #5 (access
 *    scoping) are untouched and, per that same spec, the three were
 *    scoped to ship together because none of them are safe half-done.
 *    See docs/compliance/recordkeeping-and-review.md.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { gbrainPath } from "../../core/config.ts";
import type { ChainVerification, ComplianceRecord } from "./types.ts";

/** Resolve the compliance record directory. Honors GBRAIN_COMPLIANCE_DIR for container/sandbox deploys, same pattern as GBRAIN_AUDIT_DIR. */
export function resolveComplianceDir(): string {
  const override = process.env.GBRAIN_COMPLIANCE_DIR;
  if (override && override.trim().length > 0) return override;
  return gbrainPath("compliance");
}

function recordFilePath(): string {
  return path.join(resolveComplianceDir(), "records.jsonl");
}

/** Canonical, field-order-stable JSON used as hash input. Field order matters for a hash — this fixes it explicitly rather than relying on JSON.stringify's insertion-order behavior across call sites. */
function canonicalize(r: Omit<ComplianceRecord, "hash">): string {
  return JSON.stringify({
    id: r.id,
    ts: r.ts,
    type: r.type,
    actorId: r.actorId,
    subjectId: r.subjectId ?? null,
    payload: r.payload,
    prevHash: r.prevHash,
  });
}

function computeHash(r: Omit<ComplianceRecord, "hash">): string {
  return createHash("sha256").update(canonicalize(r)).digest("hex");
}

/** Read every record currently on disk, in append order. Missing file = empty log (not an error — a brand-new deployment has no history yet). Throws on a corrupt (non-JSON) line rather than skipping it, unlike the operational audit-writer: a record log that silently drops unreadable entries defeats the point. */
export function readAll(): ComplianceRecord[] {
  const file = recordFilePath();
  let content: string;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: ComplianceRecord[] = [];
  const lines = content.split("\n").filter((l) => l.length > 0);
  for (const [i, line] of lines.entries()) {
    try {
      out.push(JSON.parse(line) as ComplianceRecord);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`compliance record log corrupt at line ${i + 1} of ${file}: ${msg}`);
    }
  }
  return out;
}

export interface AppendInput {
  type: string;
  actorId: string;
  subjectId?: string;
  payload: Record<string, unknown>;
}

/** Append one record, chained to whatever is currently last on disk. Returns the full record as written, including its computed hash — callers that need to reference "the record for this action" (e.g. review-gate.ts linking a draft to its submission event) use the returned id. */
export function appendRecord(input: AppendInput): ComplianceRecord {
  const dir = resolveComplianceDir();
  fs.mkdirSync(dir, { recursive: true });

  const existing = readAll();
  const prevHash = existing.length > 0 ? existing[existing.length - 1].hash : null;

  const base: Omit<ComplianceRecord, "hash"> = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type: input.type,
    actorId: input.actorId,
    subjectId: input.subjectId,
    payload: input.payload,
    prevHash,
  };
  const record: ComplianceRecord = { ...base, hash: computeHash(base) };

  fs.appendFileSync(recordFilePath(), JSON.stringify(record) + "\n", { encoding: "utf8" });
  return record;
}

/** Recompute every hash and linkage from scratch and report the first mismatch, if any. O(n) in the number of records — this is meant to be run periodically or on demand (e.g. from a `doctor`-style command), not on every append. */
export function verifyChain(): ChainVerification {
  const records = readAll();
  let prevHash: string | null = null;
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r.prevHash !== prevHash) {
      return {
        ok: false,
        recordCount: records.length,
        brokenAt: i,
        reason: `record ${i} (${r.id}) has prevHash ${JSON.stringify(r.prevHash)}, expected ${JSON.stringify(prevHash)}`,
      };
    }
    const { hash, ...rest } = r;
    const expected = computeHash(rest);
    if (hash !== expected) {
      return {
        ok: false,
        recordCount: records.length,
        brokenAt: i,
        reason: `record ${i} (${r.id}) hash does not match its contents — recomputed ${expected}, stored ${hash}`,
      };
    }
    prevHash = hash;
  }
  return { ok: true, recordCount: records.length };
}
