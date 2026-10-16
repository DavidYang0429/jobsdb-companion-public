// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SettingsPanel } from "../src/ui/SettingsPanel";
import { initialState } from "../src/types/schema";
vi.mock("../src/services/client", () => ({
  isPreview: false,
  command: vi.fn(),
  download: vi.fn(),
}));
it.each(["gemini", "deepseek"] as const)(
  "shows the provider, requested model and actual response model in the visible test result: %s",
  async (provider) => {
    const state = initialState();
    state.settings.activeProvider = provider;
    state.settings[provider].apiKey = "test-key";
    const actual =
      provider === "gemini" ? "gemini-from-server" : "deepseek-from-server";
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("fetch", async () =>
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
                { finish_reason: "stop", message: { content: '{"ok":true}' } },
              ],
            },
      ),
    );
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    const report = vi.fn();
    try {
      await act(async () => {
        root.render(
          <SettingsPanel
            state={state}
            onChanged={async () => {}}
            report={report}
          />,
        );
      });
      const button = Array.from(node.querySelectorAll("button")).find(
        (b) => b.textContent === "测试当前连接",
      )!;
      expect(button.disabled).toBe(false);
      await act(async () => {
        button.click();
      });
      const result = node.querySelector('[role="status"]')!;
      expect(result.textContent).toContain("连接成功");
      expect(result.textContent).toContain(state.settings[provider].model);
      expect(result.textContent).toContain(actual);
      expect(report).toHaveBeenCalledWith(expect.stringContaining(actual));
      expect(result.textContent).not.toContain("test-key");
    } finally {
      await act(async () => root.unmount());
      node.remove();
      vi.unstubAllGlobals();
    }
  },
);
