/**
 * Meeting-note intake: the first, smallest real slice of a wealth-
 * advisor workflow, built on the engine's existing pieces plus the new
 * compliance module in src/integrations/compliance/.
 *
 * What this is honestly: raw meeting notes go in; a deterministic,
 * rule-based pass structures them into a summary and a naive
 * action-item list; that draft is routed through the human-review gate
 * before anything downstream can treat it as usable; every step is
 * written to the hash-chained compliance record log.
 *
 * What this is NOT: this is not gap #6 from docs/product/IIG-V1-SPEC.md
 * ("wealth-specific intent extraction" — tax-loss-harvest flags,
 * rebalance flags, referral signals). The structuring here is a
 * line-heuristic (look for bullet markers, "action"/"follow up"/"todo"
 * keywords), not a model call — there's no live model access verified
 * in the environment this was built in (same constraint noted in
 * docs/integrations/agent-frameworks.md for the LangChain/AutoGen
 * connectors). The `summarize` hook below is exactly where a real
 * intent-extraction pass — using the AutoGen or LangChain sidecars
 * from PR #5, once those are verified against a live model — would
 * plug in. Shipping that is future work, not claimed here.
 *
 * This also does not address gap #4 (PII/consent) or gap #5 (access
 * scoping). Per the v1 spec's own reasoning, compliance (#3),
 * PII/consent (#4), and access scoping (#5) were scoped to ship
 * together because none of them are safe half-done — this module
 * closes a piece of #3 in isolation, which is a reason to keep
 * treating real client data as out of scope, not a reason to consider
 * the compliance gap closed.
 */

import { submitForReview, approve, getApprovedContent, type Draft } from "../../integrations/compliance/index.ts";
import { appendRecord } from "../../integrations/compliance/index.ts";

export interface MeetingNoteInput {
  advisorId: string;
  clientId: string;
  /** ISO date, e.g. "2026-08-20". */
  meetingDate: string;
  rawNotes: string;
}

export interface MeetingNoteDraft {
  draftId: string;
  advisorId: string;
  clientId: string;
  meetingDate: string;
  summary: string;
  actionItems: string[];
}

const ACTION_KEYWORDS = /(action|follow[\s-]?up|todo|next step)/i;
const BULLET = /^\s*[-*•]\s+/;

/**
 * Deterministic structuring pass. Splits notes into lines; a line is
 * an "action item" if it's a bullet AND matches an action keyword, or
 * starts with an explicit action keyword. Everything else becomes the
 * summary, joined back with single newlines (blank lines collapsed).
 * This is intentionally simple and auditable — the point of this pass
 * is to be a real, inspectable placeholder, not to simulate what a
 * model-based extractor would produce.
 */
function structureNotes(rawNotes: string): { summary: string; actionItems: string[] } {
  const lines = rawNotes.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  const actionItems: string[] = [];
  const summaryLines: string[] = [];
  for (const line of lines) {
    const isBullet = BULLET.test(line);
    const text = line.replace(BULLET, "").trim();
    if ((isBullet && ACTION_KEYWORDS.test(text)) || ACTION_KEYWORDS.test(text.slice(0, 20))) {
      actionItems.push(text);
    } else {
      summaryLines.push(text);
    }
  }
  return { summary: summaryLines.join("\n"), actionItems };
}

/**
 * Intake a meeting note: record receipt, structure it, and submit the
 * result for human review. Returns the draft's id plus the structured
 * (unapproved) content — callers that need the reviewer-approved
 * version must go through getApprovedMeetingNote() below, which
 * enforces the review gate.
 */
export function intakeMeetingNote(input: MeetingNoteInput): MeetingNoteDraft {
  appendRecord({
    type: "meeting_note.received",
    actorId: `system:meeting-note-intake`,
    subjectId: input.clientId,
    payload: {
      advisorId: input.advisorId,
      meetingDate: input.meetingDate,
      rawNotesLength: input.rawNotes.length,
    },
  });

  const { summary, actionItems } = structureNotes(input.rawNotes);
  const content = JSON.stringify({ summary, actionItems });

  const draft = submitForReview({
    authorId: "system:meeting-note-intake",
    subjectId: input.clientId,
    content,
  });

  return {
    draftId: draft.id,
    advisorId: input.advisorId,
    clientId: input.clientId,
    meetingDate: input.meetingDate,
    summary,
    actionItems,
  };
}

/**
 * Convenience wrapper: an advisor (or a compliance reviewer — anyone
 * except the "system:meeting-note-intake" author) approves a pending
 * meeting-note draft. Thin pass-through to review-gate's approve(),
 * kept here so callers working at the workflow level don't need to
 * import from the compliance module directly for the common case.
 */
export function approveMeetingNote(draftId: string, reviewerId: string, note?: string): Draft {
  return approve(draftId, reviewerId, note);
}

/** Read back the approved, structured meeting note. Throws (via the review gate) if it hasn't been approved yet — there is no path in this module that returns unapproved content as if it were final. */
export function getApprovedMeetingNote(draftId: string): { summary: string; actionItems: string[] } {
  const content = getApprovedContent(draftId);
  return JSON.parse(content) as { summary: string; actionItems: string[] };
}
