// @vitest-environment jsdom
import { it, expect, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  extractResumeFile,
  extractDocxText,
  MAX_RESUME_BYTES,
  MAX_RESUME_TEXT,
  ResumeFileError,
} from "../src/services/resumeFile";
const file = (name: string, bytes: Uint8Array) => ({
  name,
  size: bytes.length,
  arrayBuffer: async () => new Uint8Array(bytes).buffer,
});
const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const docx = (body: string, extra: Record<string, Uint8Array> = {}) =>
  zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "word/document.xml": strToU8(
      `<w:document xmlns:w="${ns}"><w:body>${body}</w:body></w:document>`,
    ),
    ...extra,
  });
it("extracts UTF-8 and UTF-16 TXT locally without any API request", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  try {
    expect(
      (
        await extractResumeFile(
          file("cv.TXT", strToU8("测试姓名\nSQL analyst")),
        )
      ).text,
    ).toBe("测试姓名\nSQL analyst");
    const bytes = new Uint8Array([255, 254, 65, 0, 66, 0]);
    expect((await extractResumeFile(file("cv.txt", bytes))).text).toBe("AB");
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
it("extracts DOCX headers, table paragraphs, nested text boxes and footers without duplication", async () => {
  const bytes = docx(
    "<w:p><w:r><w:t>姓名 示例</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>SQL 报表</w:t></w:r></w:p></w:tc></w:tr></w:tbl><w:p><w:r><w:t>外层</w:t><w:drawing><w:p><w:r><w:t>内层</w:t></w:r></w:p></w:drawing></w:r></w:p>",
    {
      "word/header1.xml": strToU8(
        `<w:hdr xmlns:w="${ns}"><w:p><w:r><w:t>demo@example.com</w:t></w:r></w:p></w:hdr>`,
      ),
      "word/footer1.xml": strToU8(
        `<w:ftr xmlns:w="${ns}"><w:p><w:r><w:t>English</w:t></w:r></w:p></w:ftr>`,
      ),
    },
  );
  const result = await extractResumeFile(file("resume.docx", bytes));
  expect(result.text).toBe(
    "demo@example.com\n姓名 示例\nSQL 报表\n外层\n内层\nEnglish",
  );
});
it("rejects unsupported types, empty files and oversized files before reading", async () => {
  const read = vi.fn();
  await expect(
    extractResumeFile({ name: "old.doc", size: 100, arrayBuffer: read }),
  ).rejects.toMatchObject({ code: "type" });
  await expect(
    extractResumeFile({
      name: "large.pdf",
      size: MAX_RESUME_BYTES + 1,
      arrayBuffer: read,
    }),
  ).rejects.toMatchObject({ code: "size" });
  await expect(
    extractResumeFile({ name: "empty.txt", size: 0, arrayBuffer: read }),
  ).rejects.toMatchObject({ code: "empty-file" });
  expect(read).not.toHaveBeenCalled();
});
it("does not silently truncate long text or guess a non-UTF file encoding", async () => {
  await expect(
    extractResumeFile(
      file("large.txt", strToU8("A".repeat(MAX_RESUME_TEXT + 1))),
    ),
  ).rejects.toMatchObject({ code: "text-limit" });
  await expect(
    extractResumeFile(file("bad.txt", new Uint8Array([255, 1, 2]))),
  ).rejects.toMatchObject({ code: "encoding" });
});
it("rejects invalid PDF bytes and provides scanned-PDF recovery instructions", async () => {
  const readPdf = vi.fn(async () => ({ text: "", pageCount: 1 }));
  await expect(
    extractResumeFile(file("fake.pdf", strToU8("not pdf")), undefined, readPdf),
  ).rejects.toMatchObject({ code: "pdf" });
  expect(readPdf).not.toHaveBeenCalled();
  await expect(
    extractResumeFile(
      file("scan.pdf", strToU8("%PDF-1.7")),
      undefined,
      readPdf,
    ),
  ).rejects.toThrow("扫描件");
});
it("passes only local PDF bytes to the parser and preserves extracted content", async () => {
  const readPdf = vi.fn(async () => ({
    text: " Name\nSQL analyst ",
    pageCount: 2,
  }));
  const result = await extractResumeFile(
    file("cv.pdf", strToU8("%PDF-1.7")),
    undefined,
    readPdf,
  );
  expect(result).toEqual({
    fileName: "cv.pdf",
    format: "pdf",
    pageCount: 2,
    text: "Name\nSQL analyst",
  });
  expect(readPdf.mock.calls).toHaveLength(1);
});
it("rejects malformed, entity-bearing or excessive DOCX parts", () => {
  expect(() => extractDocxText(strToU8("bad zip"))).toThrow(ResumeFileError);
  expect(() =>
    extractDocxText(docx("<!DOCTYPE x><w:p><w:r><w:t>bad</w:t></w:r></w:p>")),
  ).toThrow("不支持");
  expect(() =>
    extractDocxText(docx("<w:p>" + "A".repeat(4 * 1024 * 1024) + "</w:p>")),
  ).toThrow("过大");
});
it("cancels before reading an already-aborted request", async () => {
  const ctl = new AbortController();
  ctl.abort();
  const read = vi.fn();
  await expect(
    extractResumeFile(
      { name: "cv.txt", size: 100, arrayBuffer: read },
      ctl.signal,
    ),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(read).not.toHaveBeenCalled();
});
