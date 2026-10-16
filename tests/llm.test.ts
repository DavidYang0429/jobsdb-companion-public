import { it, expect } from "vitest";
import { z } from "zod";
import { initialState } from "../src/types/schema";
import {
  generateStructuredJSON,
  validateSuggestion,
  applySuggestion,
} from "../src/services/llmAdapter";
const profile = () => ({
  ...initialState().master,
  skills: ["SQL"],
  experiences: [
    {
      id: "e1",
      companyOrOrg: "Real Co",
      role: "Analyst",
      period: "2024",
      location: "HK",
      bullets: [{ id: "b1", text: "Built 2 SQL reports." }],
    },
  ],
});
const suggestion = () => ({
  summary: { text: "Reporting analyst", sourceIds: ["b1"] },
  experiences: [
    {
      sourceExperienceId: "e1",
      bullets: [{ sourceBulletIds: ["b1"], text: "Delivered 2 SQL reports." }],
    },
  ],
  projects: [],
  orderedSkills: ["SQL"],
});
it("rejects invented skill and cross-experience source ID", () => {
  const s = suggestion();
  s.orderedSkills = ["Cantonese"];
  expect(() => validateSuggestion(profile(), s)).toThrow("技能");
  s.orderedSkills = ["SQL"];
  s.experiences[0].bullets[0].sourceBulletIds = ["fake"];
  expect(() => validateSuggestion(profile(), s)).toThrow("要点");
});
it("flags new numbers and preserves fixed fields during assembly", () => {
  const s = suggestion();
  s.experiences[0].bullets[0].text = "Grew revenue 90%";
  expect(validateSuggestion(profile(), s)).not.toHaveLength(0);
  const rendered = applySuggestion(profile(), suggestion());
  expect(rendered.experiences[0].companyOrOrg).toBe("Real Co");
  expect(rendered.experiences[0].period).toBe("2024");
});
it("validates runtime JSON and does not auto retry or change providers", async () => {
  const settings = initialState().settings;
  settings.gemini.apiKey = "secret";
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: '{"unexpected":true}' }] },
        },
      ],
    });
  };
  await expect(
    generateStructuredJSON(
      z.object({ ok: z.literal(true) }),
      settings,
      "system",
      "prompt",
      undefined,
      fetcher,
    ),
  ).rejects.toThrow("结构");
  expect(calls).toBe(1);
});
it("uses provider specific headers and rejects truncated responses", async () => {
  const settings = initialState().settings;
  settings.deepseek.apiKey = "secret";
  settings.activeProvider = "deepseek";
  await expect(
    generateStructuredJSON(
      z.object({ ok: z.boolean() }),
      settings,
      "system",
      "prompt",
      undefined,
      async (url, init) => {
        expect(url).toBe("https://api.deepseek.com/chat/completions");
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer secret",
        );
        return Response.json({
          choices: [
            { finish_reason: "length", message: { content: '{"ok":true}' } },
          ],
        });
      },
    ),
  ).rejects.toThrow("截断");
});
it("accepts valid JSON from both providers with the expected authentication and request shape", async () => {
  for (const provider of ["gemini", "deepseek"] as const) {
    const settings = initialState().settings;
    settings.activeProvider = provider;
    settings[provider].apiKey = "test-key";
    const result = await generateStructuredJSON(
      z.object({ ok: z.literal(true) }).strict(),
      settings,
      "system",
      "JSON only",
      undefined,
      async (url, init) => {
        const body = JSON.parse(String(init?.body));
        if (provider === "gemini") {
          expect(String(url)).not.toContain("test-key");
          expect(
            (init?.headers as Record<string, string>)["x-goog-api-key"],
          ).toBe("test-key");
          expect(body.generationConfig.responseMimeType).toBe(
            "application/json",
          );
          return Response.json({
            candidates: [
              {
                finishReason: "STOP",
                content: { parts: [{ text: '{"ok":true}' }] },
              },
            ],
          });
        }
        expect(body.response_format).toEqual({ type: "json_object" });
        return Response.json({
          choices: [
            { finish_reason: "stop", message: { content: '{"ok":true}' } },
          ],
        });
      },
    );
    expect(result.ok).toBe(true);
  }
});
it("parses an imported profile through runtime validation before allowing master save", async () => {
  const { vi } = await import("vitest");
  const { importProfile } = await import("../src/services/llmAdapter");
  const settings = initialState().settings;
  settings.gemini.apiKey = "test-key";
  const { id, version, updatedAt, ...fields } = profile();
  vi.stubGlobal("fetch", async () =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: { parts: [{ text: JSON.stringify(fields) }] },
        },
      ],
    }),
  );
  try {
    const draft = await importProfile(
      settings,
      "resume text",
      new AbortController().signal,
    );
    expect(draft.fullName).toBe(fields.fullName);
    expect(draft.experiences[0].bullets[0].id).toBe("b1");
    expect(draft.version).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("reports requested and server returned model IDs for both provider formats", async () => {
  const { testConnection, connectionMessage } =
    await import("../src/services/llmAdapter");
  for (const provider of ["gemini", "deepseek"] as const) {
    const settings = initialState().settings;
    settings.activeProvider = provider;
    settings[provider].apiKey = "test-key";
    const actual =
      provider === "gemini"
        ? "gemini-version-from-response"
        : "deepseek-version-from-response";
    const result = await testConnection(
      settings,
      new AbortController().signal,
      async () =>
        Response.json(
          provider === "gemini"
            ? {
                modelVersion: actual,
                candidates: [
                  {
                    finishReason: "STOP",
                    content: { parts: [{ text: '{"ok":true}' }] },
                  },
                ],
              }
            : {
                model: actual,
                choices: [
                  {
                    finish_reason: "stop",
                    message: { content: '{"ok":true}' },
                  },
                ],
              },
        ),
    );
    expect(result.requestedModel).toBe(settings[provider].model);
    expect(result.responseModel).toBe(actual);
    expect(connectionMessage(result)).toContain(actual);
  }
});
it("does not claim a model was returned when the provider omits metadata", async () => {
  const { testConnection, connectionMessage } =
    await import("../src/services/llmAdapter");
  const settings = initialState().settings;
  settings.gemini.apiKey = "test-key";
  const result = await testConnection(
    settings,
    new AbortController().signal,
    async () =>
      Response.json({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: '{"ok":true}' }] },
          },
        ],
      }),
  );
  expect(result.responseModel).toBeUndefined();
  expect(connectionMessage(result)).toContain("接口未返回模型标识");
  expect(connectionMessage(result)).toContain(settings.gemini.model);
});
