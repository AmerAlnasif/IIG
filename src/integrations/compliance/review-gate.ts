/**
 * Human-review gate for AI-drafted, client-facing content.
 *
 * Encodes the principle behind FINRA Rule 3110 — a human reviews an
 * AI-generated output before it's used with a client — as an actual
 * control instead of a paragraph in a spec doc. The rule this module
 * enforces: content produced by a draft's authorId can only become
 * "approved" (usable) through an explicit approve() call from a
 * DIFFERENT actor, and every submission, approval, and rejection is
 * written to the hash-chained compliance record log in record-log.ts,
 * so the review history itself is tamper-evident.
 *
 * Honest scope: draft state lives in an in-memory Map, not a database.
 * That's fine for the record log — every state transition is durably
 * recorded there regardless — but the *current* status of a draft
 * (e.g. "is draft X still pending?") does not survive a process
 * restart in this version. A real deployment should back this Map
 * with the engine's existing Postgres/PGLite storage (schema packs
 * would be a natural fit) so draft state is queryable and durable the
 * same way everything else in the brain is. That's noted as future
 * work in docs/compliance/recordkeeping-and-review.md, not done here.
 */

import { randomUUID } from "node:crypto";
import { appendRecord } from "./record-log.ts";
import type { Draft } from "./types.ts";

const drafts = new Map<string, Draft>();

export class ReviewGateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewGateError";
  }
}

export interface SubmitInput {
  /** The system/agent producing this content. Never a human reviewer's identity. */
  authorId: string;
  subjectId: string;
  content: string;
}

/** Submit AI-drafted content for review. Returns the draft in `pending_review` status — nothing downstream can read its content as approved until a distinct reviewer calls approve(). */
export function submitForReview(input: SubmitInput): Draft {
  const draft: Draft = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "pending_review",
    authorId: input.authorId,
    subjectId: input.subjectId,
    content: input.content,
  };
  drafts.set(draft.id, draft);
  appendRecord({
    type: "draft.submitted",
    actorId: input.authorId,
    subjectId: draft.id,
    payload: { draftSubjectId: input.subjectId, contentLength: input.content.length },
  });
  return draft;
}

function getDraftOrThrow(draftId: string): Draft {
  const draft = drafts.get(draftId);
  if (!draft) throw new ReviewGateError(`no draft with id ${draftId} (in-memory store — see module scope note if this ran in a different process)`);
  return draft;
}

/** Approve a draft. reviewerId must differ from the draft's authorId — a system approving its own output isn't a human-review gate, it's a no-op with extra steps, and this throws rather than silently allowing it. */
export function approve(draftId: string, reviewerId: string, note?: string): Draft {
  const draft = getDraftOrThrow(draftId);
  if (draft.status !== "pending_review") {
    throw new ReviewGateError(`draft ${draftId} is already ${draft.status}, cannot approve`);
  }
  if (reviewerId === draft.authorId) {
    throw new ReviewGateError(
      `reviewerId (${reviewerId}) must differ from the draft's authorId (${draft.authorId}) — same-actor approval defeats the human-review gate`,
    );
  }
  draft.status = "approved";
  draft.reviewerId = reviewerId;
  draft.reviewedAt = new Date().toISOString();
  draft.reviewNote = note;
  appendRecord({
    type: "draft.approved",
    actorId: reviewerId,
    subjectId: draftId,
    payload: { note: note ?? null },
  });
  return draft;
}

/** Reject a draft. Same distinct-reviewer requirement as approve(). */
export function reject(draftId: string, reviewerId: string, reason: string): Draft {
  const draft = getDraftOrThrow(draftId);
  if (draft.status !== "pending_review") {
    throw new ReviewGateError(`draft ${draftId} is already ${draft.status}, cannot reject`);
  }
  if (reviewerId === draft.authorId) {
    throw new ReviewGateError(
      `reviewerId (${reviewerId}) must differ from the draft's authorId (${draft.authorId}) — same-actor rejection is meaningless but should still be a distinct identity`,
    );
  }
  draft.status = "rejected";
  draft.reviewerId = reviewerId;
  draft.reviewedAt = new Date().toISOString();
  draft.reviewNote = reason;
  appendRecord({
    type: "draft.rejected",
    actorId: reviewerId,
    subjectId: draftId,
    payload: { reason },
  });
  return draft;
}

/** The enforcement point: throws unless the draft has actually been approved by a distinct reviewer. Nothing that wants "the usable text" should read draft.content directly — it should call this. */
export function getApprovedContent(draftId: string): string {
  const draft = getDraftOrThrow(draftId);
  if (draft.status !== "approved") {
    throw new ReviewGateError(`draft ${draftId} is ${draft.status}, not approved — refusing to return its content`);
  }
  return draft.content;
}

export function getDraft(draftId: string): Draft {
  return { ...getDraftOrThrow(draftId) };
}

export function listPending(): Draft[] {
  return [...drafts.values()].filter((d) => d.status === "pending_review");
}

/** Test-only escape hatch to reset the in-memory store between test files. Not exported from index.ts. */
export function __resetForTests(): void {
  drafts.clear();
}
