import { createStore, type Command } from "./storage";
import { type State } from "../types/schema";
import { RUNTIME_CONTRACT, RUNTIME_UPDATE_MESSAGE } from "./runtimeContract";
const preview = !globalThis.chrome?.runtime?.id;
// Browser preview is isolated from extension data; network integrations require an installed extension.
const previewStore = createStore({
  read: async () => {
    const raw = localStorage.getItem("jobsdb-preview-v1");
    return raw ? JSON.parse(raw) : undefined;
  },
  write: async (s) => {
    localStorage.setItem("jobsdb-preview-v1", JSON.stringify(s));
    window.dispatchEvent(new Event("preview-state"));
  },
});
export const isPreview = preview;
export async function request(message: Record<string, unknown>): Promise<any> {
  if (preview) {
    if (message.type === "read")
      return {
        state: await previewStore.read(),
        bytes: new Blob([localStorage.getItem("jobsdb-preview-v1") ?? ""]).size,
      };
    if (message.type === "command")
      return previewStore.command(message.command);
    if (message.type === "openDashboard") {
      location.href = "/src/dashboard/index.html";
      return {};
    }
    throw Error("网页预览不支持采集，请在 Chrome 加载 dist 扩展");
  }
  if (message.type === "command" || message.type === "saveCaptured") {
    // Check before sending a write, including when an old worker cannot recognize new fields.
    const runtime = await chrome.runtime.sendMessage({
      type: "runtimeContract",
    });
    if (!runtime?.ok || runtime.runtimeContract !== RUNTIME_CONTRACT)
      throw Error(RUNTIME_UPDATE_MESSAGE);
  }
  const reply = await chrome.runtime.sendMessage({
    ...message,
    runtimeContract: RUNTIME_CONTRACT,
  });
  if (!reply?.ok && /pdfExportVersion/.test(reply?.error ?? ""))
    throw Error(RUNTIME_UPDATE_MESSAGE);
  if (!reply?.ok) throw Error(reply?.error ?? "后台无响应");
  return reply;
}
export const command = (
  cmd: Command,
): Promise<{ state: State; selectedId?: string }> =>
  request({ type: "command", command: cmd });
export function subscribe(callback: () => void) {
  if (preview) {
    window.addEventListener("storage", callback);
    window.addEventListener("preview-state", callback);
    return () => {
      window.removeEventListener("storage", callback);
      window.removeEventListener("preview-state", callback);
    };
  }
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (changes["jobsdb-state-v1"]) callback();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
export function download(
  name: string,
  content: string | ArrayBuffer,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
