import { createStore, CommandSchema } from "../services/storage";
import { createSyncRunner } from "../services/googleSheetsSync";
import { jobIdFromUrl } from "../content/extract";
import {
  RUNTIME_CONTRACT,
  RUNTIME_UPDATE_MESSAGE,
} from "../services/runtimeContract";
const KEY = "jobsdb-state-v1";
const accessReady = chrome.storage.local.setAccessLevel({
  accessLevel: "TRUSTED_CONTEXTS",
});
const store = createStore({
  read: async () => {
    await accessReady;
    return (await chrome.storage.local.get(KEY))[KEY];
  },
  write: async (state) => {
    await accessReady;
    await chrome.storage.local.set({ [KEY]: state });
  },
});
const sync = createSyncRunner(store);
async function setup() {
  await accessReady;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.alarms.create("sync", { periodInMinutes: 0.5 });
  await sync();
}
chrome.runtime.onInstalled.addListener(() => {
  void setup();
});
chrome.runtime.onStartup.addListener(() => {
  void setup();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "sync") void sync();
});
function trusted(sender: chrome.runtime.MessageSender) {
  const base = chrome.runtime.getURL("");
  return (
    sender.id === chrome.runtime.id &&
    !!sender.url &&
    [
      base + "src/dashboard/index.html",
      base + "src/sidepanel/index.html",
    ].includes(sender.url.split("?")[0])
  );
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    message?.type === "openPanel" &&
    sender.id === chrome.runtime.id &&
    sender.tab?.id &&
    sender.tab.url?.startsWith("https://hk.jobsdb.com/")
  ) {
    // Call immediately in the content-script click gesture; avoid awaiting before open().
    chrome.sidePanel
      .open({ tabId: sender.tab.id })
      .then(() => reply({ ok: true }))
      .catch(() =>
        reply({ ok: false, error: "请点击工具栏插件图标打开侧边栏" }),
      );
    return true;
  }
  if (!trusted(sender)) {
    reply({ ok: false, error: "此页面没有访问工作台数据的权限" });
    return;
  }
  void (async () => {
    if (message?.type === "runtimeContract")
      return { runtimeContract: RUNTIME_CONTRACT };
    if (
      (message?.type === "command" || message?.type === "saveCaptured") &&
      message.runtimeContract !== RUNTIME_CONTRACT
    )
      throw Error(RUNTIME_UPDATE_MESSAGE);
    if (message?.type === "read") {
      const state = await store.read();
      const bytes = await chrome.storage.local.getBytesInUse();
      return { state, bytes };
    }
    if (message?.type === "command") {
      const result = await store.command(CommandSchema.parse(message.command));
      void sync();
      return result;
    }
    if (message?.type === "saveCaptured") {
      const [active] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (
        active?.id !== message.tabId ||
        jobIdFromUrl(active.url ?? "") !== message.job?.sourceJobId
      )
        throw Error("采集后岗位已切换，请重新提取或手动录入");
      const result = await store.command({
        type: "addJob",
        job: message.job,
        categoryId: message.categoryId,
      });
      void sync();
      return result;
    }
    if (message?.type === "extractCurrent") {
      const [tab] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      const expectedId = jobIdFromUrl(tab?.url ?? "");
      if (!tab?.id || !expectedId)
        throw Error("请在 JobsDB 打开具体岗位，再从侧边栏提取；也可手动录入");
      const requestId = crypto.randomUUID(),
        tabId = tab.id;
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "extract",
        expectedId,
        requestId,
      });
      const [active] = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (active?.id !== tabId || jobIdFromUrl(active.url ?? "") !== expectedId)
        throw Error("当前岗位已变化，请重新提取");
      if (!result?.ok) throw Error(result?.error ?? "页面未就绪");
      if (result.requestId !== requestId) throw Error("采集响应已过期");
      return { job: result.job, tabId, requestId };
    }
    if (message?.type === "openDashboard") {
      await chrome.tabs.create({
        url: chrome.runtime.getURL("src/dashboard/index.html"),
      });
      return {};
    }
    throw Error("未知操作");
  })()
    .then((data) => reply({ ok: true, ...data }))
    .catch((error) =>
      reply({
        ok: false,
        error: error instanceof Error ? error.message : "操作失败，请重试",
      }),
    );
  return true;
});
void setup();
