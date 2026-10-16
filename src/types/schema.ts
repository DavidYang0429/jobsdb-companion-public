import { z } from "zod";
const text = z.string().max(50000);
const id = z.string().min(1).max(120);
const date = z.iso.datetime();
const unique = (a: { id: string }[]) =>
  new Set(a.map((x) => x.id)).size === a.length;
export const StatusSchema = z.enum([
  "saved",
  "applied",
  "waiting_interview",
  "no_response",
  "interviewing",
  "offer",
  "rejected",
]);
export const ProviderSchema = z.enum(["gemini", "deepseek"]);
export const JobSchema = z
  .object({
    source: z.literal("jobsdb"),
    sourceJobId: z.string().regex(/^\d+$/),
    jobKey: id,
    title: z.string().min(1).max(1000),
    company: z.string().min(1).max(1000),
    location: text.nullable(),
    salary: text.nullable(),
    workType: text.nullable(),
    jobUrl: z.string().url(),
    jdRawText: z.string().min(1).max(50000),
    jdParagraphs: z.array(text).max(1000),
    capturedAt: date,
  })
  .strict()
  .refine(
    (j) =>
      j.jobKey === `jobsdb:${j.sourceJobId}` &&
      j.jobUrl === `https://hk.jobsdb.com/job/${j.sourceJobId}`,
    "岗位 ID 与标准链接不一致",
  );
export const BulletSchema = z.object({ id, text }).strict();
export const ExperienceSchema = z
  .object({
    id,
    companyOrOrg: text,
    role: text,
    location: text,
    period: text,
    bullets: z.array(BulletSchema).max(100),
  })
  .strict();
export const EducationSchema = z
  .object({ id, school: text, degree: text, period: text, details: text })
  .strict();
export const ProfileSchema = z
  .object({
    id,
    version: z.number().int().nonnegative(),
    updatedAt: date,
    fullName: text,
    phone: text,
    email: text,
    location: text,
    linkedinOrPortfolio: text,
    visaStatus: text,
    defaultSummary: text,
    skills: z.array(text).max(200),
    languages: z.array(text).max(100),
    experiences: z.array(ExperienceSchema).max(100),
    projects: z.array(ExperienceSchema).max(100),
    education: z.array(EducationSchema).max(100),
  })
  .strict()
  .refine(
    (p) =>
      unique([
        ...p.experiences,
        ...p.projects,
        ...p.education,
        ...[...p.experiences, ...p.projects].flatMap((e) => e.bullets),
      ]),
    "经历与要点 ID 必须唯一",
  );
const evidence = z
  .object({ value: text, quotes: z.array(text).max(30) })
  .strict();
export const AnalysisSchema = z
  .object({
    visa: evidence,
    languages: z.array(evidence).max(20),
    coreKeywords: z.array(text).max(20),
    matchScore: z.number().min(0).max(100),
    matchAnalysis: text,
  })
  .strict();
