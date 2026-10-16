export const manifest = {
  manifest_version: 3,
  name: "JobsDB 求职工作台",
  version: "0.1.0",
  description: "本地优先的岗位归档、投递管理与简历定制工具",
  minimum_chrome_version: "120",
  permissions: ["storage", "sidePanel", "alarms", "activeTab"],
  host_permissions: [
    "https://hk.jobsdb.com/*",
    "https://generativelanguage.googleapis.com/*",
    "https://api.deepseek.com/*",
    "https://script.google.com/*",
    "https://script.googleusercontent.com/*",
  ],
  action: { default_title: "打开求职工作台" },
  background: { service_worker: "background.js", type: "module" },
  side_panel: { default_path: "src/sidepanel/index.html" },
  options_ui: { page: "src/dashboard/index.html", open_in_tab: true },
  content_scripts: [
    {
      matches: ["https://hk.jobsdb.com/*"],
      js: ["content.js"],
      run_at: "document_idle",
    },
  ],
  icons: {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png",
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self'; object-src 'self'; worker-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com https://api.deepseek.com https://script.google.com https://script.googleusercontent.com",
  },
};
