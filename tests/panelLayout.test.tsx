// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/ui/App";
import type { State } from "../src/types/schema";
import { stateWithJob, resumeFor } from "./helpers";
const mock = vi.hoisted(() => ({ state: undefined as State | undefined }));
vi.mock("../src/services/client", () => ({
  isPreview: true,
  request: vi.fn(async () => ({
    state: structuredClone(mock.state),
    bytes: 100,
  })),
  subscribe: () => () => {},
  command: vi.fn(),
  download: vi.fn(),
}));
it.each([true, false])(
  "preserves side-panel context when opening a resume, while leaving desktop mode independent: %s",
  async (panel) => {
    const state = stateWithJob();
    state.master.fullName = "Original Name";
    const resume = resumeFor(state);
    state.resumes.push(resume);
    state.records[0].latestTailoredResumeId = resume.id;
    mock.state = state;
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    const button = (text: string) =>
      Array.from(node.querySelectorAll("button")).find(
        (b) => b.textContent?.replace(/\s+/g, " ").trim() === text,
      )!;
    try {
      await act(async () => {
        root.render(<App panel={panel} />);
      });
      await act(async () => {
        node.querySelector<HTMLButtonElement>(".job-link")!.click();
      });
      await act(async () => button("历史版本").click());
      await act(async () => {
        button("查看 / 另存版本").click();
      });
      expect(!!node.querySelector(".studio-shell.panel-mode")).toBe(panel);
      expect(!!node.querySelector(".compact-view-switch")).toBe(panel);
      if (panel) {
        const input = node.querySelector<HTMLInputElement>(
          ".studio-editor input",
        )!;
        await act(async () => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value",
          )!.set!.call(input, "Unsaved Draft Name");
          input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
          button("查看预览").click();
        });
        expect(node.querySelector(".compact-preview")).not.toBeNull();
        await act(async () => {
          button("编辑简历").click();
        });
        expect(node.querySelector(".compact-edit")).not.toBeNull();
        expect(
          node.querySelector<HTMLInputElement>(".studio-editor input")!.value,
        ).toBe("Unsaved Draft Name");
        expect(mock.state!.resumes[0].renderedProfile.fullName).toBe(
          "Original Name",
        );
      }
    } finally {
      await act(async () => root.unmount());
      node.remove();
      vi.unstubAllGlobals();
    }
  },
);
