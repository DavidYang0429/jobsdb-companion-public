import { it, expect } from "vitest";
import { PDFDocument } from "pdf-lib";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import {
  createResumePdf,
  resumePdfBlocks,
  resumePdfFilename,
  wrapPdfText,
} from "../src/services/resumePdf";
import { stateWithJob, resumeFor } from "./helpers";
function fixture(language: "en" | "zh-CN" | "zh-HK", twoPages = false) {
  const resume = resumeFor(stateWithJob());
  resume.language = language;
  const p = resume.renderedProfile;
  p.fullName =
    language === "en"
      ? "Demo Candidate"
      : language === "zh-HK"
        ? "測試求職者"
        : "测试求职者";
  p.email = "demo@example.com";
  p.defaultSummary =
    language === "en"
      ? "Data analyst with SQL reporting experience."
      : language === "zh-HK"
        ? "具備資料分析及報表開發經驗，熟悉 SQL 與 Python。"
        : "具备数据分析及报表开发经验，熟悉 SQL 与 Python。";
  p.experiences = [
    {
      id: "exp",
      companyOrOrg: language === "en" ? "Example Company" : "示例公司",
      role:
        language === "en"
          ? "Data Analyst"
          : language === "zh-HK"
            ? "資料分析師"
            : "数据分析师",
      location: "Hong Kong",
      period: "2024 - 2025",
      bullets: [
        {
          id: "b1",
          text:
            language === "en"
              ? "Built 2 SQL reports to improve operational reporting."
              : language === "zh-HK"
                ? "建立 2 份 SQL 報表，改善團隊日常營運分析效率。"
                : "建立 2 份 SQL 报表，改善团队日常运营分析效率。",
        },
      ],
    },
  ];
  p.education = [
    {
      id: "education",
      school: language === "en" ? "Example University" : "示例大學",
      degree: "MSc Information Systems",
      period: "2025 - 2026",
      details: "",
    },
  ];
  p.skills = ["SQL", "Python"];
  p.languages = [
    "English",
    language === "en"
      ? "Cantonese"
      : language === "zh-HK"
        ? "廣東話"
        : "普通话",
  ];
  if (twoPages) resume.layout.pageBreakBeforeIds = ["education"];
  return resume;
}
const loadFont = async (language: "en" | "zh-CN" | "zh-HK") =>
  new Uint8Array(
    await readFile(
      `public/fonts/pdf-v1/${language === "en" ? "Inter" : language === "zh-HK" ? "NotoSansTC" : "NotoSansSC"}-Regular.ttf`,
    ),
  );
it.each(["en", "zh-CN", "zh-HK"] as const)(
  "produces a selectable text PDF with embedded font and explicit page breaks: %s",
  async (language) => {
    await mkdir(".local-test/pdfs", { recursive: true });
    for (const twoPages of [false, true]) {
      const bytes = await createResumePdf(fixture(language, twoPages), {
        loadFont,
      });
      const doc = await PDFDocument.load(bytes);
      expect(doc.getPageCount()).toBe(twoPages ? 2 : 1);
      expect(doc.getPage(0).getWidth()).toBeCloseTo(595.276);
      expect(Buffer.from(bytes).subarray(0, 4).toString()).toBe("%PDF");
      await writeFile(
        `.local-test/pdfs/${language}-${twoPages ? 2 : 1}page.pdf`,
        bytes,
      );
    }
  },
  15000,
);
it("respects hidden items, source order and filename safety", () => {
  const r = fixture("en");
  r.layout.hiddenItemIds = ["b1", "skills"];
  expect(
    resumePdfBlocks(r)
      .map((b) => b.text)
      .join("\n"),
  ).not.toContain("Built 2 SQL reports");
  expect(resumePdfBlocks(r).map((b) => b.text)).not.toContain("SKILLS");
  r.renderedProfile.fullName = "Name / unsafe: *";
  expect(resumePdfFilename(r)).not.toMatch(/[\\/:*?"<>|]/);
});
it("wraps unbroken links and CJK text within available line width", () => {
  const font = {
    widthOfTextAtSize: (text: string) => Array.from(text).length * 5,
  };
  for (const line of wrapPdfText(
    "A".repeat(200) + " 中文测试報表",
    font,
    10,
    60,
  ))
    expect(font.widthOfTextAtSize(line)).toBeLessThanOrEqual(60);
});
it("refuses missing glyphs rather than silently producing empty squares", async () => {
  const r = fixture("en");
  r.renderedProfile.defaultSummary = "Unsupported 🦄";
  await expect(createResumePdf(r, { loadFont })).rejects.toThrow("字体不支持");
}, 15000);
it("chooses a single CJK face before embedding mixed Chinese and English content", async () => {
  const r = fixture("en");
  r.renderedProfile.defaultSummary += " 界面验收用虚构简历。";
  const requested: string[] = [];
  const bytes = await createResumePdf(r, {
    loadFont: async (language) => {
      requested.push(language);
      return loadFont(language);
    },
  });
  expect(requested).toEqual(["zh-CN"]);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
}, 15000);

it("exports mixed text and typographic date separators with the same source values", async () => {
  const r = fixture("en");
  r.renderedProfile.defaultSummary += " 界面验收用虚构简历。";
  r.renderedProfile.experiences[0].period = "2024 – 2025";
  const bytes = await createResumePdf(r, { loadFont });
  await writeFile(".local-test/pdfs/mixed.pdf", bytes);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
}, 15000);
