// @vitest-environment jsdom
import { it, expect } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { createTrackerExport } from "../src/services/trackerExport";
import { stateWithJob } from "./helpers";
function workbook(content: string | ArrayBuffer) {
  expect(typeof content).not.toBe("string");
  const files = unzipSync(new Uint8Array(content as ArrayBuffer));
  const parse = (path: string) =>
    new DOMParser().parseFromString(strFromU8(files[path]), "application/xml");
  for (const path of Object.keys(files))
    expect(parse(path).querySelector("parsererror"), path).toBeNull();
  return {
    files,
    sheet: parse("xl/worksheets/sheet1.xml"),
    styles: parse("xl/styles.xml"),
  };
}
it("exports a real styled XLSX with text-safe Chinese fields, native dates and empty optional times", () => {
  const s = stateWithJob();
  const r = s.records[0];
  r.job.title = '数据分析 <业务> & "增长"';
  r.notes = "=SUM(A1:A9)\n第二行备注";
  r.status = "waiting_interview";
  r.appliedAt = null;
  r.interviewAt = "2026-10-19T06:30:00.000Z";
  const result = createTrackerExport(s.records, s.categories, "xlsx");
  expect(result.name).toMatch(/\.xlsx$/);
  expect(result.type).toContain("spreadsheetml.sheet");
  const { sheet, styles } = workbook(result.content);
  expect(sheet.querySelector('c[r="A2"] t')!.textContent).toBe(r.job.title);
  expect(sheet.querySelector('c[r="F2"] t')!.textContent).toBe(r.notes);
  expect(sheet.querySelector('c[r="D2"] t')!.textContent).toBe("等面试");
  expect(sheet.querySelector("f")).toBeNull();
  expect(sheet.querySelector('c[r="H2"]')).toBeNull();
  const value = Number(sheet.querySelector('c[r="I2"] v')!.textContent);
  const date = new Date(r.interviewAt);
  const wallClock = new Date(0);
  wallClock.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  wallClock.setUTCHours(
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    0,
  );
  expect(value).toBe(wallClock.getTime() / 86400000 + 25569);
  expect(sheet.querySelector("pane")!.getAttribute("state")).toBe("frozen");
  expect(sheet.querySelector("autoFilter")!.getAttribute("ref")).toBe("A1:I2");
  expect(styles.querySelector("numFmt")!.getAttribute("formatCode")).toBe(
    "yyyy-mm-dd hh:mm",
  );
});
it("exports just a header for an empty filtered result", () => {
  const s = stateWithJob();
  const { sheet } = workbook(
    createTrackerExport([], s.categories, "xlsx").content,
  );
  expect(sheet.querySelectorAll("row")).toHaveLength(1);
  expect(sheet.querySelectorAll("c")).toHaveLength(9);
  expect(sheet.querySelector("dimension")!.getAttribute("ref")).toBe("A1:I1");
});
it("preserves CSV compatibility, quotes, newlines, empty times and formula protection", () => {
  const s = stateWithJob();
  s.records[0].notes = '=SUM(A1:A9)\n备注"原文"';
  const result = createTrackerExport(s.records, s.categories, "csv");
  expect(result.name).toMatch(/\.csv$/);
  const csv = result.content as string;
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv).toContain('"加入时间","投递时间","面试时间"');
  expect(csv).toContain('"\'=SUM(A1:A9)\n备注""原文"""');
  expect(csv.endsWith(',"",""')).toBe(true);
});
it("refuses to truncate an overlong Excel cell while allowing the complete CSV", () => {
  const s = stateWithJob();
  s.records[0].notes = "中".repeat(32767);
  expect(() =>
    createTrackerExport(s.records, s.categories, "xlsx"),
  ).not.toThrow();
  s.records[0].notes = "中".repeat(50000);
  expect(() => createTrackerExport(s.records, s.categories, "xlsx")).toThrow(
    "请选择 CSV",
  );
  expect(createTrackerExport(s.records, s.categories, "csv").content).toContain(
    s.records[0].notes,
  );
});
it("encodes XML controls and literal OOXML escape sequences as safe text", () => {
  const s = stateWithJob();
  s.records[0].notes = "原文_x0041_\u000b\r后续";
  const { sheet } = workbook(
    createTrackerExport(s.records, s.categories, "xlsx").content,
  );
  expect(sheet.querySelector('c[r="F2"] t')!.textContent).toBe(
    "原文_x005F_x0041__x000B__x000D_后续",
  );
});
