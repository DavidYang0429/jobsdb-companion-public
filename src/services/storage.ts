import { z } from "zod";
import {
  StateSchema,
  BackupSchema,
  JobSchema,
  ProfileSchema,
  ResumeSchema,
  SettingsSchema,
  StatusSchema,
  AnalysisSchema,
  initialState,
  uid,
  now,
  type State,
  type Task,
  type Application,
  type Backup,
} from "../types/schema";
import { canonical } from "./canonical";
const revision = z.number().int().nonnegative();
export const CommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("addJob"),
    categoryId: z.string(),
    job: JobSchema,
  }),
  z.object({
    type: z.literal("updateRecord"),
    id: z.string(),
    expectedRevision: revision,
    patch: z
      .object({
        status: StatusSchema.optional(),
        appliedAt: z.iso.datetime().nullable().optional(),
        interviewAt: z.iso.datetime().nullable().optional(),
        notes: z.string().max(50000).optional(),
        job: JobSchema.optional(),
      })
      .strict(),
  }),
  z.object({
    type: z.literal("category"),
    id: z.string().optional(),
    name: z.string().trim().min(1).max(100),
    expectedRevision: revision,
  }),
  z.object({
    type: z.literal("profile"),
    profile: ProfileSchema,
    expectedVersion: revision,
  }),
  z.object({
    type: z.literal("resume"),
    resume: ResumeSchema,
    expectedRevision: revision,
    expectedMasterVersion: revision,
  }),
  z.object({
    type: z.literal("analysis"),
    id: z.string(),
    expectedRevision: revision,
    expectedMasterVersion: revision,
    analysis: AnalysisSchema.extend({
      masterResumeVersion: revision,
      jdHash: z.string(),
      provider: z.enum(["gemini", "deepseek"]),
      model: z.string(),
    }),
  }),
  z.object({
    type: z.literal("settings"),
    settings: SettingsSchema,
    expectedRevision: revision,
  }),
  z.object({ type: z.literal("retry") }),
  z.object({ type: z.literal("restore"), backup: BackupSchema }),
]);
export type Command = z.infer<typeof CommandSchema>;
export function projectRow(s: State, r: Application): Task["payload"] {
  return {
    categoryId: r.categoryId,
    categoryName: s.categories.find((c) => c.id === r.categoryId)!.name,
    job: structuredClone(r.job),
    status: r.status,
    ...(r.appliedAt !== undefined ? { appliedAt: r.appliedAt } : {}),
    ...(r.interviewAt !== undefined ? { interviewAt: r.interviewAt } : {}),
    hasTailoredResume: !!r.latestTailoredResumeId,
    notes: r.notes,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
export function enqueue(s: State, r: Application) {
  const cfg = s.settings.googleSheets;
  if (!cfg.enabled) {
    r.sync = { status: "unconfigured" };
    return;
  }
  r.sync = { status: "pending", targetId: cfg.targetId };
  // Preserve tasks already attempted; their server outcome may be unknown.
  s.outbox = s.outbox.filter((t) => t.recordId !== r.id || t.attempts > 0);
  s.outbox.push({
    requestId: uid(),
    targetId: cfg.targetId,
    recordId: r.id,
    revision: r.revision,
    payload: projectRow(s, r),
    attempts: 0,
    nextAttemptAt: now(),
  });
}
export function validateReferences(b: Backup | State) {
  const ids = (xs: { id: string }[]) => new Set(xs.map((x) => x.id));
  for (const xs of [b.categories, b.records, b.resumes])
    if (ids(xs).size !== xs.length) throw Error("备份中存在重复 ID");
  const categories = ids(b.categories),
    records = ids(b.records),
    resumes = ids(b.resumes),
    keys = new Set<string>();
  for (const r of b.records) {
    const key = r.categoryId + ":" + r.job.jobKey;
    if (!categories.has(r.categoryId) || keys.has(key))
      throw Error("分类关联缺失或同表岗位重复");
    keys.add(key);
    if (
      r.latestTailoredResumeId &&
      (!resumes.has(r.latestTailoredResumeId) ||
        b.resumes.find((x) => x.id === r.latestTailoredResumeId)
          ?.applicationId !== r.id)
    )
      throw Error("简历关联无效");
  }
  for (const r of b.resumes) {
    if (
      !records.has(r.applicationId) ||
      r.masterResumeVersion !== r.sourceProfile.version
    )
      throw Error("简历来源版本或岗位关联无效");
    if (
      r.parentResumeId &&
      (r.parentResumeId === r.id ||
        b.resumes.find((x) => x.id === r.parentResumeId)?.applicationId !==
          r.applicationId)
    )
      throw Error("历史简历关联无效");
    let parent = r.parentResumeId;
    const seen = new Set([r.id]);
    while (parent) {
      if (seen.has(parent)) throw Error("历史简历关联循环");
      seen.add(parent);
      parent = b.resumes.find((x) => x.id === parent)?.parentResumeId;
    }
  }
}
export function parseBackup(data: unknown): Backup {
  const b = BackupSchema.parse(data);
  validateReferences(b);
  return b;
}
export function exportBackup(s: State): Backup {
  return {
    schemaVersion: 1,
    exportedAt: now(),
    categories: structuredClone(s.categories),
    records: s.records.map((r) => ({
      ...structuredClone(r),
      sync: { status: "unconfigured" },
    })),
    master: structuredClone(s.master),
    resumes: structuredClone(s.resumes),
  };
}
export function reduceCommand(
  state: State,
  raw: unknown,
): { state: State; selectedId?: string } {
  const cmd = CommandSchema.parse(raw),
    s = structuredClone(state);
  let selectedId: string | undefined;
  const record = (id: string, expected: number) => {
    const r = s.records.find((x) => x.id === id);
    if (!r) throw Error("岗位不存在");
    if (r.revision !== expected)
      throw Error("记录已在其他页面更新，请刷新后重试");
    return r;
  };
  const touch = (r: Application) => {
    r.revision++;
    r.updatedAt = now();
    enqueue(s, r);
  };
  switch (cmd.type) {
    case "addJob": {
      if (!s.categories.some((c) => c.id === cmd.categoryId))
        throw Error("分类不存在");
      const existing = s.records.find(
        (r) =>
          r.categoryId === cmd.categoryId && r.job.jobKey === cmd.job.jobKey,
      );
      if (existing) return { state, selectedId: existing.id };
      const r: Application = {
        id: uid(),
        categoryId: cmd.categoryId,
        job: cmd.job,
        status: "saved",
        notes: "",
        revision: 1,
        sync: { status: "unconfigured" },
        createdAt: now(),
        updatedAt: now(),
      };
      s.records.push(r);
      enqueue(s, r);
      selectedId = r.id;
      break;
    }
    case "updateRecord": {
      const r = record(cmd.id, cmd.expectedRevision);
      if (cmd.patch.job && cmd.patch.job.jobKey !== r.job.jobKey)
        throw Error("不能将已有投递记录改为其他岗位，请新建记录");
      Object.assign(r, cmd.patch);
      touch(r);
      break;
    }
    case "category": {
      if (s.revision !== cmd.expectedRevision)
        throw Error("工作台已更新，请刷新后重试");
      if (s.categories.some((c) => c.name === cmd.name && c.id !== cmd.id))
        throw Error("分类名称已存在");
      if (cmd.id) {
        const c = s.categories.find((x) => x.id === cmd.id);
        if (!c) throw Error("分类不存在");
        c.name = cmd.name;
        s.records.filter((r) => r.categoryId === c.id).forEach(touch);
      } else s.categories.push({ id: uid(), name: cmd.name });
      break;
    }
    case "profile": {
      if (s.master.version !== cmd.expectedVersion)
        throw Error("主简历已更新，请刷新后重试");
      s.master = {
        ...cmd.profile,
        id: s.master.id,
        version: s.master.version + 1,
        updatedAt: now(),
      };
      break;
    }
    case "resume": {
      const r = record(cmd.resume.applicationId, cmd.expectedRevision);
      if (s.master.version !== cmd.expectedMasterVersion)
        throw Error("主简历已更新，请重新检查草稿");
      if (s.resumes.some((x) => x.id === cmd.resume.id))
        throw Error("简历版本已存在，请另存");
      if (cmd.resume.jobSnapshot.jobKey !== r.job.jobKey)
        throw Error("简历岗位不一致");
      if (
        !cmd.resume.parentResumeId &&
        (cmd.resume.masterResumeVersion !== s.master.version ||
          canonical(cmd.resume.sourceProfile) !== canonical(s.master))
      )
        throw Error("简历来源已过期");
      if (cmd.resume.parentResumeId) {
        const parent = s.resumes.find(
          (x) => x.id === cmd.resume.parentResumeId,
        );
        if (
          !parent ||
          parent.applicationId !== r.id ||
          canonical(parent.sourceProfile) !==
            canonical(cmd.resume.sourceProfile)
        )
          throw Error("历史来源无效");
      }
      s.resumes.push(structuredClone(cmd.resume));
      r.latestTailoredResumeId = cmd.resume.id;
      touch(r);
      break;
    }
    case "analysis": {
      const r = record(cmd.id, cmd.expectedRevision);
      if (
        s.master.version !== cmd.expectedMasterVersion ||
        cmd.analysis.masterResumeVersion !== s.master.version
      )
        throw Error("主简历已更新，请重新分析");
      r.analysis = cmd.analysis;
      touch(r);
      break;
    }
    case "settings": {
      if (s.revision !== cmd.expectedRevision)
        throw Error("配置已更新，请刷新后重试");
      const before = canonical(s.settings.googleSheets),
        after = canonical(cmd.settings.googleSheets);
      if (
        s.settings.googleSheets.webhookUrl !==
          cmd.settings.googleSheets.webhookUrl &&
        s.settings.googleSheets.webhookUrl &&
        s.settings.googleSheets.targetId === cmd.settings.googleSheets.targetId
      )
        throw Error("更换目标地址时请使用新的目标 ID");
      s.settings = cmd.settings;
      if (before !== after) {
        s.outbox = [];
        s.records.forEach((r) => enqueue(s, r));
      }
      break;
    }
    case "retry": {
      for (const r of s.records)
        if (r.sync.status !== "synced") {
          s.outbox = s.outbox.filter((t) => t.recordId !== r.id);
          enqueue(s, r);
        }
      break;
    }
    case "restore": {
      if (
        s.records.length ||
        s.resumes.length ||
        s.master.version > 0 ||
        s.categories.length !== 1 ||
        s.categories[0].name !== "默认投递表"
      )
        throw Error("仅支持向空数据集恢复，不会覆盖现有数据");
      const b = parseBackup(cmd.backup);
      s.categories = b.categories;
      s.records = b.records.map((r) => ({
        ...r,
        sync: { status: "unconfigured" },
      }));
      s.master = b.master;
      s.resumes = b.resumes;
      s.outbox = [];
      s.settings = initialState().settings;
      break;
    }
  }
  s.revision++;
  StateSchema.parse(s);
  validateReferences(s);
  return { state: s, selectedId };
}
export interface StateIO {
  read(): Promise<unknown>;
  write(state: State): Promise<void>;
}
export function createStore(io: StateIO) {
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  }
  const load = async () => {
    const raw = await io.read();
    const s = raw ? StateSchema.parse(raw) : initialState();
    validateReferences(s);
    if (!raw) await io.write(s);
    return s;
  };
  return {
    read: () => exclusive(load),
    command: (cmd: unknown) =>
      exclusive(async () => {
        const result = reduceCommand(await load(), cmd);
        await io.write(result.state);
        return result;
      }),
    mutate: <T>(fn: (s: State) => T) =>
      exclusive(async () => {
        const s = await load();
        const result = fn(s);
        StateSchema.parse(s);
        await io.write(s);
        return result;
      }),
  };
}
