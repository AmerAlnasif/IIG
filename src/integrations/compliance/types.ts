/**
 * Shared types for the compliance record log and human-review gate.
 *
 * Scope note (read this before using either module for anything real):
 * these types back a code-level implementation of gap #3 from
 * docs/product/IIG-V1-SPEC.md ("No compliance-grade audit trail"). They
 * give IIG a hash-chained, append-only event log and a review gate that
 * structurally prevents AI-drafted content from being marked usable
 * without a distinct human reviewer's sign-off. They do NOT, on their
 * own, satisfy SEC Rule 17a-4 (which requires non-rewriteable, non-
 * erasable storage — this writes to a normal, deletable file) or make
 * IIG legally compliant with anything. See
 * docs/compliance/recordkeeping-and-review.md for the full honest
 * accounting of what this closes and what it doesn't.
 */

/** A single immutable entry in the compliance record log. */
export interface ComplianceRecord {
  /** Random UUID, generated at append time. */
  id: string;
  /** ISO-8601 timestamp, generated at append time (not caller-supplied). */
  ts: string;
  /**
   * Event type, dot-namespaced by domain. Examples used by this
   * package: 'meeting_note.received', 'draft.submitted',
   * 'draft.approved', 'draft.rejected'.
   */
  type: string;
  /**
   * Who or what performed the action. A human reviewer's id for
   * approve/reject events; a 'system:<module-name>' string for
   * automated steps. Never a real advisor id for an AI-drafted step —
   * see review-gate.ts's authorId/reviewerId distinction.
   */
  actorId: string;
  /** Optional id of the thing this event is about (a draft id, client id, etc). */
  subjectId?: string;
  /** Event-specific data. Keep this small — this is a record log, not a blob store. */
  payload: Record<string, unknown>;
  /** Hash of the previous record in the chain, or null for the first record. */
  prevHash: string | null;
  /** SHA-256 hex digest of this record (every field above, canonically ordered). */
  hash: string;
}

/** Result of walking the full chain and recomputing every hash. */
export interface ChainVerification {
  ok: boolean;
  recordCount: number;
  /** Index (0-based) of the first record whose hash or linkage didn't check out, if any. */
  brokenAt?: number;
  reason?: string;
}

export type DraftStatus = "pending_review" | "approved" | "rejected";

export interface Draft {
  id: string;
  createdAt: string;
  status: DraftStatus;
  /**
   * The system or agent that produced this content — never a human's
   * identity, since a draft here is by definition AI/automation-
   * produced content that hasn't been reviewed yet.
   */
  authorId: string;
  /** What the draft is about — typically a client id or meeting id. */
  subjectId: string;
  content: string;
  reviewerId?: string;
  reviewedAt?: string;
  reviewNote?: string;
}