export const SuggestionSchema = z
  .object({
    summary: z.object({ text, sourceIds: z.array(id) }).strict(),
    experiences: z
      .array(
        z
          .object({
            sourceExperienceId: id,
            bullets: z
              .array(
                z
                  .object({ sourceBulletIds: z.array(id).min(1), text })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(100),
    projects: z
      .array(
        z
          .object({
            sourceExperienceId: id,
            bullets: z
              .array(
                z
                  .object({ sourceBulletIds: z.array(id).min(1), text })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(100),
    orderedSkills: z.array(text).max(200),
  })
  .strict();
export const LayoutSchema = z
  .object({
    templateVersion: z.literal("a4-v1"),
    fontVersion: z.literal("noto-inter-v1"),
    pdfExportVersion: z.literal("pdf-v1").optional(),
    hiddenItemIds: z.array(id),
    orderedItemIds: z.array(id),
    pageBreakBeforeIds: z.array(id),
  })
  .strict();
export const ResumeSchema = z
  .object({
    id,
    parentResumeId: id.optional(),
    applicationId: id,
    jobSnapshot: JobSchema,
    masterResumeVersion: z.number().int().nonnegative(),
    sourceProfile: ProfileSchema,
    suggestion: SuggestionSchema.optional(),
    renderedProfile: ProfileSchema,
    language: z.enum(["en", "zh-HK", "zh-CN"]),
    layout: LayoutSchema,
    generation: z
      .object({ provider: ProviderSchema, model: text, promptVersion: text })
      .strict()
      .optional(),
    reviewedAt: date,
    createdAt: date,
  })
  .strict();
export const SettingsSchema = z
  .object({
    activeProvider: ProviderSchema,
    gemini: z
      .object({
        apiKey: z.string().max(1000),
        model: z.string().regex(/^[a-zA-Z0-9._-]+$/),
      })
      .strict(),
    deepseek: z
      .object({
        apiKey: z.string().max(1000),
        model: z.string().regex(/^[a-zA-Z0-9._-]+$/),
        baseUrl: z.literal("https://api.deepseek.com"),
      })
      .strict(),
    googleSheets: z
      .object({
        enabled: z.boolean(),
        targetId: z.string().max(120),
        webhookUrl: z.string().max(2000),
        sharedSecret: z.string().max(1000),
      })
      .strict(),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      s.googleSheets.enabled &&
      (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(
        s.googleSheets.webhookUrl,
      ) ||
        !s.googleSheets.targetId ||
        s.googleSheets.sharedSecret.length < 24)
    )
      ctx.addIssue({
        code: "custom",
        message: "请填写正式 GAS /exec 地址、目标 ID 和至少 24 位共享密钥",
      });
  });
export const RecordSchema = z
  .object({
    id,
    categoryId: id,
    job: JobSchema,
    status: StatusSchema,
    appliedAt: date.nullable().optional(),
    interviewAt: date.nullable().optional(),
    notes: text,
    latestTailoredResumeId: id.optional(),
    revision: z.number().int().positive(),
    sync: z
      .object({
        targetId: id.optional(),
        status: z.enum([
          "unconfigured",
          "pending",
          "syncing",
          "synced",
          "failed",
        ]),
        syncedRevision: z.number().int().positive().optional(),
        lastError: text.optional(),
        lastSyncedAt: date.optional(),
      })
      .strict(),
    analysis: AnalysisSchema.extend({
      masterResumeVersion: z.number().int().nonnegative(),
      jdHash: text,
      provider: ProviderSchema,
      model: text,
    }).optional(),
    createdAt: date,
    updatedAt: date,
  })
  .strict();
export const PayloadSchema = z
  .object({
    categoryId: id,
    categoryName: text,
    job: JobSchema,
    status: StatusSchema,
    appliedAt: date.nullable().optional(),
    interviewAt: date.nullable().optional(),
    hasTailoredResume: z.boolean(),
    notes: text,
    createdAt: date,
    updatedAt: date,
  })
  .strict();
export const TaskSchema = z
  .object({
    requestId: id,
    targetId: id,
    recordId: id,
    revision: z.number().int().positive(),
    payload: PayloadSchema,
    attempts: z.number().int().nonnegative(),
    nextAttemptAt: date,
  })
  .strict();
const CategorySchema = z
  .object({ id, name: z.string().trim().min(1).max(100) })
  .strict();
export const StateSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    categories: z.array(CategorySchema).max(100),
    records: z.array(RecordSchema),
    master: ProfileSchema,
    resumes: z.array(ResumeSchema),
    settings: SettingsSchema,
    outbox: z.array(TaskSchema),
  })
  .strict();
export const BackupSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportedAt: date,
    categories: z.array(CategorySchema).max(100),
    records: z.array(RecordSchema),
    master: ProfileSchema,
    resumes: z.array(ResumeSchema),
  })
  .strict();
export type Job = z.infer<typeof JobSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type Suggestion = z.infer<typeof SuggestionSchema>;
export type Resume = z.infer<typeof ResumeSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Application = z.infer<typeof RecordSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type State = z.infer<typeof StateSchema>;
export type Analysis = z.infer<typeof AnalysisSchema>;
export type Backup = z.infer<typeof BackupSchema>;
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const defaultLayout = (): Resume["layout"] => ({
  templateVersion: "a4-v1",
  fontVersion: "noto-inter-v1",
  hiddenItemIds: [],
  orderedItemIds: [],
  pageBreakBeforeIds: [],
});
export function emptyProfile(): Profile {
  return {
    id: uid(),
    version: 0,
    updatedAt: now(),
    fullName: "",
    phone: "",
    email: "",
    location: "",
    linkedinOrPortfolio: "",
    visaStatus: "",
    defaultSummary: "",
    skills: [],
    languages: [],
    experiences: [],
    projects: [],
    education: [],
  };
}
export function initialState(): State {
  return {
    schemaVersion: 1,
    revision: 0,
    categories: [{ id: uid(), name: "默认投递表" }],
    records: [],
    master: emptyProfile(),
    resumes: [],
    outbox: [],
    settings: {
      activeProvider: "gemini",
      gemini: { apiKey: "", model: "gemini-3.5-flash-lite" },
      deepseek: {
        apiKey: "",
        model: "deepseek-chat",
        baseUrl: "https://api.deepseek.com",
      },
      googleSheets: {
        enabled: false,
        targetId: "",
        webhookUrl: "",
        sharedSecret: "",
      },
    },
  };
}
export const statusLabels: Record<Application["status"], string> = {
  saved: "待投递",
  applied: "已投递",
  waiting_interview: "等面试",
  interviewing: "面试中",
  offer: "已拿 Offer",
  rejected: "已失败",
  no_response: "无回应",
};
export const syncLabels: Record<Application["sync"]["status"], string> = {
  unconfigured: "未配置",
  pending: "待同步",
  syncing: "同步中",
  synced: "已同步",
  failed: "失败",
};
