import { it, expect } from "vitest";
import {
  createSyncRunner,
  postTask,
  SyncError,
} from "../src/services/googleSheetsSync";
import { hash } from "../src/services/canonical";
import { stateWithJob, memoryStore } from "./helpers";
const ack = async (t: any) => ({
  ok: true as const,
  targetId: t.targetId,
  requestId: t.requestId,
  recordId: t.recordId,
  appliedRevision: t.revision,
  payloadHash: await hash(t.payload),
});
it("requires readable business acknowledgement, not merely HTTP 200", async () => {
  const s = stateWithJob(true);
  await expect(
    postTask(
      s.outbox[0],
      s.settings.googleSheets,
      async () => new Response("ok", { status: 200 }),
    ),
  ).rejects.toThrow("无法读取");
  await expect(
    postTask(s.outbox[0], s.settings.googleSheets, async () =>
      Response.json({ ok: false, code: "AUTH", retryable: false }),
    ),
  ).rejects.toThrow("AUTH");
});
it("rejects mismatched acknowledgement version", async () => {
  const s = stateWithJob(true),
    a = await ack(s.outbox[0]);
  await expect(
    postTask(s.outbox[0], s.settings.googleSheets, async () =>
      Response.json({ ...a, appliedRevision: 99 }),
    ),
  ).rejects.toThrow("冲突");
});
it("old response cannot mark a newly edited record as synced", async () => {
  const m = memoryStore(stateWithJob(true));
  let release!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  let started!: () => void;
  const begin = new Promise<void>((r) => {
    started = r;
  });
  let calls = 0;
  const runner = createSyncRunner(m.store, async (t) => {
    calls++;
    if (calls === 1) {
      started();
      await wait;
    } else throw new SyncError("offline", true);
    return ack(t);
  });
  const pending = runner();
  await begin;
  const s = await m.store.read();
  await m.store.command({
    type: "updateRecord",
    id: s.records[0].id,
    expectedRevision: 1,
    patch: { notes: "newer" },
  });
  release();
  await pending;
  expect(m.get()!.records[0].sync.status).toBe("pending");
  expect(m.get()!.outbox[0].revision).toBe(2);
});
it("resumes persisted uncertain tasks using the same request ID after response loss", async () => {
  const m = memoryStore(stateWithJob(true)),
    id = m.get()!.outbox[0].requestId;
  await createSyncRunner(m.store, async () => {
    throw new TypeError("network");
  })();
  await m.store.mutate((s) => {
    s.outbox[0].nextAttemptAt = new Date(0).toISOString();
  });
  let retried = "";
  await createSyncRunner(m.store, async (t) => {
    retried = t.requestId;
    return ack(t);
  })();
  expect(retried).toBe(id);
  expect(m.get()!.outbox).toHaveLength(0);
  expect(m.get()!.records[0].sync.status).toBe("synced");
});
it("stops auto retrying authentication failures", async () => {
  const m = memoryStore(stateWithJob(true));
  let count = 0;
  const runner = createSyncRunner(m.store, async () => {
    count++;
    throw new SyncError("AUTH", false);
  });
  await runner();
  await runner();
  expect(count).toBe(1);
  expect(m.get()!.records[0].sync.status).toBe("failed");
});
it("ignores old target acknowledgements after settings change", async () => {
  const m = memoryStore(stateWithJob(true));
  let trigger!: () => void;
  const wait = new Promise<void>((r) => (trigger = r));
  let start!: () => void;
  const began = new Promise<void>((r) => (start = r));
  const run = createSyncRunner(m.store, async (t) => {
    start();
    await wait;
    return ack(t);
  });
  const running = run();
  await began;
  await m.store.mutate((s) => {
    s.settings.googleSheets.enabled = false;
    s.outbox = [];
    s.records[0].sync = { status: "unconfigured" };
  });
  trigger();
  await running;
  expect(m.get()!.records[0].sync.status).toBe("unconfigured");
});
it("recovers an interrupted final attempt into a visible failure rather than leaving syncing forever", async () => {
  const s = stateWithJob(true);
  s.outbox[0].attempts = 5;
  s.records[0].sync.status = "syncing";
  const m = memoryStore(s);
  await createSyncRunner(m.store, async () => {
    throw Error("must not resend without explicit retry");
  })();
  expect(m.get()!.records[0].sync.status).toBe("failed");
});
