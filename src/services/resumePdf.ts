import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { ResumeSchema, type Resume } from "../types/schema";

export type PdfBlock = {
  text: string;
  kind: "name" | "contact" | "section" | "heading" | "body" | "bullet";
  pageBreak?: boolean;
};
const PAGE_WIDTH = 595.276,
  PAGE_HEIGHT = 841.89,
  MARGIN = 48;
const fontPaths = {
  en: "Inter-Regular.ttf",
  "zh-CN": "NotoSansSC-Regular.ttf",
  "zh-HK": "NotoSansTC-Regular.ttf",
};
const fonts = new Map<string, Promise<Uint8Array>>();
async function loadBundledFont(
  language: Resume["language"],
): Promise<Uint8Array> {
  const path = `fonts/pdf-v1/${fontPaths[language]}`;
  let pending = fonts.get(path);
  if (!pending) {
    const url = globalThis.chrome?.runtime?.id
      ? chrome.runtime.getURL(path)
      : new URL("/" + path, location.origin).href;
    pending = fetch(url, { credentials: "omit" })
      .then(async (response) => {
        if (!response.ok) throw Error("PDF 字体加载失败，请刷新页面后重试");
        return new Uint8Array(await response.arrayBuffer());
      })
      .catch((error) => {
        fonts.delete(path);
        throw error;
      });
    fonts.set(path, pending);
  }
  return pending;
}
export function resumePdfFilename(resume: Resume): string {
  const pieces = [
    resume.renderedProfile.fullName || "Resume",
    resume.jobSnapshot.title,
    resume.jobSnapshot.company,
  ];
  return (
    pieces
      .map((x) => x.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "_").trim())
      .join("_")
      .slice(0, 180) + ".pdf"
  );
}
export function resumePdfBlocks(resume: Resume): PdfBlock[] {
  const p = resume.renderedProfile,
    l = resume.layout,
    hidden = new Set(l.hiddenItemIds),
    breaks = new Set(l.pageBreakBeforeIds);
  const blocks: PdfBlock[] = [];
  const labels =
    resume.language === "zh-HK"
      ? ["個人簡介", "工作經驗", "項目經驗", "教育背景", "技能", "語言"]
      : resume.language === "zh-CN"
        ? ["个人总结", "工作经历", "项目经历", "教育背景", "技能", "语言"]
        : [
            "PROFILE",
            "EXPERIENCE",
            "PROJECTS",
            "EDUCATION",
            "SKILLS",
            "LANGUAGES",
          ];
  const sort = <T extends { id: string }>(items: T[]) =>
    [...items].sort((a, b) => {
      const ai = l.orderedItemIds.indexOf(a.id),
        bi = l.orderedItemIds.indexOf(b.id);
      return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
    });
  const add = (text: string, kind: PdfBlock["kind"], id?: string) => {
    if (text.trim())
      blocks.push({ text, kind, pageBreak: !!id && breaks.has(id) });
  };
  add(p.fullName || "Your Name", "name");
  add(
    [p.email, p.phone, p.location, p.linkedinOrPortfolio]
      .filter(Boolean)
      .join(" · "),
    "contact",
  );
  add(p.visaStatus, "contact");
  const section = (index: number, id?: string) =>
    add(labels[index], "section", id);
  if (p.defaultSummary && !hidden.has("summary")) {
    section(0, "summary");
    add(p.defaultSummary, "body");
  }
  for (const [key, index] of [
    ["experiences", 1],
    ["projects", 2],
  ] as const) {
    const items = sort(p[key]).filter((e) => !hidden.has(e.id));
    if (!items.length) continue;
    // A break on the first entry moves its section heading with it.
    section(index, items[0].id);
    items.forEach((e, i) => {
      add(
        [e.companyOrOrg, e.period].filter(Boolean).join(" | "),
        "heading",
        i ? e.id : undefined,
      );
      add([e.role, e.location].filter(Boolean).join(" · "), "body");
      sort(e.bullets)
        .filter((b) => !hidden.has(b.id))
        .forEach((b) => add(b.text, "bullet", b.id));
    });
  }
  const education = sort(p.education).filter((e) => !hidden.has(e.id));
  if (education.length) {
    section(3, education[0].id);
    education.forEach((e, i) => {
      add(
        [e.school, e.period].filter(Boolean).join(" | "),
        "heading",
        i ? e.id : undefined,
      );
      add(e.degree, "body");
      add(e.details, "body");
    });
  }
  if (!hidden.has("skills") && p.skills.some((x) => x.trim())) {
    section(4, "skills");
    add(p.skills.filter(Boolean).join(" · "), "body");
  }
  if (!hidden.has("languages") && p.languages.some((x) => x.trim())) {
    section(5, "languages");
    add(p.languages.filter(Boolean).join(" · "), "body");
  }
  return blocks;
}
export function wrapPdfText(
  text: string,
  font: Pick<PDFFont, "widthOfTextAtSize">,
  size: number,
  width: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    const tokens =
      paragraph.match(/\s+|[\u2e80-\u9fff]|[^\s\u2e80-\u9fff]+/gu) ?? [];
    for (const token of tokens) {
      if (font.widthOfTextAtSize(line + token, size) <= width) {
        line += token;
        continue;
      }
      if (line.trim()) lines.push(line.trimEnd());
      line = "";
      const remaining = token.trimStart();
      if (font.widthOfTextAtSize(remaining, size) <= width) {
        line = remaining;
        continue;
      }
      for (const character of remaining) {
        if (line && font.widthOfTextAtSize(line + character, size) > width) {
          lines.push(line);
          line = "";
        }
        line += character;
      }
    }
    if (line.trim()) lines.push(line.trimEnd());
  }
  return lines;
}
export async function createResumePdf(
  raw: Resume,
  options: {
    loadFont?: (language: Resume["language"]) => Promise<Uint8Array>;
  } = {},
): Promise<Uint8Array> {
  const resume = ResumeSchema.parse(raw),
    blocks = resumePdfBlocks(resume);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const text = blocks.map((b) => b.text).join("");
  // Choose one face before embedding. Mixed CJK content uses Noto from the start.
  const fontLanguage =
    resume.language === "en" &&
    /[^\u0000-\u024f\u2000-\u206f\u20ac]/u.test(text)
      ? "zh-CN"
      : resume.language;
  // Full embedding avoids incomplete glyph outlines in the bundled fontkit subsetter.
  const font = await pdf.embedFont(
    await (options.loadFont ?? loadBundledFont)(fontLanguage),
    {
      subset: false,
      features: {
        kern: false,
        liga: false,
        clig: false,
        locl: false,
        ccmp: false,
        mark: false,
        mkmk: false,
        palt: false,
        halt: false,
        fwid: false,
        hwid: false,
        tnum: false,
        lnum: false,
        vert: false,
        vrt2: false,
      },
    },
  );
  const charset = new Set(font.getCharacterSet());
  const missing = [
    ...new Set(
      Array.from(blocks.map((b) => b.text).join("")).filter(
        (c) => !/[\s]/u.test(c) && !charset.has(c.codePointAt(0)!),
      ),
    ),
  ];
  if (missing.length)
    throw Error(
      `PDF 字体不支持这些字符：${missing.slice(0, 8).join(" ")}。请替换后重试，或使用打印入口。`,
    );
  pdf.setTitle(resumePdfFilename(resume).slice(0, -4));
  pdf.setAuthor(resume.renderedProfile.fullName);
  pdf.setCreator("JobsDB Companion PDF v1");
  let page: PDFPage,
    y = 0,
    used = false;
  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
    used = false;
  };
  const ensure = (height: number) => {
    if (used && y - height < MARGIN) newPage();
  };
  newPage();
  for (const block of blocks) {
    if (block.pageBreak && used) newPage();
    const size =
      block.kind === "name"
        ? 23
        : block.kind === "section"
          ? 10.5
          : block.kind === "heading"
            ? 10.5
            : block.kind === "contact"
              ? 9
              : 10;
    const lineHeight = size * 1.65,
      indent = block.kind === "bullet" ? 12 : 0;
    const lines = wrapPdfText(
      block.text,
      font,
      size,
      PAGE_WIDTH - 2 * MARGIN - indent,
    );
    const gap =
      block.kind === "section"
        ? 14
        : block.kind === "heading"
          ? 8
          : block.kind === "name"
            ? 0
            : 3;
    ensure(
      gap +
        Math.min(lines.length * lineHeight, PAGE_HEIGHT - 2 * MARGIN) +
        (block.kind === "section" ? 30 : 0),
    );
    if (used) y -= gap;
    for (let i = 0; i < lines.length; i++) {
      ensure(lineHeight);
      y -= lineHeight;
      const centered = block.kind === "name" || block.kind === "contact";
      const x = centered
        ? (PAGE_WIDTH - font.widthOfTextAtSize(lines[i], size)) / 2
        : MARGIN + indent;
      if (block.kind === "bullet" && i === 0)
        page!.drawText("•", {
          x: MARGIN,
          y,
          size,
          font,
          color: rgb(0.16, 0.2, 0.18),
        });
      page!.drawText(lines[i], {
        x,
        y,
        size,
        font,
        color:
          block.kind === "section"
            ? rgb(0.13, 0.31, 0.26)
            : rgb(0.12, 0.16, 0.14),
      });
      used = true;
    }
    if (block.kind === "section") {
      y -= 4;
      page!.drawLine({
        start: { x: MARGIN, y },
        end: { x: PAGE_WIDTH - MARGIN, y },
        thickness: 0.5,
        color: rgb(0.81, 0.85, 0.81),
      });
    }
  }
  return pdf.save();
}
export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
