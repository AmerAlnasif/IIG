import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  submitForReview,
  approve,
  reject,
  getApprovedContent,
  getDraft,
  listPending,
  ReviewGateError,
  __resetForTests,
} from "../../src/integrations/compliance/review-gate.ts";
import { readAll, verifyChain } from "../../src/integrations/compliance/record-log.ts";

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iig-review-gate-test-"));
  prevEnv = process.env.GBRAIN_COMPLIANCE_DIR;
  process.env.GBRAIN_COMPLIANCE_DIR = tmpDir;
  __resetForTests();
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.GBRAIN_COMPLIANCE_DIR;
  else process.env.GBRAIN_COMPLIANCE_DIR = prevEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("submitForReview", () => {
  it("creates a pending_review draft and logs it", () => {
    const draft = submitForReview({ authorId: "system:test", subjectId: "client-1", content: "hello" });
    expect(draft.status).toBe("pending_review");
    expect(listPending().map((d) => d.id)).toContain(draft.id);

    const records = readAll();
    expect(records).toHaveLength(1);
    expect(records[0].type).toBe("draft.submitted");
    expect(records[0].actorId).toBe("system:test");
  });
});

describe("getApprovedContent", () => {
  it("refuses to return content for a pending draft", () => {
    const draft = submitForReview({ authorId: "system:test", subjectId: "client-1", content: "hello" });
    expect(() => getApprovedContent(draft.id)).toThrow(ReviewGateError);
  });

  it("returns content once a distinct reviewer approves", () => {
    const draft = submitForReview({ authorId: "system:test", subjectId: "client-1", content: "hello" });
    approve(draft.id, "advisor-amer");
    expect(getApprovedContent(draft.id)).toBe("hello");
  });
});

describe("approve", () => {
  it("rejects same-actor approval", () => {
    const draft = submitForReview({ authorId: "system:test", subjectId: "client-1", content: "hello" });
    expect(() => approve(draft.id, "system:test")).toThrow(/must differ from the draft's authorId/);
  });

  it("rejects double-approval", () => {
    const draft = submitForReview({ authorId: "system:test", subjectId: "client-1", content: "hello" });
    approve(draft.id, "advisor-amer");
    expect(() => approve(draft.id, "advisor-amer")).toThrow(/already approved/);
  });

  it("records reviewerId and reviewedAt on the draft", () => {
    const draft = submitForReview({ authorId: "system:test", subjectId: "client-1", content: "hello" });
    const approved = approve(draft.id, "advisor-amer", "looks right");
    expect(approved.reviewerId).toBe("advisor-amer");
    expect(approved.reviewNote).toBe("looks right");
    expect(approved.reviewedAt).toBeTruthy();
  });
});

describe("reject", () => {
  it("moves a draft to rejected and blocks getApprovedContent", () => {
    const draft = submitForReview({ authorId: "system:test", subjectId: "client-1", content: "hello" });
    reject(draft.id, "advisor-amer", "not accurate");
    expect(getDraft(draft.id).status).toBe("rejected");
    expect(() => getApprovedContent(draft.id)).toThrow(ReviewGateError);
  });
});

describe("record log integrity across a full review flow", () => {
  it("leaves a verifiable, unbroken chain", () => {
    const d1 = submitForReview({ authorId: "system:test", subjectId: "client-1", content: "a" });
    const d2 = submitForReview({ authorId: "system:test", subjectId: "client-2", content: "b" });
    approve(d1.id, "advisor-amer");
    reject(d2.id, "advisor-amer", "needs rework");

    const result = verifyChain();
    expect(result.ok).toBe(true);
    expect(result.recordCount).toBe(4); // 2 submitted + 1 approved + 1 rejected
  });
});
