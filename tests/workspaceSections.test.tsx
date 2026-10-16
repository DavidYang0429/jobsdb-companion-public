// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/ui/App";
import { stateWithJob, resumeFor } from "./helpers";
import { reduceCommand } from "../src/services/storage";
import type { State } from "../src/types/schema";
const mock = vi.hoisted(() => ({ state: undefined as State | undefined }));
vi.mock("../src/services/client", () => ({
  isPreview: true,
  request: async () => ({ state: structuredClone(mock.state), bytes: 100 }),
  subscribe: () => () => {},
  command: async (cmd: unknown) => {
    const result = reduceCommand(mock.state!, cmd);
    mock.state = result.state;
    return result;
  },
  download: vi.fn(),
}));
const visible = (node: Element) => !node.closest("[hidden]");
async function setup() {
  const state = stateWithJob();
  const resume = resumeFor(state);
  state.resumes.push(resume);
  state.records[0].latestTailoredResumeId = resume.id;
  mock.state = state;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<App panel />));
  const button = (text: string) =>
    [...node.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) =>
        visible(b) &&
        b.textContent?.replace(/\s+/g, "") === text.replace(/\s+/g, ""),
    )!;
  const click = async (text: string) => {
    expect(button(text), text).toBeTruthy();
    await act(async () => button(text).click());
  };
  const field = (label: string) =>
    [...node.querySelectorAll("label")]
      .find((l) => visible(l) && l.textContent?.trim().startsWith(label))!
      .querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!;
  const fill = async (label: string, value: string) => {
    const input = field(label);
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const selectJob = async () => {
    await act(async () =>
      node.querySelector<HTMLButtonElement>(".job-link")!.click(),
    );
  };
  return {
    node,
    button,
    click,
    field,
    fill,
    selectJob,
    cleanup: async () => {
      await act(async () => root.unmount());
      node.remove();
      vi.unstubAllGlobals();
    },
  };
}
it("separates the list from job details and preserves unsaved follow-up edits across sections", async () => {
  const h = await setup();
  try {
    await h.selectJob();
    expect(visible(h.node.querySelector(".tracker")!)).toBe(false);
    await h.fill("投递时间", "2026-10-19T14:00");
    await h.fill("个人备注", "Unsaved follow-up");
    await h.click("制作简历");
    expect(visible(h.button("手工制作简历"))).toBe(true);
    expect(visible(h.node.querySelector(".tracking-times")!)).toBe(false);
    await h.click("岗位资料");
    expect(visible(h.node.querySelector(".jd-text")!)).toBe(true);
    await h.click("历史版本");
    expect(h.button("查看 / 另存版本")).toBeTruthy();
    await h.click("← 返回投递表");
    expect(visible(h.node.querySelector(".tracker")!)).toBe(true);
    await h.selectJob();
    expect(h.field("投递时间").value).toBe("2026-10-19T14:00");
    expect(h.field("个人备注").value).toBe("Unsaved follow-up");
    expect(mock.state!.records[0].appliedAt).toBeUndefined();
  } finally {
    await h.cleanup();
  }
});
it("keeps a single master draft through field tabs, import navigation and primary navigation", async () => {
  const h = await setup();
  try {
    await h.click("主简历底座");
    await h.fill("姓名", "Unsaved Name");
    await h.click("总结技能");
    await h.fill("个人总结", "Unsaved summary");
    await h.click("工作经历");
    expect(h.button("＋ 添加工作经历")).toBeTruthy();
    await h.click("上传导入");
    expect(h.button("AI 识别并填入表单")).toBeTruthy();
    expect(visible(h.node.querySelector(".profile-card form")!)).toBe(false);
    await h.click("设置与备份");
    await h.click("主简历底座");
    await h.click("基本资料");
    expect(h.field("姓名").value).toBe("Unsaved Name");
    await h.click("总结技能");
    expect(h.field("个人总结").value).toBe("Unsaved summary");
    await h.click("保存主简历");
    expect(mock.state!.master.fullName).toBe("Unsaved Name");
    expect(mock.state!.master.defaultSummary).toBe("Unsaved summary");
  } finally {
    await h.cleanup();
  }
});
it("preserves model and sync drafts across settings tabs, other pages and the resume studio", async () => {
  const h = await setup();
  try {
    await h.click("设置与备份");
    await h.fill("API Key", "fixture-key");
    await h.click("表格同步");
    await h.fill("目标 ID", "draft-target");
    await h.click("数据备份");
    expect(h.button("导出完整备份")).toBeTruthy();
    expect(h.button("保存设置")).toBeUndefined();
    await h.click("职位投递表 1");
    await h.selectJob();
    await h.click("制作简历");
    await h.click("手工制作简历");
    await h.click("返回岗位表");
    await h.click("设置与备份");
    await h.click("模型连接");
    expect(h.field("API Key").value).toBe("fixture-key");
    await h.click("表格同步");
    expect(h.field("目标 ID").value).toBe("draft-target");
    await h.click("保存设置");
    expect(mock.state!.settings.gemini.apiKey).toBe("fixture-key");
    expect(mock.state!.settings.googleSheets.targetId).toBe("draft-target");
  } finally {
    await h.cleanup();
  }
});
it("supports keyboard tab navigation and associates every tab with its panel", async () => {
  const h = await setup();
  try {
    await h.click("主简历底座");
    const tabs = h.node.querySelector('[aria-label="主简历功能"]')!;
    await act(async () =>
      tabs
        .querySelector<HTMLElement>('[role="tab"]')!
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: "End", bubbles: true }),
        ),
    );
    expect(tabs.querySelector('[aria-selected="true"]')!.textContent).toBe(
      "上传导入",
    );
    await act(async () =>
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      ),
    );
    expect(tabs.querySelector('[aria-selected="true"]')!.textContent).toBe(
      "基本资料",
    );
    for (const tab of tabs.querySelectorAll('[role="tab"]'))
      expect(
        h.node.querySelector(`#${tab.getAttribute("aria-controls")}`),
      ).not.toBeNull();
    await h.click("使用说明");
    await h.click("模型设置");
    expect(visible(h.node.querySelector("#guide-panel-model")!)).toBe(true);
    expect(visible(h.node.querySelector("#guide-panel-start")!)).toBe(false);
  } finally {
    await h.cleanup();
  }
});
