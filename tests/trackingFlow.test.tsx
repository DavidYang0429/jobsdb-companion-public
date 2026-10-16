// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/ui/App";
import { formatTrackingTime } from "../src/ui/ApplicationTimeline";
import { stateWithJob } from "./helpers";
import { reduceCommand } from "../src/services/storage";
import type { State } from "../src/types/schema";
const mock = vi.hoisted(() => ({
  state: undefined as State | undefined,
  fail: false,
  download: vi.fn(),
}));
vi.mock("../src/services/client", () => ({
  isPreview: true,
  request: async () => ({ state: structuredClone(mock.state), bytes: 100 }),
  subscribe: () => () => {},
  command: async (cmd: unknown) => {
    if (mock.fail) throw Error("QUOTA_BYTES");
    const result = reduceCommand(mock.state!, cmd);
    mock.state = result.state;
    return result;
  },
  download: (...args: unknown[]) => mock.download(...args),
}));
async function setup() {
  mock.state = stateWithJob();
  mock.fail = false;
  mock.download.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<App panel />));
  const button = (text: string) =>
    [...node.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent?.replace(/\s+/g, " ").trim() === text,
    )!;
  await act(async () =>
    node.querySelector<HTMLButtonElement>(".job-link")!.click(),
  );
  const field = (label: string) =>
    [...node.querySelectorAll("label")]
      .find((l) => l.textContent?.trim().startsWith(label))!
      .querySelector<HTMLInputElement>("input")!;
  const fill = async (label: string, value: string) => {
    await act(async () => {
      const input = field(label);
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const click = async (text: string) => {
    await act(async () => button(text).click());
  };
  const status = async (value: string) => {
    await act(async () => {
      const select = node.querySelector<HTMLSelectElement>(
        ".job-details .status-select",
      )!;
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };
  return {
    node,
    button,
    field,
    fill,
    click,
    status,
    cleanup: async () => {
      await act(async () => root.unmount());
      node.remove();
      vi.unstubAllGlobals();
    },
  };
}
it("saves local tracking times, shows them in table/CSV, and allows clearing without changing join time", async () => {
  const h = await setup();
  try {
    const joined = mock.state!.records[0].createdAt;
    expect(h.node.textContent).toContain("加入时间");
    expect(
      [...h.node.querySelectorAll(".job-details .status-select option")].map(
        (o) => o.textContent,
      ),
    ).toEqual([
      "待投递",
      "已投递",
      "等面试",
      "面试中",
      "已拿 Offer",
      "已失败",
      "无回应",
    ]);
    await h.fill("投递时间", "2026-10-15T10:30");
    await h.fill("面试时间", "2026-10-19T14:00");
    await h.click("保存时间");
    const record = mock.state!.records[0];
    expect(record.appliedAt).toBe(new Date("2026-10-15T10:30").toISOString());
    expect(record.interviewAt).toBe(new Date("2026-10-19T14:00").toISOString());
    expect(h.node.querySelector('[data-label="投递时间"]')!.textContent).toBe(
      formatTrackingTime(record.appliedAt),
    );
    expect(h.button("保存时间").disabled).toBe(true);
    await h.status("waiting_interview");
    expect(mock.state!.records[0].appliedAt).toBe(record.appliedAt);
    await h.click("← 返回投递表");
    await act(async () => {
      const select = h.node.querySelector<HTMLSelectElement>(
        ".export-controls select",
      )!;
      select.value = "csv";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await h.click("导出投递表 ↗");
    await act(async () =>
      h.node.querySelector<HTMLButtonElement>(".job-link")!.click(),
    );
    expect(mock.download.mock.calls[0][1]).toContain(
      '"加入时间","投递时间","面试时间"',
    );
    expect(mock.download.mock.calls[0][1]).toContain(
      formatTrackingTime(record.interviewAt),
    );
    await h.fill("面试时间", "");
    await h.click("保存时间");
    expect(mock.state!.records[0].interviewAt).toBeNull();
    expect(mock.state!.records[0].createdAt).toBe(joined);
  } finally {
    await h.cleanup();
  }
});
it("does not overwrite after a concurrent record update and can reload saved times", async () => {
  const h = await setup();
  try {
    await h.fill("投递时间", "2026-10-15T10:30");
    await h.status("no_response");
    expect(h.button("保存时间").disabled).toBe(true);
    expect(h.node.textContent).toContain("本次修改尚未保存");
    expect(mock.state!.records[0].appliedAt).toBeUndefined();
    await h.click("载入已保存时间");
    expect(h.field("投递时间").value).toBe("");
  } finally {
    await h.cleanup();
  }
});
it("keeps entered times when persistence fails and permits an explicit retry", async () => {
  const h = await setup();
  try {
    await h.fill("投递时间", "2026-10-15T10:30");
    mock.fail = true;
    await h.click("保存时间");
    expect(mock.state!.records[0].appliedAt).toBeUndefined();
    expect(h.field("投递时间").value).toBe("2026-10-15T10:30");
    expect(h.button("保存时间").disabled).toBe(false);
    mock.fail = false;
    await h.click("保存时间");
    expect(mock.state!.records[0].appliedAt).toBeTruthy();
  } finally {
    await h.cleanup();
  }
});

it("allows both tracking dates to be blank, or only one filled, without required-field constraints", async () => {
  const h = await setup();
  try {
    expect(h.field("投递时间").required).toBe(false);
    expect(h.field("面试时间").required).toBe(false);
    expect(h.node.textContent).toContain("可全部留空");
    await h.status("applied");
    expect(mock.state!.records[0].appliedAt).toBeUndefined();
    expect(mock.state!.records[0].interviewAt).toBeUndefined();
    await h.fill("面试时间", "2026-10-19T14:00");
    await h.click("保存时间");
    expect(mock.state!.records[0].appliedAt).toBeNull();
    expect(mock.state!.records[0].interviewAt).toBeTruthy();
    await h.fill("面试时间", "");
    await h.click("保存时间");
    expect(mock.state!.records[0].appliedAt).toBeNull();
    expect(mock.state!.records[0].interviewAt).toBeNull();
    expect(h.field("投递时间").value).toBe("");
    expect(h.field("面试时间").value).toBe("");
  } finally {
    await h.cleanup();
  }
});

it("defaults to XLSX and exports only the currently filtered records", async () => {
  const h = await setup();
  try {
    await h.click("← 返回投递表");
    const format = h.node.querySelector<HTMLSelectElement>(
      ".export-controls select",
    )!;
    expect(format.value).toBe("xlsx");
    await h.click("导出投递表 ↗");
    expect(mock.download.mock.calls[0][0]).toBe("JobsDB_职位表.xlsx");
    const { unzipSync, strFromU8 } = await import("fflate");
    const sheet = (data: ArrayBuffer) =>
      strFromU8(unzipSync(new Uint8Array(data))["xl/worksheets/sheet1.xml"]);
    expect(sheet(mock.download.mock.calls[0][1])).toContain('r="A2"');
    await act(async () => {
      const search = h.node.querySelector<HTMLInputElement>(
        'input[aria-label="搜索岗位"]',
      )!;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(search, "NO MATCHING JOB TITLE");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await h.click("导出投递表 ↗");
    expect(sheet(mock.download.mock.calls[1][1])).not.toContain('r="A2"');
  } finally {
    await h.cleanup();
  }
});
