import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { intakeMeetingNote, approveMeetingNote, getApprovedMeetingNote } from "../../src/workflows/wealth/meeting-note-intake.ts";
import { __resetForTests } from "../../src/integrations/compliance/review-gate.ts";
import { verifyChain } from "../../src/integrations/compliance/record-log.ts";

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iig-meeting-note-test-"));
  prevEnv = process.env.GBRAIN_COMPLIANCE_DIR;
  process.env.GBRAIN_COMPLIANCE_DIR = tmpDir;
  __resetForTests();
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.GBRAIN_COMPLIANCE_DIR;
  else process.env.GBRAIN_COMPLIANCE_DIR = prevEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const SAMPLE_NOTES = `Client is comfortable with current allocation, no changes requested.
- Follow up on tax-loss harvesting before year end
Discussed college savings timeline for younger child.
TODO: send updated risk questionnaire
Client asked general question about Roth conversion, no action taken.`;

describe("intakeMeetingNote", () => {
  it("splits action items from summary using the line heuristic", () => {
    const draft = intakeMeetingNote({
      advisorId: "advisor-amer",
      clientId: "client-1",
      meetingDate: "2026-08-20",
      rawNotes: SAMPLE_NOTES,
    });

    expect(draft.actionItems).toHaveLength(2);
    expect(draft.actionItems[0]).toMatch(/tax-loss harvesting/);
    expect(draft.actionItems[1]).toMatch(/risk questionnaire/);
    expect(draft.summary).toMatch(/current allocation/);
    expect(draft.summary).not.toMatch(/tax-loss harvesting/);
  });

  it("does not let the draft's content be read before approval", () => {
    const draft = intakeMeetingNote({
      advisorId: "advisor-amer",
      clientId: "client-1",
      meetingDate: "2026-08-20",
      rawNotes: SAMPLE_NOTES,
    });
    expect(() => getApprovedMeetingNote(draft.draftId)).toThrow(/is pending_review, not approved/);
  });

  it("returns the structured note once an advisor approves it, and leaves a verifiable record chain", () => {
    const draft = intakeMeetingNote({
      advisorId: "advisor-amer",
      clientId: "client-1",
      meetingDate: "2026-08-20",
      rawNotes: SAMPLE_NOTES,
    });
    approveMeetingNote(draft.draftId, "advisor-amer", "confirmed accurate");
    const approved = getApprovedMeetingNote(draft.draftId);
    expect(approved.actionItems).toHaveLength(2);
    expect(approved.summary).toBe(draft.summary);

    const result = verifyChain();
    expect(result.ok).toBe(true);
    // meeting_note.received + draft.submitted + draft.approved
    expect(result.recordCount).toBe(3);
  });
});
