import { describe, it, expect } from "vitest";
import {
  reduceCommand,
  exportBackup,
  parseBackup,
} from "../src/services/storage";
import { initialState, StateSchema } from "../src/types/schema";
import { job, stateWithJob, memoryStore, resumeFor } from "./helpers";
describe("local persistence contracts", () => {
  it("persists initial IDs before the first command", async () => {
    const m = memoryStore();
    const first = await m.store.read();
    const saved = await m.store.command({
      type: "addJob",
      categoryId: first.categories[0].id,
      job: job(),
    });
    expect(saved.state.categories[0].id).toBe(first.categories[0].id);
    expect(saved.state.master.id).toBe(first.master.id);
  });
  it("deduplicates within a category and permits independent cross-category tracking", () => {
    let s = stateWithJob();
    const id = s.records[0].id;
    s = reduceCommand(s, {
      type: "addJob",
      categoryId: s.categories[0].id,
      job: job(),
    }).state;
    expect(s.records).toHaveLength(1);
    expect(s.records[0].id).toBe(id);
    s = reduceCommand(s, {
      type: "category",
      name: "Banking",
      expectedRevision: s.revision,
    }).state;
    s = reduceCommand(s, {
      type: "addJob",
      categoryId: s.categories[1].id,
      job: job(),
    }).state;
    expect(s.records).toHaveLength(2);
    expect(s.records[1].id).not.toBe(id);
  });
  it("serializes competing edits and rejects stale revisions", async () => {
    const s = stateWithJob(),
      m = memoryStore(s);
    const cmds = ["one", "two"].map((notes) =>
      m.store.command({
        type: "updateRecord",
        id: s.records[0].id,
        expectedRevision: 1,
        patch: { notes },
      }),
    );
    const results = await Promise.allSettled(cmds);
    expect(results.map((x) => x.status)).toEqual(["fulfilled", "rejected"]);
    expect(m.get()!.records[0].notes).toBe("one");
  });
  it("retains committed state when storage rejects a write", async () => {
    const s = stateWithJob(),
      m = memoryStore(s);
    m.fail();
    await expect(
      m.store.command({
        type: "updateRecord",
        id: s.records[0].id,
        expectedRevision: 1,
        patch: { notes: "unsaved" },
      }),
    ).rejects.toThrow("QUOTA");
    expect(m.get()!.records[0].notes).toBe("");
  });
  it("keeps interview progress and old complete snapshots when the master changes", () => {
    let s = stateWithJob();
    s.records[0].status = "interviewing";
    s.master.fullName = "Original Name";
    const resume = resumeFor(s);
    s = reduceCommand(s, {
      type: "resume",
      resume,
      expectedRevision: 1,
      expectedMasterVersion: 0,
    }).state;
    s = reduceCommand(s, {
      type: "profile",
      profile: { ...s.master, fullName: "New Name" },
      expectedVersion: 0,
    }).state;
    expect(s.records[0].status).toBe("interviewing");
    expect(s.resumes[0].renderedProfile.fullName).toBe("Original Name");
    expect(() =>
      reduceCommand(s, {
        type: "resume",
        resume,
        expectedRevision: 2,
        expectedMasterVersion: 1,
      }),
    ).toThrow("已存在");
  });
  it("rename keeps category IDs and queues new record versions", () => {
    let s = stateWithJob(true);
    const category = s.categories[0].id;
    s = reduceCommand(s, {
      type: "category",
      id: category,
      name: "Renamed",
      expectedRevision: s.revision,
    }).state;
    expect(s.records[0].categoryId).toBe(category);
    expect(s.records[0].revision).toBe(2);
    expect(s.outbox).toHaveLength(1);
    expect(s.outbox[0].payload.categoryName).toBe("Renamed");
  });
  it("exports no config secrets and restores only to empty state with fresh sync metadata", () => {
    const s = stateWithJob(true);
    s.settings.gemini.apiKey = "private-key";
    const backup = exportBackup(s);
    expect(JSON.stringify(backup)).not.toContain("private-key");
    expect(JSON.stringify(backup)).not.toContain("s".repeat(32));
    const restored = reduceCommand(initialState(), {
      type: "restore",
      backup,
    }).state;
    expect(restored.records[0].sync).toEqual({ status: "unconfigured" });
    expect(restored.settings.googleSheets.enabled).toBe(false);
    expect(() => reduceCommand(s, { type: "restore", backup })).toThrow(
      "空数据集",
    );
  });
  it("rejects orphan records and missing template versions on import", () => {
    const b = exportBackup(stateWithJob());
    b.records[0].categoryId = "missing";
    expect(() => parseBackup(b)).toThrow("分类关联");
    const s = stateWithJob();
    s.resumes.push(resumeFor(s));
    const invalid: any = exportBackup(s);
    invalid.resumes[0].layout.templateVersion = "future";
    expect(() => parseBackup(invalid)).toThrow();
  });
  it("does not inherit confirmation when changing sync target", () => {
    const s = stateWithJob(true);
    s.records[0].sync = {
      status: "synced",
      targetId: "target",
      syncedRevision: 1,
    };
    const settings = structuredClone(s.settings);
    settings.googleSheets.targetId = "target2";
    const next = reduceCommand(s, {
      type: "settings",
      settings,
      expectedRevision: s.revision,
    }).state;
    expect(next.records[0].sync.status).toBe("pending");
    expect(next.outbox[0].targetId).toBe("target2");
  });
});
it("explicit job snapshot updates preserve application progress, notes and saved resume data", () => {
  let s = stateWithJob();
  s.records[0].notes = "Keep note";
  s.records[0].status = "interviewing";
  const resume = resumeFor(s);
  s = reduceCommand(s, {
    type: "resume",
    resume,
    expectedRevision: 1,
    expectedMasterVersion: 0,
  }).state;
  const next = reduceCommand(s, {
    type: "updateRecord",
    id: s.records[0].id,
    expectedRevision: 2,
    patch: { job: { ...s.records[0].job, jdRawText: "Updated JD" } },
  }).state;
  expect(next.records[0].notes).toBe("Keep note");
  expect(next.records[0].status).toBe("interviewing");
  expect(next.resumes[0].jobSnapshot.jdRawText).not.toBe("Updated JD");
});
it("prevents replacing a tracked job identity while retaining its interview history", () => {
  const s = stateWithJob();
  expect(() =>
    reduceCommand(s, {
      type: "updateRecord",
      id: s.records[0].id,
      expectedRevision: 1,
      patch: { job: job("99999") },
    }),
  ).toThrow("其他岗位");
});

