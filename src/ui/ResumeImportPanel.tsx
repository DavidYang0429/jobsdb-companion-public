import { useEffect, useRef, useState } from "react";
import type { Profile, Settings } from "../types/schema";
import { importProfile, providerLabel } from "../services/llmAdapter";
import { canonical } from "../services/canonical";
import {
  extractResumeFile,
  MAX_RESUME_TEXT,
  ResumeFileError,
  type ExtractedResume,
} from "../services/resumeFile";
export function ResumeImportPanel({
  settings,
  masterVersion,
  text,
  source,
  onTextChange,
  onExtracted,
  onDraft,
  onBusyChange,
  onOpenSettings,
  preview,
  hasDraft,
}: {
  settings: Settings;
  masterVersion: number;
  text: string;
  source?: Omit<ExtractedResume, "text">;
  onTextChange: (text: string) => void;
  onExtracted: (result: ExtractedResume) => void;
  onDraft: (profile: Profile, baseVersion: number) => void;
  onBusyChange: (busy: boolean) => void;
  onOpenSettings: () => void;
  preview: boolean;
  hasDraft: boolean;
}) {
  const [phase, setPhase] = useState<"idle" | "reading" | "recognizing">(
      "idle",
    ),
    [error, setError] = useState(""),
    [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null),
    operation = useRef(0),
    mounted = useRef(true),
    latest = useRef({ settings, masterVersion });
  latest.current = { settings, masterVersion };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
      controller.current?.abort();
      onBusyChange(false);
    };
  }, [onBusyChange]);
  const previousDraft = useRef(hasDraft);
  useEffect(() => {
    if (previousDraft.current && !hasDraft) {
      setStatus("原文已保留，可继续手工填写或重新识别。");
      setError("");
    }
    previousDraft.current = hasDraft;
  }, [hasDraft]);
  const provider = settings.activeProvider,
    model = settings[provider],
    processing = phase !== "idle";
  async function read(file: File) {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    const id = ++operation.current;
    setPhase("reading");
    setError("");
    setStatus("正在本地读取文件，不会调用模型…");
    onBusyChange(true);
    try {
      const result = await extractResumeFile(file, ctl.signal);
      if (!mounted.current || id !== operation.current || ctl.signal.aborted)
        return;
      onExtracted(result);
      setStatus(
        `已从 ${result.fileName} 提取 ${result.text.length.toLocaleString()} 字符${result.pageCount ? `（${result.pageCount} 页）` : ""}。请先检查下方原文，再进行 AI 识别。`,
      );
    } catch (e) {
      if (!mounted.current || id !== operation.current) return;
      setStatus("");
      setError(
        e instanceof ResumeFileError
          ? e.message
          : e instanceof DOMException && e.name === "AbortError"
            ? "文件读取已取消，原文保持不变。"
            : e instanceof DOMException && e.name === "TimeoutError"
              ? "读取文件超时。请换用较小的文字版 PDF、DOCX，或复制正文粘贴。"
              : "文件读取失败。请重新导出为 PDF／DOCX／TXT，或直接粘贴正文。",
      );
    } finally {
      if (mounted.current && id === operation.current) {
        setPhase("idle");
        onBusyChange(false);
      }
    }
  }
  async function recognize() {
    if (preview || !model.apiKey.trim() || !text.trim() || hasDraft) return;
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    const id = ++operation.current;
    const snapshot = structuredClone(settings),
      baseVersion = masterVersion,
      raw = text;
    setPhase("recognizing");
    setError("");
    setStatus(`正在使用 ${providerLabel(provider)} · ${model.model} 识别字段…`);
    onBusyChange(true);
    try {
      const profile = await importProfile(snapshot, raw, ctl.signal);
      if (!mounted.current || id !== operation.current || ctl.signal.aborted)
        return;
      if (
        latest.current.masterVersion !== baseVersion ||
        canonical(latest.current.settings) !== canonical(snapshot)
      ) {
        setError(
          "识别期间主简历或模型设置已变化，结果没有填入。原文仍保留，请重新识别。",
        );
        setStatus("");
        return;
      }
      onDraft(profile, baseVersion);
      setStatus(
        `识别完成，已填入下方待确认表单：${profile.experiences.length} 段工作经历、${profile.projects.length} 段项目、${profile.education.length} 条教育。核对并保存后才会更新主简历。`,
      );
    } catch (e) {
      if (!mounted.current || id !== operation.current) return;
      setStatus("");
      const message = e instanceof Error ? e.message : "";
      setError(
        e instanceof DOMException && e.name === "AbortError"
          ? "识别已取消。原文和当前表单保持不变，可随时重新识别。"
          : e instanceof DOMException && e.name === "TimeoutError"
            ? "AI 识别超时，原文仍保留。请稍后重试，或在设置中检查当前模型。"
            : /API Key|鉴权/.test(message)
              ? "模型连接未通过。请进入设置检查服务商、API Key 和模型名称，测试连接成功后再识别。"
              : /额度|速率/.test(message)
                ? "模型额度或请求频率受限。原文仍保留，请稍后重试或在设置中检查账号。"
                : /JSON|结构|Zod/.test(message) ||
                    (e instanceof Error && e.name === "ZodError")
                  ? "AI 这次没有返回完整、有效的简历字段。原文仍保留，请重新识别；持续失败时可按原文手工填写。"
                  : "AI 识别未完成。原文仍保留，请检查网络和模型连接后重试，也可手工填写主简历。",
      );
    } finally {
      if (mounted.current && id === operation.current) {
        setPhase("idle");
        onBusyChange(false);
      }
    }
  }
  return (
    <section
      className="import-box resume-import"
      aria-labelledby="resume-import-title"
    >
      <h3 id="resume-import-title">上传简历，自动填表</h3>
      <p className="help">
        支持 PDF、Word（.docx）、TXT，最大 10 MB；PDF 最多 20
        页。文件在本地提取文字，只有点击 AI 识别时才将下方文字发送到所选模型。
      </p>
      <label>
        选择简历文件
        <input
          type="file"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          disabled={phase === "recognizing" || hasDraft}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void read(file);
          }}
        />
      </label>
      {source && (
        <p className="help">
          当前原文来源：{source.fileName}
          {source.pageCount ? ` · ${source.pageCount} 页` : ""}
        </p>
      )}
      <label>
        简历原文（可检查或直接粘贴）
        <textarea
          rows={6}
          value={text}
          maxLength={MAX_RESUME_TEXT}
          disabled={processing || hasDraft}
          placeholder="上传后显示提取文字，也可以直接粘贴简历正文。"
          onChange={(e) => {
            onTextChange(e.target.value);
            setError("");
            setStatus("");
          }}
        />
      </label>
      <p className="help">
        {text.length.toLocaleString()} / {MAX_RESUME_TEXT.toLocaleString()} 字符
        · 当前模型：{providerLabel(provider)} · {model.model}
      </p>
      {status && (
        <p role="status" className="notice">
          {status}
        </p>
      )}
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <p>已保存的主简历不会因此改变。</p>
        </div>
      )}
      {preview && (
        <p className="help">
          网页预览可上传并提取文字；AI 识别需要在已加载的 Chrome 扩展中使用。
        </p>
      )}
      {!model.apiKey.trim() && (
        <p className="help">
          尚未配置 {providerLabel(provider)} 的 API Key。本地读取不需要
          Key，自动识别并填表需要先配置。
        </p>
      )}
      {hasDraft && (
        <p className="help">
          当前有待确认的识别草稿，请先保存或返回原表单，再开始新的识别。
        </p>
      )}
      <div className="actions">
        <button
          className="primary"
          disabled={
            processing ||
            hasDraft ||
            preview ||
            !model.apiKey.trim() ||
            !text.trim()
          }
          onClick={() => void recognize()}
        >
          {phase === "recognizing" ? "正在识别…" : "AI 识别并填入表单"}
        </button>
        <button disabled={processing} onClick={onOpenSettings}>
          设置 API Key
        </button>
        {processing && (
          <button onClick={() => controller.current?.abort()}>
            取消{phase === "reading" ? "读取" : "识别"}
          </button>
        )}
      </div>
    </section>
  );
}
