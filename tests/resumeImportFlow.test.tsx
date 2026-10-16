// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/ui/App";
import { stateWithJob, resumeFor } from "./helpers";
import { emptyProfile, type State } from "../src/types/schema";
import { reduceCommand } from "../src/services/storage";
const mock = vi.hoisted(() => ({
  state: undefined as State | undefined,
  parse: vi.fn(),
  command: vi.fn(),
}));
vi.mock("../src/services/client", () => ({
  isPreview: false,
  request: vi.fn(async () => ({
    state: structuredClone(mock.state),
    bytes: 100,
  })),
  subscribe: () => () => {},
  command: async (cmd: unknown) => mock.command(cmd),
  download: vi.fn(),
}));
vi.mock("../src/services/llmAdapter", async (original) => ({
  ...(await original<typeof import("../src/services/llmAdapter")>()),
  importProfile: async (...args: unknown[]) => mock.parse(...args),
}));
async function setup(key = true) {
  const state = stateWithJob();
  state.master.fullName = "Saved Name";
  state.master.version = 2;
  state.settings.gemini.apiKey = key ? "test-key" : "";
  state.resumes.push(resumeFor(state));
  state.records[0].latestTailoredResumeId = state.resumes[0].id;
  mock.state = state;
  mock.parse.mockReset();
  mock.command.mockReset().mockImplementation(async (cmd: unknown) => {
    const result = reduceCommand(mock.state!, cmd);
    mock.state = result.state;
    return result;
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<App />));
  const button = (text: string) =>
    Array.from(node.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.replace(/\s+/g, " ").trim() === text,
    )!;
  const click = async (text: string) => {
    expect(button(text), text).toBeTruthy();
    await act(async () => button(text).click());
  };
  const field = (label: string) =>
    Array.from(node.querySelectorAll("label"))
      .find((l) => l.textContent?.trim().startsWith(label))!
      .querySelector<HTMLInputElement | HTMLTextAreaElement>("input,textarea")!;
  const fill = async (label: string, text: string) => {
    const input = field(label);
    await act(async () => {
      const prototype =
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        input,
        text,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const upload = async (name: string, text: string) => {
    const bytes = new TextEncoder().encode(text);
    const file = new File([bytes], name, { type: "text/plain" });
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => new Uint8Array(bytes).buffer,
    });
    const input = node.querySelector<HTMLInputElement>("input[type=file]")!;
    await act(async () => {
      Object.defineProperty(input, "files", {
        value: [file],
        configurable: true,
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  return {
    node,
    root,
    button,
    click,
    field,
    fill,
    upload,
    cleanup: async () => {
      await act(async () => root.unmount());
      node.remove();
      vi.unstubAllGlobals();
    },
  };
}
it("reads an uploaded TXT without a Key and explains the AI gate", async () => {
  const ui = await setup(false);
  try {
    await ui.click("主简历底座");
    await ui.click("上传导入");
    await ui.upload("cv.txt", "Demo Candidate\nSQL analyst");
    expect(ui.field("简历原文").value).toBe("Demo Candidate\nSQL analyst");
    expect(ui.button("AI 识别并填入表单").disabled).toBe(true);
    expect(ui.node.textContent).toContain("本地读取不需要 Key");
    expect(mock.parse).not.toHaveBeenCalled();
    expect(mock.command).not.toHaveBeenCalled();
  } finally {
    await ui.cleanup();
  }
});
it("fills an uncommitted draft, restores unsaved manual edits, and only saves after review", async () => {
  const ui = await setup();
  const parsed = emptyProfile();
  parsed.fullName = "Parsed Name";
  mock.parse.mockResolvedValue(parsed);
  try {
    await ui.click("主简历底座");
    await ui.fill("姓名", "Unsaved Manual Name");
    await ui.click("上传导入");
    await ui.fill("简历原文", "Parsed Name\nSQL analyst");
    await ui.click("AI 识别并填入表单");
    expect(ui.field("姓名").value).toBe("Parsed Name");
    expect(mock.command).not.toHaveBeenCalled();
    expect(ui.button("保存主简历").disabled).toBe(true);
    await ui.click("返回原表单");
    expect(ui.field("姓名").value).toBe("Unsaved Manual Name");
    expect(mock.state!.master.fullName).toBe("Saved Name");
    await ui.click("上传导入");
    await ui.click("AI 识别并填入表单");
    const checkbox = Array.from(
      ui.node.querySelectorAll<HTMLInputElement>("input[type=checkbox]"),
    ).find((i) => i.parentElement?.textContent?.includes("我已核对下方"))!;
    await act(async () => checkbox.click());
    await ui.click("保存主简历");
    expect(mock.command).toHaveBeenCalledWith(
      expect.objectContaining({ type: "profile", expectedVersion: 2 }),
    );
    expect(mock.state!.master.fullName).toBe("Parsed Name");
    expect(mock.state!.resumes[0].renderedProfile.fullName).toBe("Saved Name");
  } finally {
    await ui.cleanup();
  }
});
it("keeps extracted text when visiting settings or the usage guide", async () => {
  const ui = await setup(false);
  try {
    await ui.click("主简历底座");
    await ui.click("上传导入");
    await ui.upload("cv.txt", "Preserved source text");
    await ui.click("设置 API Key");
    await ui.click("主简历底座");
    expect(ui.field("简历原文").value).toBe("Preserved source text");
    await ui.click("使用说明");
    expect(ui.node.textContent).toContain("哪些功能需要 API Key");
    expect(ui.node.textContent).toContain("Google Sheets");
    expect(ui.node.textContent).toContain("卸载扩展会清除");
    await ui.click("准备主简历");
    expect(ui.field("简历原文").value).toBe("Preserved source text");
  } finally {
    await ui.cleanup();
  }
});
it("does not apply a late recognition result after leaving the import page", async () => {
  const ui = await setup();
  let finish!: (value: ReturnType<typeof emptyProfile>) => void;
  mock.parse.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  try {
    await ui.click("主简历底座");
    await ui.click("上传导入");
    await ui.fill("简历原文", "Source");
    await ui.click("AI 识别并填入表单");
    await ui.click("使用说明");
    const parsed = emptyProfile();
    parsed.fullName = "Late Name";
    await act(async () => finish(parsed));
    await ui.click("准备主简历");
    expect(ui.field("姓名").value).toBe("Saved Name");
    expect(mock.command).not.toHaveBeenCalled();
  } finally {
    await ui.cleanup();
  }
});
