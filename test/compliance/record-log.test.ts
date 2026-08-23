/**
 * Contract test for the hash-chained compliance record log. Runs for
 * real under `bun test` — no external dependencies, no network, no
 * database. Hermetic via GBRAIN_COMPLIANCE_DIR pointed at a fresh
 * tmpdir per test.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { appendRecord, readAll, verifyChain, resolveComplianceDir } from "../../src/integrations/compliance/record-log.ts";

let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "iig-compliance-test-"));
  prevEnv = process.env.GBRAIN_COMPLIANCE_DIR;
  process.env.GBRAIN_COMPLIANCE_DIR = tmpDir;
});

afterEach(() => {
  if (prevEnv === undefined) delete process.env.GBRAIN_COMPLIANCE_DIR;
  else process.env.GBRAIN_COMPLIANCE_DIR = prevEnv;
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("resolveComplianceDir", () => {
  it("honors GBRAIN_COMPLIANCE_DIR override", () => {
    expect(resolveComplianceDir()).toBe(tmpDir);
  });
});

describe("appendRecord / readAll", () => {
  it("starts empty on a fresh dir", () => {
    expect(readAll()).toEqual([]);
  });

  it("chains prevHash correctly across appends", () => {
    const r1 = appendRecord({ type: "test.one", actorId: "system:test", payload: { n: 1 } });
    const r2 = appendRecord({ type: "test.two", actorId: "system:test", payload: { n: 2 } });
    const r3 = appendRecord({ type: "test.three", actorId: "system:test", payload: { n: 3 } });

    expect(r1.prevHash).toBeNull();
    expect(r2.prevHash).toBe(r1.hash);
    expect(r3.prevHash).toBe(r2.hash);

    const all = readAll();
    expect(all.map((r) => r.id)).toEqual([r1.id, r2.id, r3.id]);
  });

  it("gives every record a distinct id and a 64-char hex hash", () => {
    const r1 = appendRecord({ type: "test.one", actorId: "a", payload: {} });
    const r2 = appendRecord({ type: "test.two", actorId: "a", payload: {} });
    expect(r1.id).not.toBe(r2.id);
    expect(r1.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("verifyChain", () => {
  it("reports ok on an untouched chain, including the empty case", () => {
    expect(verifyChain()).toEqual({ ok: true, recordCount: 0 });
    appendRecord({ type: "test.one", actorId: "a", payload: {} });
    appendRecord({ type: "test.two", actorId: "a", payload: {} });
    const result = verifyChain();
    expect(result.ok).toBe(true);
    expect(result.recordCount).toBe(2);
  });

  it("detects a tampered payload", () => {
    appendRecord({ type: "test.one", actorId: "a", payload: { amount: 100 } });
    appendRecord({ type: "test.two", actorId: "a", payload: { amount: 200 } });

    const file = path.join(tmpDir, "records.jsonl");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    const tampered = JSON.parse(lines[0]);
    tampered.payload.amount = 999999; // change history without recomputing the hash
    lines[0] = JSON.stringify(tampered);
    fs.writeFileSync(file, lines.join("\n") + "\n");

    const result = verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(0);
    expect(result.reason).toMatch(/hash does not match/);
  });

  it("detects a deleted record (broken chain linkage)", () => {
    appendRecord({ type: "test.one", actorId: "a", payload: {} });
    appendRecord({ type: "test.two", actorId: "a", payload: {} });
    appendRecord({ type: "test.three", actorId: "a", payload: {} });

    const file = path.join(tmpDir, "records.jsonl");
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    lines.splice(1, 1); // remove the middle record entirely
    fs.writeFileSync(file, lines.join("\n") + "\n");

    const result = verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAt).toBe(1);
    expect(result.reason).toMatch(/prevHash/);
  });
});
