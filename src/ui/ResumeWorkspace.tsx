import { reviewWarnings, resumeFactSources } from "../services/llmAdapter";
import { useState, useRef, useLayoutEffect } from "react";
import {
  defaultLayout,
  now,
  uid,
  type Resume,
  type Profile,
  type Application,
  type Suggestion,
  type Settings,
} from "../types/schema";
import { ProfileFields } from "./ProfileEditor";
export function ResumePrintPreview({ resume }: { resume: Resume }) {
  const p = resume.renderedProfile,
    layout = resume.layout,
    hidden = new Set(layout.hiddenItemIds),
    breaks = new Set(layout.pageBreakBeforeIds);
  const zh = resume.language !== "en",
    labels =
      resume.language === "zh-HK"
        ? ["個人簡介", "工作經驗", "項目經驗", "教育背景", "技能", "語言"]
        : zh
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
      const ai = layout.orderedItemIds.indexOf(a.id),
        bi = layout.orderedItemIds.indexOf(b.id);
      return (ai < 0 ? 9999 : ai) - (bi < 0 ? 9999 : bi);
    });
  const style = (id: string) => ({
    breakBefore: breaks.has(id) ? ("page" as const) : undefined,
  });
  const experiences = (key: "experiences" | "projects", title: string) => (
    <>
      {p[key].some((e) => !hidden.has(e.id)) && (
        <section>
          <h2>{title}</h2>
          {sort(p[key])
            .filter((e) => !hidden.has(e.id))
            .map((e) => (
              <div className="resume-entry" key={e.id} style={style(e.id)}>
                <div className="resume-row">
                  <strong>{e.companyOrOrg}</strong>
                  <span>{e.period}</span>
                </div>
                <div className="resume-row">
                  <em>{e.role}</em>
                  <span>{e.location}</span>
                </div>
                <ul>
                  {sort(e.bullets)
                    .filter((b) => !hidden.has(b.id) && b.text.trim())
                    .map((b) => (
                      <li key={b.id} style={style(b.id)}>
                        {b.text}
                      </li>
                    ))}
                </ul>
              </div>
            ))}
        </section>
      )}
    </>
  );
  return (
    <article
      className={`resume-paper ${zh ? "cjk" : ""}`}
      lang={resume.language}
    >
      <header>
        <h1>{p.fullName || "Your Name"}</h1>
        <div>
          {[p.email, p.phone, p.location, p.linkedinOrPortfolio]
            .filter(Boolean)
            .join(" · ")}
        </div>
        {p.visaStatus && <div>{p.visaStatus}</div>}
      </header>
      {p.defaultSummary && !hidden.has("summary") && (
        <section style={style("summary")}>
          <h2>{labels[0]}</h2>
          <p>{p.defaultSummary}</p>
        </section>
      )}
      {experiences("experiences", labels[1])}
      {experiences("projects", labels[2])}
      {p.education.some((e) => !hidden.has(e.id)) && (
        <section>
          <h2>{labels[3]}</h2>
          {sort(p.education)
            .filter((e) => !hidden.has(e.id))
            .map((e) => (
              <div className="resume-entry" key={e.id} style={style(e.id)}>
                <div className="resume-row">
                  <strong>{e.school}</strong>
                  <span>{e.period}</span>
                </div>
                <div>{e.degree}</div>
                {e.details && <p>{e.details}</p>}
              </div>
            ))}
        </section>
      )}
      {p.skills.filter(Boolean).length > 0 && !hidden.has("skills") && (
        <section style={style("skills")}>
          <h2>{labels[4]}</h2>
          <p>{p.skills.filter(Boolean).join(" · ")}</p>
        </section>
      )}
      {p.languages.filter(Boolean).length > 0 && !hidden.has("languages") && (
        <section style={style("languages")}>
          <h2>{labels[5]}</h2>
          <p>{p.languages.filter(Boolean).join(" · ")}</p>
        </section>
      )}
    </article>
  );
}
export function ResponsiveResumePreview({ resume }: { resume: Resume }) {
  const viewportRef = useRef<HTMLDivElement>(null),
    paperRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ scale: 1, width: 0, height: 0 });
  useLayoutEffect(() => {
    const viewport = viewportRef.current,
      paper = paperRef.current;
    if (!viewport || !paper) return;
    const measure = () => {
      const available = viewport.clientWidth,
        width = paper.offsetWidth,
        height = paper.offsetHeight;
      if (!available || !width || !height) return;
      const scale = Math.min(1, available / width);
      setSize((old) =>
        old.scale === scale && old.width === width && old.height === height
          ? old
          : { scale, width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(paper);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={viewportRef} className="resume-preview-viewport">
      <div
        className="resume-preview-frame"
        style={
          size.width
            ? {
                width: size.width * size.scale,
                height: size.height * size.scale,
              }
            : undefined
        }
      >
        <div
          ref={paperRef}
          className="resume-preview-content"
          style={{ transform: `scale(${size.scale})` }}
        >
          <ResumePrintPreview resume={resume} />
        </div>
      </div>
      {size.scale < 1 && (
        <p className="help no-print">
          预览缩放至 {Math.round(size.scale * 100)}%，下载和打印保持 A4 尺寸。
        </p>
      )}
    </div>
  );
}
export function ResumeWorkspace({
  initial,
  application,
  source,
  suggestion,
  generation,
  onSave,
  onClose,
  report,
  historical = false,
  compact = false,
}: {
  initial?: Resume;
  application: Application;
  source: Profile;
  suggestion?: Suggestion;
  generation?: Resume["generation"];
  historical?: boolean;
  compact?: boolean;
  onSave: (r: Resume) => Promise<void>;
  onClose: () => void;
  report: (s: string) => void;
}) {
  const [draft, setDraft] = useState<Resume>(() =>
    initial
      ? {
          ...structuredClone(initial),
          id: uid(),
          parentResumeId: initial.id,
          createdAt: now(),
          reviewedAt: now(),
        }
      : {
          id: uid(),
          applicationId: application.id,
          jobSnapshot: structuredClone(application.job),
          masterResumeVersion: source.version,
          sourceProfile: structuredClone(source),
          renderedProfile: structuredClone(source),
          suggestion,
          generation,
          language: "en",
          layout: defaultLayout(),
          reviewedAt: now(),
          createdAt: now(),
        },
  );
  const [compactView, setCompactView] = useState<"edit" | "preview">("edit");
  const [reviewed, setReviewed] = useState(historical),
    [saved, setSaved] = useState(historical),
    [busy, setBusy] = useState(false),
    [pdfBusy, setPdfBusy] = useState(false),
    [tab, setTab] = useState<"edit" | "source" | "layout">("edit");
  const update = (r: Resume) => {
    setDraft(r);
    setSaved(false);
    setReviewed(false);
  };
  const items = [
    { id: "summary", label: "个人总结" },
    { id: "skills", label: "技能" },
    { id: "languages", label: "语言" },
    ...["experiences", "projects", "education"].flatMap((k) =>
      (draft.renderedProfile[k as "experiences"] ?? []).flatMap((e) => [
        { id: e.id, label: e.companyOrOrg ?? (e as any).school ?? "教育" },
        ...("bullets" in e
          ? e.bullets.map((b, i) => ({
              id: b.id,
              label: `要点 ${i + 1}: ${b.text.slice(0, 35)}`,
            }))
          : []),
      ]),
    ),
  ];
  async function downloadPdf() {
    setPdfBusy(true);
    try {
      const snapshot = structuredClone(draft);
      const { createResumePdf, downloadPdfBytes, resumePdfFilename } =
        await import("../services/resumePdf");
      const bytes = await createResumePdf(snapshot);
      downloadPdfBytes(bytes, resumePdfFilename(snapshot));
    } catch (error) {
      report(error instanceof Error ? error.message : "PDF 生成失败，请重试");
    } finally {
      setPdfBusy(false);
    }
  }
  async function print() {
    try {
      await document.fonts.ready;
      document.title = `${draft.renderedProfile.fullName}_${draft.jobSnapshot.title}_${draft.jobSnapshot.company}`;
      window.print();
    } catch {
      report("打印未完成，请重试");
    }
  }
  const numericIssues = draft.suggestion
    ? reviewWarnings(
        draft.sourceProfile,
        draft.suggestion,
        draft.renderedProfile,
      )
    : [];
  const suspicious = numericIssues.length > 0;
  return (
    <div
      className={`resume-workspace ${compact ? `compact-resume compact-${compactView}` : ""}`}
    >
      <div className="workspace-bar no-print">
        <div>
          <span className="eyebrow">RESUME STUDIO</span>
          <h2 title={application.job.title}>{application.job.title}</h2>
          <p className="help">
            {application.job.company} · 来源主简历 v{draft.masterResumeVersion}
          </p>
        </div>
        <div className="actions">
          <button onClick={onClose}>返回岗位表</button>
          <button
            disabled={!saved || pdfBusy}
            onClick={() => void downloadPdf()}
            title={!saved ? "核对并保存简历版本后即可下载" : undefined}
          >
            {pdfBusy ? "正在生成 PDF…" : "下载 PDF"}
          </button>
          <button disabled={!saved || pdfBusy} onClick={() => void print()}>
            打印…
          </button>
          <button
            className="primary"
            disabled={!reviewed || busy || suspicious || saved}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({
                  ...draft,
                  layout: { ...draft.layout, pdfExportVersion: "pdf-v1" },
                  reviewedAt: now(),
                });
                setSaved(true);
              } catch (e) {
                report(e instanceof Error ? e.message : "保存失败");
              } finally {
                setBusy(false);
              }
            }}
          >
            {saved ? "已保存独立版本" : "保存简历版本"}
          </button>
          {!saved && (
            <p className="help" style={{ flexBasis: "100%", margin: 0 }}>
              先勾选左侧底部的事实确认并保存简历版本，即可下载 PDF。
            </p>
          )}
        </div>
        {compact && (
          <div
            className="compact-view-switch"
            role="group"
            aria-label="简历显示方式"
          >
            <button
              aria-pressed={compactView === "edit"}
              onClick={() => setCompactView("edit")}
            >
              编辑简历
            </button>
            <button
              aria-pressed={compactView === "preview"}
              onClick={() => setCompactView("preview")}
            >
              查看预览
            </button>
          </div>
        )}
      </div>
      <div className="studio-grid">
        <aside className="studio-editor no-print">
          {suspicious && (
            <div className="error" role="alert">
              <strong>保存前，请先核对以下数字</strong>
              <ul>
                {numericIssues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              <button onClick={() => setTab("source")}>查看原文对照</button>
              <button onClick={() => setTab("edit")}>回到编辑修正</button>
            </div>
          )}
          <div className="segmented">
            {(["edit", "source", "layout"] as const).map((t, i) => (
              <button
                className={tab === t ? "active" : ""}
                key={t}
                onClick={() => setTab(t)}
              >
                {["编辑", "原文对照", "显示与分页"][i]}
              </button>
            ))}
          </div>
          <label>
            简历语言
            <select
              value={draft.language}
              onChange={(e) =>
                update({
                  ...draft,
                  language: e.target.value as Resume["language"],
                })
              }
            >
              <option value="en">English</option>
              <option value="zh-HK">繁體中文</option>
              <option value="zh-CN">简体中文</option>
            </select>
          </label>
          {tab === "edit" && (
            <ProfileFields
              value={draft.renderedProfile}
              onChange={(p) => update({ ...draft, renderedProfile: p })}
            />
          )}{" "}
          {tab === "source" && (
            <>
              <p className="help">
                左侧原始事实与右侧最终稿对照检查。公司、日期等不会由模型重写；人工编辑仍需自己确认。
              </p>
              <h3>原始总结</h3>
              <p className="prewrap">
                {draft.sourceProfile.defaultSummary || "未填写"}
              </p>
              {[
                ...draft.sourceProfile.experiences,
                ...draft.sourceProfile.projects,
              ].map((e) => (
                <section className="source-card" key={e.id}>
                  <strong>
                    {e.companyOrOrg} · {e.role}
                  </strong>
                  <p>{e.period}</p>
                  {e.bullets.map((b) => (
                    <p key={b.id}>{b.text}</p>
                  ))}
                </section>
              ))}
              {draft.sourceProfile.education.map((e) => (
                <section className="source-card" key={e.id}>
                  <strong>
                    {e.school} · {e.degree}
                  </strong>
                  <p>{e.period}</p>
                  <p>{e.details}</p>
                </section>
              ))}
              {draft.sourceProfile.skills.some((x) => x.trim()) && (
                <section className="source-card">
                  <strong>原始技能</strong>
                  <p>{draft.sourceProfile.skills.filter(Boolean).join("、")}</p>
                </section>
              )}
              {draft.sourceProfile.languages.some((x) => x.trim()) && (
                <section className="source-card">
                  <strong>原始语言能力</strong>
                  <p>
                    {draft.sourceProfile.languages.filter(Boolean).join("、")}
                  </p>
                </section>
              )}
              {draft.sourceProfile.visaStatus && (
                <section className="source-card">
                  <strong>原始签证状态</strong>
                  <p>{draft.sourceProfile.visaStatus}</p>
                </section>
              )}
              {draft.suggestion && (
                <section className="source-card">
                  <h3>个人总结参考的原文</h3>
                  {resumeFactSources(draft.sourceProfile)
                    .filter((source) =>
                      draft.suggestion!.summary.sourceIds.includes(source.id),
                    )
                    .map((source) => (
                      <div key={source.id}>
                        <strong>{source.label}</strong>
                        <p className="prewrap">{source.text}</p>
                      </div>
                    ))}
                </section>
              )}
            </>
          )}
          {tab === "layout" && (
            <>
              <p className="help">
                可隐藏条目、指定条目前分页，并调整同组顺序。
              </p>
              {items.map((item) => (
                <div className="layout-item" key={item.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={!draft.layout.hiddenItemIds.includes(item.id)}
                      onChange={(e) =>
                        update({
                          ...draft,
                          layout: {
                            ...draft.layout,
                            hiddenItemIds: e.target.checked
                              ? draft.layout.hiddenItemIds.filter(
                                  (x) => x !== item.id,
                                )
                              : [...draft.layout.hiddenItemIds, item.id],
                          },
                        })
                      }
                    />
                    {item.label}
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={draft.layout.pageBreakBeforeIds.includes(
                        item.id,
                      )}
                      onChange={(e) =>
                        update({
                          ...draft,
                          layout: {
                            ...draft.layout,
                            pageBreakBeforeIds: e.target.checked
                              ? [...draft.layout.pageBreakBeforeIds, item.id]
                              : draft.layout.pageBreakBeforeIds.filter(
                                  (x) => x !== item.id,
                                ),
                          },
                        })
                      }
                    />
                    前置分页
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const ids = draft.layout.orderedItemIds.length
                        ? [...draft.layout.orderedItemIds]
                        : items.map((x) => x.id);
                      const index = ids.indexOf(item.id);
                      if (index > 0) {
                        [ids[index - 1], ids[index]] = [
                          ids[index],
                          ids[index - 1],
                        ];
                        update({
                          ...draft,
                          layout: { ...draft.layout, orderedItemIds: ids },
                        });
                      }
                    }}
                  >
                    上移
                  </button>
                </div>
              ))}
            </>
          )}
          <label className="check review-check">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            我已对照原文检查最终简历，确认经历、数字、技能和签证信息真实。
          </label>
        </aside>
        <div className="paper-stage">
          <ResponsiveResumePreview resume={draft} />
          <p className="help no-print">
            {saved
              ? "已保存独立版本，可直接下载 A4 PDF；也可使用打印入口。"
              : "请先勾选事实确认并保存简历版本，再下载 PDF。"}
          </p>
        </div>
      </div>
    </div>
  );
}
