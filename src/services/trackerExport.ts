import { strToU8, zipSync } from "fflate";
import { statusLabels, type Application, type State } from "../types/schema";
import { csvCell } from "./canonical";

export type TrackerExportFormat = "xlsx" | "csv";
const headers = [
  "职位",
  "公司",
  "分类",
  "状态",
  "链接",
  "备注",
  "加入时间",
  "投递时间",
  "面试时间",
];
const xml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function excelText(value: string) {
  // Preserve literal escape-looking text and XML-incompatible controls using OOXML escapes.
  return xml(
    value
      .replace(/_x[\da-f]{4}_/gi, (match) => `_x005F_${match.slice(1)}`)
      .replace(
        /[\x00-\x08\x0B-\x1F\uFFFE\uFFFF]/g,
        (char) =>
          `_x${char.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}_`,
      ),
  );
}
function displayDate(value?: string | null) {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
}
function localExcelDate(value: string) {
  const date = new Date(value);
  // Excel stores a timezone-free serial; keep the same local wall clock as the UI.
  const local = new Date(0);
  local.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  local.setUTCHours(
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds(),
  );
  return local.getTime() / 86400000 + 25569;
}
export function createTrackerExport(
  records: Application[],
  categories: State["categories"],
  format: TrackerExportFormat,
) {
  const names = new Map(
    categories.map((category) => [category.id, category.name]),
  );
  const values = records.map((record) => [
    record.job.title,
    record.job.company,
    names.get(record.categoryId) ?? "",
    statusLabels[record.status],
    record.job.jobUrl,
    record.notes,
  ]);
  if (format === "csv") {
    const rows = [
      headers,
      ...values.map((row, index) => [
        ...row,
        displayDate(records[index].createdAt),
        displayDate(records[index].appliedAt),
        displayDate(records[index].interviewAt),
      ]),
    ];
    return {
      name: "JobsDB_职位表.csv",
      type: "text/csv;charset=utf-8",
      content:
        "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n"),
    };
  }
  const textCell = (value: string, column: number, row: number, style = 0) => {
    if (value.length > 32767)
      throw Error(
        `第 ${row - 1} 条岗位的“${headers[column]}”超过 Excel 单元格长度限制。请选择 CSV 导出以保留完整内容，或缩短后再导出 Excel。`,
      );
    return `<c r="${String.fromCharCode(65 + column)}${row}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${excelText(value)}</t></is></c>`;
  };
  const rows = [
    `<row r="1" ht="26" customHeight="1">${headers.map((header, column) => textCell(header, column, 1, 1)).join("")}</row>`,
    ...values.map((row, index) => {
      const number = index + 2,
        record = records[index];
      const times = [record.createdAt, record.appliedAt, record.interviewAt]
        .map((time, column) =>
          time
            ? `<c r="${String.fromCharCode(71 + column)}${number}" s="2"><v>${localExcelDate(time)}</v></c>`
            : "",
        )
        .join("");
      return `<row r="${number}">${row.map((value, column) => textCell(value, column, number)).join("")}${times}</row>`;
    }),
  ];
  const files: Record<string, string> = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml":
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="职位投递表" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    "xl/styles.xml":
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF214F42"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    "xl/worksheets/sheet1.xml": `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:I${rows.length}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${[44, 30, 20, 14, 48, 60, 23, 23, 23].map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.join("")}</sheetData><autoFilter ref="A1:I${rows.length}"/></worksheet>`,
  };
  const bytes = zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [
        path,
        strToU8(
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + content,
        ),
      ]),
    ),
    { level: 6 },
  );
  return {
    name: "JobsDB_职位表.xlsx",
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    content: Uint8Array.from(bytes).buffer,
  };
}
