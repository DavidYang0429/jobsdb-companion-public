import { it, expect } from "vitest";
import { build } from "esbuild";
import vm from "node:vm";
import { job, resumeFor } from "./helpers";
import { RUNTIME_CONTRACT } from "../src/services/runtimeContract";
async function worker() {
  const bundle = await build({
    entryPoints: ["src/background/serviceWorker.ts"],
    bundle: true,
    write: false,
    format: "iife",
    target: "es2022",
  });
  let listener: Function | undefined;
  const storage: Record<string, unknown> = {};
  let access = "";
  const event = { addListener: () => {} };
  const chrome = {
    storage: {
      local: {
        setAccessLevel: async (c: { accessLevel: string }) => {
          access = c.accessLevel;
        },
        get: async (k: string) => ({ [k]: structuredClone(storage[k]) }),
        set: async (s: object) => Object.assign(storage, structuredClone(s)),
        getBytesInUse: async () => JSON.stringify(storage).length,
      },
    },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    alarms: { create: async () => {}, onAlarm: event },
    runtime: {
      id: "test-id",
      getURL: (s: string) => "chrome-extension://test-id/" + s,
      onInstalled: event,
      onStartup: event,
      onMessage: {
        addListener: (fn: Function) => {
          listener = fn;
        },
      },
    },
    tabs: {
      query: async () => [
        { id: 10, url: "https://hk.jobsdb.com/job/95315223" },
      ],
      create: async () => {},
      sendMessage: async () => ({ ok: false, error: "fixture" }),
    },
  };
  const context = vm.createContext({
    chrome,
    crypto,
    structuredClone,
    URL,
    AbortSignal,
    TextEncoder,
    TextDecoder,
    console,
    setTimeout,
    clearTimeout,
    fetch,
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const send = (
    message: unknown,
    url = "chrome-extension://test-id/src/dashboard/index.html",
  ) =>
    new Promise<any>((resolve) =>
      listener!(
        { runtimeContract: RUNTIME_CONTRACT, ...(message as object) },
        { id: "test-id", url },
        resolve,
      ),
    );
  return { send, getAccess: () => access };
}
it("extension message boundary denies content-script reads and validates mutation commands", async () => {
  const w = await worker();
  expect(w.getAccess()).toBe("TRUSTED_CONTEXTS");
  expect(
    (await w.send({ type: "read" }, "https://hk.jobsdb.com/job/95315223")).ok,
  ).toBe(false);
  const first = await w.send({ type: "read" });
  expect(first.ok).toBe(true);
  const saved = await w.send({
    type: "command",
    command: {
      type: "addJob",
      categoryId: first.state.categories[0].id,
      job: job(),
    },
  });
  expect(saved.ok).toBe(true);
  const read = await w.send({ type: "read" });
  expect(read.state.records).toHaveLength(1);
  expect(
    (
      await w.send({
        type: "command",
        command: { type: "arbitraryFetch", url: "https://example.com" },
      })
    ).ok,
  ).toBe(false);
});
it("capture save boundary rechecks active tab identity", async () => {
  const w = await worker();
  const first = await w.send({ type: "read" });
  const mismatch = await w.send({
    type: "saveCaptured",
    tabId: 11,
    categoryId: first.state.categories[0].id,
    job: job(),
  });
  expect(mismatch.ok).toBe(false);
  const valid = await w.send({
    type: "saveCaptured",
    tabId: 10,
    categoryId: first.state.categories[0].id,
    job: job(),
  });
  expect(valid.ok).toBe(true);
});

it("background saves PDF-versioned resumes with empty tracking dates and rejects stale UI contracts", async () => {
  const w = await worker();
  expect((await w.send({ type: "runtimeContract" })).runtimeContract).toBe(
    RUNTIME_CONTRACT,
  );
  const first = await w.send({ type: "read" });
  const added = await w.send({
    type: "command",
    command: {
      type: "addJob",
      categoryId: first.state.categories[0].id,
      job: job(),
    },
  });
  const s = added.state;
  const resume = resumeFor(s);
  resume.layout.pdfExportVersion = "pdf-v1";
  const command = {
    type: "resume",
    resume,
    expectedRevision: s.records[0].revision,
    expectedMasterVersion: s.master.version,
  };
  const stale = await w.send({
    type: "command",
    runtimeContract: "old",
    command,
  });
  expect(stale.ok).toBe(false);
  expect(stale.error).toContain("重新加载");
  expect((await w.send({ type: "read" })).state.resumes).toHaveLength(0);
  const saved = await w.send({ type: "command", command });
  expect(saved.ok).toBe(true);
  expect(saved.state.resumes[0].layout.pdfExportVersion).toBe("pdf-v1");
  expect(saved.state.records[0].appliedAt).toBeUndefined();
  expect(saved.state.records[0].interviewAt).toBeUndefined();
  const reloaded = await w.send({ type: "read" });
  expect(reloaded.state.resumes[0].layout.pdfExportVersion).toBe("pdf-v1");
});
