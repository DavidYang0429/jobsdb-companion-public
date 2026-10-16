import { getDocument, PDFWorker } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import {
  MAX_RESUME_PAGES,
  MAX_RESUME_TEXT,
  ResumeFileError,
} from "./resumeFile";
function asset(path: string) {
  return globalThis.chrome?.runtime?.id
    ? chrome.runtime.getURL(`pdfjs-assets/${path}`)
    : new URL(`/pdfjs-assets/${path}`, location.origin).href;
}
export async function readPdfResume(
  data: Uint8Array,
  signal: AbortSignal,
): Promise<{ text: string; pageCount: number }> {
  signal.throwIfAborted();
  // Supply our own same-origin module port; do not use PDF.js blob wrappers or remote workers.
  const port = new Worker(workerUrl, {
    type: "module",
    name: "resume-pdf-reader",
  });
  const worker = PDFWorker.create({ port });
  const task = getDocument({
    data,
    worker,
    useWasm: false,
    disableFontFace: true,
    useWorkerFetch: false,
    cMapUrl: asset("cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: asset("standard_fonts/"),
    verbosity: 0,
  });
  const abort = () => {
    void task.destroy().catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    const document = await task.promise;
    signal.throwIfAborted();
    if (document.numPages > MAX_RESUME_PAGES)
      throw new ResumeFileError(
        "pages",
        "PDF 超过 20 页。请只保留简历页，去掉作品集或其他附件后重试。",
      );
    const pages: string[] = [];
    let length = 0;
    for (let pageNo = 1; pageNo <= document.numPages; pageNo++) {
      signal.throwIfAborted();
      const page = await document.getPage(pageNo),
        content = await page.getTextContent();
      let pageText = "",
        previousRight: number | undefined,
        previousY: number | undefined;
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const x = item.transform[4],
          y = item.transform[5];
        if (
          previousY !== undefined &&
          Math.abs(y - previousY) > Math.max(2, item.height * 0.5) &&
          !pageText.endsWith("\n")
        )
          pageText += "\n";
        else if (
          previousRight !== undefined &&
          x - previousRight > Math.max(1, item.height * 0.15) &&
          !/[\s]$/.test(pageText)
        )
          pageText += " ";
        pageText += item.str;
        if (item.hasEOL) {
          pageText += "\n";
          previousRight = undefined;
          previousY = undefined;
        } else {
          previousRight = x + item.width;
          previousY = y;
        }
      }
      length += pageText.length;
      if (length > MAX_RESUME_TEXT)
        throw new ResumeFileError(
          "text-limit",
          "PDF 文字超过 50,000 字符。请只保留简历正文后重试。",
        );
      pages.push(pageText);
      page.cleanup();
    }
    return { text: pages.join("\n\n"), pageCount: document.numPages };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof ResumeFileError) throw error;
    if (error instanceof Error && error.name === "PasswordException")
      throw new ResumeFileError(
        "password",
        "PDF 受密码保护，请先用已解锁的副本，或复制正文粘贴后识别。",
      );
    throw new ResumeFileError(
      "pdf",
      "PDF 无法读取或文件已损坏。请重新导出为文字版 PDF，或改用 DOCX／TXT。",
    );
  } finally {
    signal.removeEventListener("abort", abort);
    await task.destroy().catch(() => {});
    worker.destroy();
    port.terminate();
  }
}
