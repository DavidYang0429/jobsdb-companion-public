import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { stateWithJob } from "./helpers";
import { hash } from "../src/services/canonical";
function gas() {
  const rows: any[][] = [];
  const props = {
    SPREADSHEET_ID: "sheet",
    SHEET_NAME: "JobsDB",
    TARGET_ID: "target",
    SHARED_SECRET: "s".repeat(32),
  };
  let locked = false;
  const range = (row: number, col: number, height = 1, width = 1) => ({
    getValues: () =>
      Array.from({ length: height }, (_, i) =>
        Array.from(
          { length: width },
          (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? "",
        ),
      ),
    setNumberFormat: () => {},
    setValues: (values: any[][]) => {
      values.forEach((v, i) => {
        rows[row - 1 + i] ??= [];
        v.forEach((cell, j) => {
          rows[row - 1 + i][col - 1 + j] = cell;
        });
      });
    },
    createTextFinder: (text: string) => {
      const finder = {
        matchEntireCell: () => finder,
        useRegularExpression: () => finder,
        findAll: () =>
          rows
            .slice(row - 1, row - 1 + height)
            .flatMap((r, i) =>
              r[col - 1] === text ? [{ getRow: () => row + i }] : [],
            ),
      };
      return finder;
    },
  });
  const sheet = {
    getLastRow: () => rows.length,
    appendRow: (r: any[]) => {
      rows.push(r);
    },
    getRange: range,
  };
  const context = vm.createContext({
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: keyof typeof props) => props[k],
      }),
    },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (s: string) => ({ setMimeType: () => JSON.parse(s) }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: (_a: string, s: string) => [
        ...createHash("sha256").update(s).digest(),
      ],
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => !locked,
        hasLock: () => true,
        releaseLock: () => {},
      }),
    },
    SpreadsheetApp: {
      openById: () => ({ getSheetByName: () => sheet }),
      flush: () => {},
    },
    JSON,
    Number,
    Date,
    Object,
    Array,
    String,
  });
  vm.runInContext(readFileSync("gas/Code.gs", "utf8"), context);
  const task = stateWithJob(true).outbox[0];
  const body = {
    protocolVersion: 1,
    targetId: "target",
    sharedSecret: props.SHARED_SECRET,
    requestId: task.requestId,
    recordId: task.recordId,
    revision: task.revision,
    payload: task.payload,
  };
  return {
    rows,
    body,
    call: (b: any) =>
      (context as any).doPost({ postData: { contents: JSON.stringify(b) } }),
    lock: () => {
      locked = true;
    },
  };
}
it("GAS uses owner-configured target and rejects missing authentication before writes", () => {
  const g = gas();
  expect(g.call({ ...g.body, sharedSecret: "wrong" })).toEqual({
    ok: false,
    code: "AUTH",
    retryable: false,
  });
  expect(g.rows).toHaveLength(0);
  expect(g.call({ ...g.body, targetId: "other" }).ok).toBe(false);
});
it("GAS is idempotent after a lost response and uses the same canonical hash as client", async () => {
  const g = gas();
  const first = g.call(g.body),
    again = g.call({ ...g.body, requestId: "retry" });
  expect(first.ok).toBe(true);
  expect(again.ok).toBe(true);
  expect(again.requestId).toBe("retry");
  expect(g.rows).toHaveLength(2);
  expect(first.payloadHash).toBe(await hash(g.body.payload));
});
it("GAS rejects stale and equal-version conflicting updates", () => {
  const g = gas();
  g.call(g.body);
  const newer = {
    ...g.body,
    revision: 2,
    payload: { ...g.body.payload, notes: "new" },
  };
  expect(g.call(newer).ok).toBe(true);
  expect(g.call(g.body).code).toBe("VERSION_CONFLICT");
  expect(
    g.call({ ...newer, payload: { ...newer.payload, notes: "different" } })
      .code,
  ).toBe("VERSION_CONFLICT");
  expect(g.rows).toHaveLength(2);
  expect(g.rows[1][14]).toBe("new");
});
it("GAS treats formula-looking strings as text and rejects unexpected payload keys", () => {
  const g = gas();
  const request = {
    ...g.body,
    payload: {
      ...g.body.payload,
      notes: '=IMPORTXML("https://example.com","//x")',
    },
  };
  expect(g.call(request).ok).toBe(true);
  expect(g.rows[1][14]).toMatch(/^'/);
  expect(
    g.call({ ...g.body, payload: { ...g.body.payload, apiKey: "secret" } })
      .code,
  ).toBe("INVALID_REQUEST");
});
it("GAS returns retryable lock contention and rejects malformed requests", () => {
  const g = gas();
  g.lock();
  expect(g.call(g.body)).toEqual({ ok: false, code: "BUSY", retryable: true });
  expect(g.call({ ...g.body, revision: 0 }).retryable).toBe(false);
});

it("GAS accepts new statuses and tracking dates, retaining the client hash", async () => {
  const g = gas();
  const body = {
    ...g.body,
    payload: {
      ...g.body.payload,
      status: "waiting_interview",
      appliedAt: "2026-10-15T02:30:00.000Z",
      interviewAt: "2026-10-19T06:00:00.000Z",
    },
  };
  const first = g.call(body);
  expect(first.ok).toBe(true);
  expect(first.payloadHash).toBe(await hash(body.payload));
  expect(g.rows[0].slice(17)).toEqual(["appliedAt", "interviewAt"]);
  expect(g.rows[1].slice(17)).toEqual([
    body.payload.appliedAt,
    body.payload.interviewAt,
  ]);
  expect(
    g.call({
      ...body,
      revision: 2,
      payload: { ...body.payload, status: "no_response", interviewAt: null },
    }).ok,
  ).toBe(true);
  expect(g.rows[1][18]).toBe("");
  expect(
    g.call({
      ...body,
      revision: 3,
      payload: { ...body.payload, appliedAt: "tomorrow" },
    }).code,
  ).toBe("INVALID_REQUEST");
});
it("GAS appends tracking headers to an exact legacy sheet without changing existing rows", () => {
  const g = gas();
  expect(g.call(g.body).ok).toBe(true);
  g.rows[0].length = 17;
  g.rows[1].length = 17;
  const before = JSON.stringify(g.rows[1]);
  expect(g.call({ ...g.body, requestId: "old-task-retry" }).ok).toBe(true);
  expect(g.rows[0].slice(17)).toEqual(["appliedAt", "interviewAt"]);
  expect(JSON.stringify(g.rows[1])).toBe(before);
});
it("GAS refuses legacy header extension when destination columns contain user data", () => {
  const g = gas();
  g.call(g.body);
  g.rows[0].length = 17;
  g.rows[1][17] = "custom value";
  const before = JSON.stringify(g.rows);
  expect(g.call(g.body).code).toBe("HEADER_MISMATCH");
  expect(JSON.stringify(g.rows)).toBe(before);
});