it("preserves legacy records and task hashes without inventing tracking dates", () => {
  const s = stateWithJob(true);
  const payload = JSON.stringify(s.outbox[0].payload);
  const parsed = StateSchema.parse(s);
  expect(parsed.records[0].appliedAt).toBeUndefined();
  expect(parsed.records[0].interviewAt).toBeUndefined();
  expect(JSON.stringify(parsed.outbox[0].payload)).toBe(payload);
});
it("persists tracking dates, new statuses and empty times through backup and sync", () => {
  let s = stateWithJob(true);
  const createdAt = s.records[0].createdAt;
  const update = (patch: unknown) => {
    s = reduceCommand(s, {
      type: "updateRecord",
      id: s.records[0].id,
      expectedRevision: s.records[0].revision,
      patch,
    }).state;
  };
  update({
    status: "waiting_interview",
    appliedAt: "2026-10-15T02:30:00.000Z",
    interviewAt: "2026-10-19T06:00:00.000Z",
  });
  expect(s.outbox.at(-1)!.payload.interviewAt).toBe(s.records[0].interviewAt);
  const restored = parseBackup(exportBackup(s));
  expect(restored.records[0].appliedAt).toBe(s.records[0].appliedAt);
  expect(restored.records[0].status).toBe("waiting_interview");
  update({ status: "no_response", interviewAt: null });
  expect(s.records[0].createdAt).toBe(createdAt);
  expect(s.records[0].interviewAt).toBeNull();
  expect(s.records[0].appliedAt).toBe("2026-10-15T02:30:00.000Z");
  expect(s.outbox.at(-1)!.payload.interviewAt).toBeNull();
});
it("rejects malformed dates and stale tracking edits", () => {
  const s = stateWithJob();
  const cmd = {
    type: "updateRecord",
    id: s.records[0].id,
    expectedRevision: s.records[0].revision,
    patch: { appliedAt: "2026-02-30T10:00:00Z" },
  };
  expect(() => reduceCommand(s, cmd)).toThrow();
  const next = reduceCommand(s, { ...cmd, patch: { status: "applied" } }).state;
  expect(next.records[0].appliedAt).toBeUndefined();
  expect(() =>
    reduceCommand(next, {
      ...cmd,
      patch: { interviewAt: "2026-10-19T06:00:00Z" },
    }),
  ).toThrow();
});
