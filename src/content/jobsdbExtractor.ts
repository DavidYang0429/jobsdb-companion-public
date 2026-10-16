import { extractJob, jobIdFromUrl } from "./extract";
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message?.type !== "extract") return;
  try {
    const before = location.href;
    const id = jobIdFromUrl(before);
    if (!id || id !== message.expectedId) throw Error("请先打开具体岗位详情");
    const job = extractJob(document, before, id);
    if (location.href !== before) throw Error("岗位已切换，请重新提取");
    reply({ ok: true, job, requestId: message.requestId });
  } catch (e) {
    reply({ ok: false, error: e instanceof Error ? e.message : "采集失败" });
  }
});
const button = document.createElement("button");
button.textContent = "＋ 求职工作台";
button.setAttribute("aria-label", "打开 JobsDB 求职工作台");
Object.assign(button.style, {
  position: "fixed",
  right: "20px",
  bottom: "24px",
  zIndex: "2147483646",
  background: "#1b4c41",
  color: "#fff",
  border: "none",
  borderRadius: "24px",
  padding: "13px 19px",
  cursor: "pointer",
  boxShadow: "0 3px 16px #0003",
  fontSize: "14px",
});
button.addEventListener("click", () => {
  void chrome.runtime
    .sendMessage({ type: "openPanel" })
    .then((reply) => {
      if (!reply?.ok) button.textContent = "请点击浏览器插件图标打开";
    })
    .catch(() => {
      button.textContent = "请点击浏览器插件图标打开";
    });
});
document.body.append(button);
