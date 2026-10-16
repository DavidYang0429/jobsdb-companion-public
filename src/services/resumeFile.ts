import { Unzip, UnzipInflate } from "fflate";
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const MAX_RESUME_TEXT = 50000;
export const MAX_RESUME_PAGES = 20;
export interface ResumeFile {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface ExtractedResume {
  fileName: string;
  format: "pdf" | "docx" | "txt";
  text: string;
  pageCount?: number;
}
export class ResumeFileError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ResumeFileError";
  }
}
export function decodeResumeText(bytes: Uint8Array): string {
  try {
    const encoding =
      bytes[0] === 0xff && bytes[1] === 0xfe
        ? "utf-16le"
        : bytes[0] === 0xfe && bytes[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    return new TextDecoder(encoding, { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    throw new ResumeFileError(
      "encoding",
      "无法读取文字编码。请将 TXT 另存为 UTF-8，或复制正文粘贴到下方。",
    );
  }
}
export function checkResumeText(text: string, format: string): string {
  const result = text
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .trim();
  if (!result)
    throw new ResumeFileError(
      "empty",
      format === "pdf"
        ? "这份 PDF 没有可提取的文字，可能是扫描件或图片版。请换成可选择文字的 PDF、DOCX，或粘贴正文；当前不提供图片 OCR。"
        : "文件中没有提取到可用文字。请检查正文是否为图片，或直接复制文字粘贴到下方。",
    );
  if (result.length > MAX_RESUME_TEXT)
    throw new ResumeFileError(
      "text-limit",
      "简历文字超过 50,000 字符。请保留简历正文、去掉附件后重新上传，或粘贴精简后的文字。",
    );
  return result;
}
function xmlParagraphs(xml: string): string {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new ResumeFileError(
      "xml",
      "DOCX 含有不支持的文档结构，请另存为新的 DOCX 或 PDF 后重试。",
    );
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror"))
    throw new ResumeFileError(
      "xml",
      "DOCX 正文损坏，无法读取。请用 Word 重新另存为 DOCX 或导出 PDF。",
    );
  const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const nodes = Array.from(doc.getElementsByTagNameNS(ns, "p"));
  const walk = (node: Node, root: Node): string => {
    if (node.nodeType !== 1) return "";
    const element = node as Element;
    if (element.namespaceURI === ns) {
      if (element.localName === "p" && node !== root) return "";
      if (element.localName === "t") return element.textContent ?? "";
      if (element.localName === "tab") return "\t";
      if (element.localName === "br" || element.localName === "cr") return "\n";
    }
    return Array.from(node.childNodes)
      .map((n) => walk(n, root))
      .join("");
  };
  return nodes
    .map((p) => walk(p, p).trim())
    .filter(Boolean)
    .join("\n");
}
export function extractDocxText(
  bytes: Uint8Array,
  signal?: AbortSignal,
): string {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new ResumeFileError(
      "docx",
      "文件不是有效 DOCX。请用 Word 另存为 .docx 后重试；旧版 .doc 不能直接上传。",
    );
  const parts = new Map<string, string>();
  let entries = 0,
    total = 0,
    contentTypes = false;
  try {
    const unzip = new Unzip((file) => {
      signal?.throwIfAborted();
      if (++entries > 512)
        throw new ResumeFileError(
          "zip-limit",
          "DOCX 内部附件过多。请去掉附件或导出为文字版 PDF 后重试。",
        );
      if (file.name === "[Content_Types].xml") contentTypes = true;
      if (!/^word\/(?:document|header\d*|footer\d*)\.xml$/.test(file.name))
        return;
      if (
        parts.has(file.name) ||
        (file.originalSize && file.originalSize > 4 * 1024 * 1024)
      )
        throw new ResumeFileError(
          "zip-limit",
          "DOCX 正文结构过大或重复，请另存为新的 DOCX 或粘贴正文。",
        );
      const chunks: Uint8Array[] = [];
      let length = 0;
      // Reserve the name immediately to reject duplicate selected entries.
      parts.set(file.name, "");
      file.ondata = (error, data, final) => {
        if (error) throw error;
        signal?.throwIfAborted();
        length += data.length;
        total += data.length;
        if (length > 4 * 1024 * 1024 || total > 8 * 1024 * 1024) {
          file.terminate();
          throw new ResumeFileError(
            "zip-limit",
            "DOCX 解压后的正文过大。请去掉附件或直接粘贴简历正文。",
          );
        }
        chunks.push(data);
        if (final) {
          const joined = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            joined.set(chunk, offset);
            offset += chunk.length;
          }
          parts.set(file.name, decodeResumeText(joined));
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      signal?.throwIfAborted();
      unzip.push(
        bytes.subarray(offset, Math.min(bytes.length, offset + 8192)),
        offset + 8192 >= bytes.length,
      );
    }
  } catch (error) {
    if (error instanceof ResumeFileError || error instanceof DOMException)
      throw error;
    throw new ResumeFileError(
      "docx",
      "DOCX 无法解压或已损坏。请用 Word 重新另存为 DOCX，或上传 PDF／TXT。",
    );
  }
  if (!contentTypes || !parts.has("word/document.xml"))
    throw new ResumeFileError(
      "docx",
      "没有找到有效的 Word 正文。请确认上传的是 .docx 简历，或改用 PDF／TXT。",
    );
  const headers = [...parts.keys()].filter((n) => /\/header/.test(n)).sort();
  const footers = [...parts.keys()].filter((n) => /\/footer/.test(n)).sort();
  return [...headers, "word/document.xml", ...footers]
    .map((name) => xmlParagraphs(parts.get(name)!))
    .filter(Boolean)
    .join("\n");
}
export async function extractResumeFile(
  file: ResumeFile,
  signal?: AbortSignal,
  readPdf?: (
    data: Uint8Array,
    signal: AbortSignal,
  ) => Promise<{ text: string; pageCount: number }>,
): Promise<ExtractedResume> {
  if (file.size > MAX_RESUME_BYTES)
    throw new ResumeFileError(
      "size",
      "文件超过 10 MB。请压缩或导出为较小的 PDF／DOCX／TXT 后重试。",
    );
  if (file.size === 0)
    throw new ResumeFileError(
      "empty-file",
      "文件为空，请重新选择含有正文的简历文件。",
    );
  const format = file.name.split(".").pop()?.toLowerCase();
  if (format !== "pdf" && format !== "docx" && format !== "txt")
    throw new ResumeFileError(
      "type",
      "支持 PDF、DOCX 和 TXT。旧版 DOC、图片或其他格式请先转换，或直接粘贴简历文字。",
    );
  const combined = AbortSignal.any([
    AbortSignal.timeout(30000),
    ...(signal ? [signal] : []),
  ]);
  combined.throwIfAborted();
  const bytes = new Uint8Array(await file.arrayBuffer());
  combined.throwIfAborted();
  if (bytes.length > MAX_RESUME_BYTES)
    throw new ResumeFileError("size", "文件超过 10 MB，请换用较小的文件。");
  if (format === "txt")
    return {
      fileName: file.name,
      format,
      text: checkResumeText(decodeResumeText(bytes), format),
    };
  if (format === "docx")
    return {
      fileName: file.name,
      format,
      text: checkResumeText(extractDocxText(bytes, combined), format),
    };
  if (!new TextDecoder().decode(bytes.subarray(0, 1024)).includes("%PDF-"))
    throw new ResumeFileError(
      "pdf",
      "文件不是有效 PDF。请重新导出为 PDF，或使用 DOCX／TXT。",
    );
  const reader = readPdf ?? (await import("./resumePdfReader")).readPdfResume;
  combined.throwIfAborted();
  const result = await reader(bytes, combined);
  return {
    fileName: file.name,
    format,
    pageCount: result.pageCount,
    text: checkResumeText(result.text, format),
  };
}
