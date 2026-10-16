import { it, expect, vi } from "vitest";
import { initialState } from "../src/types/schema";
import {
  resumeFactSources,
  validateSuggestion,
  tailor,
  reviewWarnings,
  applySuggestion,
} from "../src/services/llmAdapter";
import { AITaskError, explainAIError } from "../src/services/aiErrors";
import { job } from "./helpers";
const output = () => ({
  summary: {
    text: "Analyst experienced in reporting.",
    sourceIds: ["profile.defaultSummary"],
  },
  experiences: [],
  projects: [],
  orderedSkills: [] as string[],
});
it("accepts an existing personal summary as a real source without requiring work experience", () => {
  const p = initialState().master;
  p.defaultSummary = "Reporting analyst.";
  expect(resumeFactSources(p).map((s) => s.id)).toContain(
    "profile.defaultSummary",
  );
  expect(() => validateSuggestion(p, output())).not.toThrow();
});
it("exposes actual skills, language and visa facts, but not empty rows or contact-only details", () => {
  const p = initialState().master;
  p.fullName = "Name";
  p.email = "test@example.com";
  p.skills = ["  "];
  expect(resumeFactSources(p)).toHaveLength(0);
  p.skills = ["SQL"];
  p.languages = ["English"];
  p.visaStatus = "User supplied status";
  expect(resumeFactSources(p).map((s) => s.id)).toEqual([
    "profile.skills",
    "profile.languages",
    "profile.visaStatus",
  ]);
});
it("explains an empty profile before making any model request", async () => {
  const s = initialState(),
    fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    await expect(
      tailor(
        s.settings,
        s.master,
        job(),
        "en",
        "",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      recovery: { code: "profile-empty", actions: ["profile"] },
    });
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("sends a usable source catalogue and a nonempty real summary source example", async () => {
  const s = initialState();
  s.master.defaultSummary = "Reporting analyst.";
  s.settings.gemini.apiKey = "test-key";
  const fetcher = vi.fn(async (_url, init) => {
    const prompt = JSON.parse(
      JSON.parse(String(init?.body)).contents[0].parts[0].text,
    );
    expect(prompt.factSources).toContainEqual({
      id: "profile.defaultSummary",
      label: "个人总结",
      text: "Reporting analyst.",
    });
    expect(prompt.outputShape.summary.sourceIds).toEqual([
      "profile.defaultSummary",
    ]);
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(output()) }] },
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const result = await tailor(
      s.settings,
      s.master,
      job(),
      "en",
      "",
      new AbortController().signal,
    );
    expect(result.rendered.defaultSummary).toBe(output().summary.text);
    expect(fetcher).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("identifies a missing source as a model failure and offers explicit recovery actions", () => {
  const p = initialState().master;
  p.defaultSummary = "Reporting analyst.";
  const suggestion = output();
  suggestion.summary.sourceIds = [];
  try {
    validateSuggestion(p, suggestion);
    throw Error("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(AITaskError);
    const e = error as AITaskError;
    expect(e.recovery.code).toBe("summary-source-missing");
    expect(e.message).toContain("不代表你的简历填错");
    expect(e.recovery.actions).toEqual(["retry", "manual", "profile"]);
    expect(e.message).toContain("保存");
  }
});
it("rejects invented source IDs instead of silently assigning plausible references", () => {
  const p = initialState().master;
  p.defaultSummary = "Reporting analyst.";
  const suggestion = output();
  suggestion.summary.sourceIds = ["made-up-internal-id"];
  expect(() => validateSuggestion(p, suggestion)).toThrow(AITaskError);
  try {
    validateSuggestion(p, suggestion);
  } catch (error) {
    expect((error as AITaskError).recovery.code).toBe("summary-source-invalid");
    expect((error as Error).message).not.toContain("made-up-internal-id");
  }
});
it("reports the exact experience, bullet and new number that needs manual correction", () => {
  const p = initialState().master;
  p.experiences = [
    {
      id: "e",
      companyOrOrg: "Example Company",
      role: "Analyst",
      period: "2024",
      location: "HK",
      bullets: [{ id: "b", text: "Made 2 reports." }],
    },
  ];
  const suggestion = {
    summary: { text: "", sourceIds: [] },
    experiences: [
      {
        sourceExperienceId: "e",
        bullets: [{ sourceBulletIds: ["b"], text: "Made 90 reports." }],
      },
    ],
    projects: [],
    orderedSkills: [],
  };
  const rendered = applySuggestion(p, suggestion);
  const warnings = reviewWarnings(p, suggestion, rendered);
  expect(warnings[0]).toContain("Example Company");
  expect(warnings[0]).toContain("第 1 条要点");
  expect(warnings[0]).toContain("90");
  expect(warnings[0]).toContain("编辑");
  rendered.experiences[0].bullets[0].text = "Made 2 reports.";
  expect(reviewWarnings(p, suggestion, rendered)).toHaveLength(0);
});
it.each([
  [Error("模型返回结构不完整，未保存任何结果"), "format"],
  [Error("模型鉴权失败，请检查 Key 与模型权限"), "key"],
  [Error("模型额度或速率受限"), "quota"],
  [new DOMException("wait", "TimeoutError"), "timeout"],
  [new DOMException("stop", "AbortError"), "cancelled"],
  [new TypeError("Failed to fetch"), "network"],
  [Error("岗位、主简历或模型设置已变化，结果未应用；请重新生成"), "stale"],
  [Error("岗位要求缺少原文依据"), "job-evidence"],
] as const)("provides next steps for %s", (error, code) => {
  const help = explainAIError(error).recovery;
  expect(help.code).toBe(code);
  expect(help.steps.length).toBeGreaterThan(0);
  expect(help.actions.length).toBeGreaterThan(0);
});
it("checks summary numbers against the actual cited facts rather than metadata or unrelated fields", () => {
  const p = initialState().master;
  p.version = 10;
  p.skills = ["SQL"];
  p.defaultSummary = "Built 10 reports.";
  const s = {
    summary: {
      text: "10 years of SQL experience",
      sourceIds: ["profile.skills"],
    },
    experiences: [],
    projects: [],
    orderedSkills: ["SQL"],
  };
  expect(validateSuggestion(p, s)[0]).toContain("个人总结");
  expect(validateSuggestion(p, s)[0]).toContain("10");
});
it("names the exact added and repeated skills that caused rejection", () => {
  const p = initialState().master;
  p.defaultSummary = "Reporting analyst";
  p.skills = ["SQL"];
  const s = output();
  s.orderedSkills = ["Cantonese", "SQL", "SQL"];
  try {
    validateSuggestion(p, s);
    throw Error("Expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(AITaskError);
    expect((error as Error).message).toContain("Cantonese");
    expect((error as Error).message).toContain("重复的技能：“SQL”");
  }
});
