// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/ui/App";
import { stateWithJob } from "./helpers";
import type { State } from "../src/types/schema";
const mock = vi.hoisted(() => ({ state: undefined as State | undefined }));
vi.mock("../src/services/client", () => ({
  isPreview: false,
  request: vi.fn(async () => ({
    state: structuredClone(mock.state),
    bytes: 100,
  })),
  subscribe: () => () => {},
  command: vi.fn(),
  download: vi.fn(),
}));
async function mount(filled: boolean) {
  const s = stateWithJob();
  s.settings.gemini.apiKey = "test-key";
  if (filled) s.master.defaultSummary = "Reporting analyst.";
  mock.state = s;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => {
    root.render(<App />);
  });
  const click = async (label: string) => {
    const b = Array.from(node.querySelectorAll("button")).find(
      (x) => x.textContent?.replace(/\s+/g, " ").trim() === label,
    );
    expect(b, `Missing button: ${label}`).toBeTruthy();
    await act(async () => {
      b!.click();
    });
  };
  await act(async () => {
    node.querySelector<HTMLButtonElement>(".job-link")!.click();
  });
  await click("制作简历");
  return {
    node,
    click,
    cleanup: async () => {
      await act(async () => root.unmount());
      node.remove();
      vi.unstubAllGlobals();
    },
  };
}
it("guides an empty-profile user directly to the master editor and back to the original job without a model request", async () => {
  const ui = await mount(false);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    await ui.click("AI 定制简历");
    const panel = ui.node.querySelector('[role="alert"]')!;
    expect(panel.textContent).toContain("主简历还没有可用于定制的内容");
    expect(panel.textContent).toContain("每周销售报表");
    expect(fetcher).not.toHaveBeenCalled();
    await ui.click("去完善主简历");
    expect(ui.node.textContent).toContain("保存主简历");
    expect(ui.node.textContent).toContain("返回刚才的岗位");
    await ui.click("返回刚才的岗位");
    expect(ui.node.querySelector(".job-details")?.textContent).toContain(
      "Data Analyst",
    );
  } finally {
    await ui.cleanup();
  }
});
it("shows actionable model-error guidance, retries only on click, and offers a safe manual fallback", async () => {
  const ui = await mount(true);
  const fetcher = vi.fn(async () =>
    Response.json({
      candidates: [
        {
          finishReason: "STOP",
          content: {
            parts: [
              {
                text: JSON.stringify({
                  summary: { text: "Analyst.", sourceIds: [] },
                  experiences: [],
                  projects: [],
                  orderedSkills: [],
                }),
              },
            ],
          },
        },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  try {
    await ui.click("AI 定制简历");
    const panel = ui.node.querySelector('[role="alert"]')!;
    expect(panel.textContent).toContain("不代表你的简历填错");
    expect(panel.textContent).not.toContain("sourceIds");
    expect(fetcher).toHaveBeenCalledTimes(1);
    await ui.click("重新生成");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mock.state!.resumes).toHaveLength(0);
    const manual = Array.from(
      ui.node.querySelectorAll<HTMLButtonElement>(".ai-recovery button"),
    ).find((b) => b.textContent === "手工制作简历")!;
    await act(async () => manual.click());
    expect(ui.node.textContent).toContain("RESUME STUDIO");
    expect(
      ui.node.querySelector<HTMLTextAreaElement>(".studio-editor textarea")
        ?.value,
    ).toBe("Reporting analyst.");
  } finally {
    await ui.cleanup();
  }
});
it("shows readable facts instead of source ID JSON in the resume comparison view", async () => {
  const { ResumeWorkspace } = await import("../src/ui/ResumeWorkspace");
  const { resumeFor } = await import("./helpers");
  const state = stateWithJob();
  state.master.skills = ["SQL"];
  state.master.education = [
    {
      id: "education",
      school: "Example University",
      degree: "MSc",
      period: "2025",
      details: "",
    },
  ];
  const resume = resumeFor(state);
  resume.suggestion = {
    summary: { text: "SQL analyst", sourceIds: ["profile.skills"] },
    experiences: [],
    projects: [],
    orderedSkills: ["SQL"],
  };
  resume.renderedProfile.defaultSummary = "SQL analyst";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => {
      root.render(
        <ResumeWorkspace
          initial={resume}
          application={state.records[0]}
          source={state.master}
          onSave={async () => {}}
          onClose={() => {}}
          report={() => {}}
          historical
        />,
      );
    });
    await act(async () => {
      Array.from(node.querySelectorAll("button"))
        .find((b) => b.textContent === "原文对照")!
        .click();
    });
    expect(node.textContent).toContain("个人总结参考的原文");
    expect(node.textContent).toContain("原始技能");
    expect(node.textContent).toContain("Example University");
    expect(node.textContent).not.toContain("profile.skills");
    expect(node.querySelector("pre")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.unstubAllGlobals();
  }
});
