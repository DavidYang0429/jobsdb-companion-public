import { useEffect, useRef, useState } from "react";
import {
  uid,
  now,
  JobSchema,
  statusLabels,
  syncLabels,
  type State,
  type Job,
  type Application,
  type Profile,
  type Resume,
  type Suggestion,
} from "../types/schema";
import {
  command,
  request,
  subscribe,
  download,
  isPreview,
} from "../services/client";
import type { TrackerExportFormat } from "../services/trackerExport";
import { canonical, hash } from "../services/canonical";
import { SectionTabs } from "./SectionTabs";
import {
  profileSections,
  type ProfileSection,
  ProfileEditor,
} from "./ProfileEditor";
import { ResumeWorkspace } from "./ResumeWorkspace";
import { SettingsPanel } from "./SettingsPanel";
import { ResumeImportPanel } from "./ResumeImportPanel";
import { ApplicationTimeline, formatTrackingTime } from "./ApplicationTimeline";
import { UsageGuide } from "./UsageGuide";
import type { ExtractedResume } from "../services/resumeFile";
import { analyze, tailor } from "../services/llmAdapter";
import { jobIdFromUrl } from "../content/extract";
import {
  explainAIError,
  type AIRecovery,
  type AIRecoveryAction,
} from "../services/aiErrors";
import { AIRecoveryPanel } from "./AIRecoveryPanel";
function Icon({
  name,
}: {
  name: "jobs" | "profile" | "settings" | "help" | "logo";
}) {
  const paths = {
    jobs: "M4 7h16v13H4z M9 7V4h6v3 M4 12h16 M10 12v3h4v-3",
    profile: "M8 6a4 4 0 1 0 8 0a4 4 0 1 0-8 0 M4 21v-3a8 8 0 0 1 16 0v3",
    settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
    logo: "M5 12l4 4L20 5",
    help: "M9 8a3 3 0 0 1 6 0c0 2-3 2-3 5 M12 17h.01 M22 12a10 10 0 1 1-20 0a10 10 0 0 1 20 0",
  };
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function App({ panel = false }: { panel?: boolean }) {
  const [state, setState] = useState<State>(),
    [bytes, setBytes] = useState(0),
    [view, setView] = useState<"jobs" | "profile" | "settings" | "help">(
      "jobs",
    ),
    [category, setCategory] = useState("__initial__"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [exportFormat, setExportFormat] = useState<TrackerExportFormat>("xlsx"),
    [selected, setSelected] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [showCapture, setShowCapture] = useState(false),
    [capture, setCapture] = useState<Job>(),
    [captureTab, setCaptureTab] = useState<number>(),
    [editTarget, setEditTarget] = useState<Application>(),
    [analysisStale, setAnalysisStale] = useState(false),
    [categoryName, setCategoryName] = useState(""),
    [rename, setRename] = useState(false),
    [importText, setImportText] = useState(""),
    [importSource, setImportSource] = useState<Omit<ExtractedResume, "text">>(),
    [importBusy, setImportBusy] = useState(false),
    [manualDraft, setManualDraft] = useState<Profile>(),
    [imported, setImported] = useState<Profile>(),
    [importReviewed, setImportReviewed] = useState(false),
    [importBase, setImportBase] = useState(0),
    [aiLanguage, setAiLanguage] = useState<Resume["language"]>("en"),
    [preference, setPreference] = useState("");
  const [profileTab, setProfileTab] = useState<ProfileSection | "import">(
    "basic",
  );
  const [jobTab, setJobTab] = useState<
    "tracking" | "resume" | "job" | "history"
  >("tracking");
  const [detailOpen, setDetailOpen] = useState(false);
  const [visited, setVisited] = useState<string[]>([]);
  useEffect(() => {
    setVisited((old) => (old.includes(view) ? old : [...old, view]));
  }, [view]);
  const importNoticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (imported) {
      importNoticeRef.current?.focus();
      importNoticeRef.current?.scrollIntoView?.({ block: "start" });
    }
  }, [imported?.id]);
  const [studio, setStudio] = useState<{
    key: string;
    application: Application;
    source: Profile;
    initial?: Resume;
    suggestion?: Suggestion;
    generation?: Resume["generation"];
    expectedRevision: number;
    expectedMasterVersion: number;
  }>();
  const detailRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [aiIssue, setAiIssue] = useState<{
    recovery: AIRecovery;
    kind: "analysis" | "tailor";
    recordId: string;
  }>();
  useEffect(() => {
    setAiIssue(undefined);
  }, [selected]);
  const [notes, setNotes] = useState<{
    id: string;
    text: string;
    revision: number;
  }>();
  const controller = useRef<AbortController | null>(null),
    latest = useRef<State | undefined>(undefined);
  const report = (s: string) => {
    setMessage(s);
    setError("");
  };
  const fail = (e: unknown) => {
    setError(
      e instanceof Error
        ? e.message
        : typeof e === "string"
          ? e
          : "操作失败，请重试",
    );
    setMessage("");
  };
  async function refresh() {
    try {
      const result = await request({ type: "read" });
      latest.current = result.state;
      setState(result.state);
      setBytes(result.bytes);
      setCategory((c) =>
        c === "__initial__" ||
        (c && !result.state.categories.some((x: { id: string }) => x.id === c))
          ? result.state.categories[0]?.id || ""
          : c,
      );
    } catch (e) {
      fail(e);
    }
  }
  useEffect(() => {
    void refresh();
    const unsub = subscribe(() => void refresh());
    return () => {
      unsub();
      controller.current?.abort();
    };
  }, []);
  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      return await fn();
    } catch (e) {
      fail(e);
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  function changeStatus(record: Application, status: Application["status"]) {
    void run(async () => {
      await command({
        type: "updateRecord",
        id: record.id,
        expectedRevision: record.revision,
        patch: { status },
      });
      await refresh();
      report("投递进度已更新");
    });
  }
  const current = state?.records.find((r) => r.id === selected);
  useEffect(() => {
    if (view === "jobs" && detailOpen && current && !studio)
      detailRef.current?.scrollIntoView?.({ block: "start" });
  }, [view, detailOpen, current?.id, !!studio]);
  useEffect(() => {
    mainRef.current?.scrollIntoView?.({ block: "start" });
  }, [view]);
  useEffect(() => {
    if (!current) {
      setNotes(undefined);
      return;
    }
    setNotes((old) =>
      old?.id === current.id && old.text !== current.notes
        ? old
        : { id: current.id, text: current.notes, revision: current.revision },
    );
  }, [current?.id, current?.revision]);
  useEffect(() => {
    let active = true;
    if (!current?.analysis) {
      setAnalysisStale(false);
      return;
    }
    const analysis = current.analysis;
    void hash(current.job.jdRawText).then((jdHash) => {
      if (active)
        setAnalysisStale(
          analysis.masterResumeVersion !== state?.master.version ||
            jdHash !== analysis.jdHash,
        );
    });
    return () => {
      active = false;
    };
  }, [current?.job.jdRawText, current?.analysis, state?.master.version]);
  function launch(
    record: Application,
    source: Profile,
    extra: Partial<NonNullable<typeof studio>> = {},
  ) {
    setStudio({
      key: uid(),
      application: structuredClone(record),
      source: structuredClone(source),
      expectedRevision: record.revision,
      expectedMasterVersion: state!.master.version,
      ...extra,
    });
  }
  async function captureCurrent() {
    setEditTarget(undefined);
    await run(async () => {
      const result = await request({ type: "extractCurrent" });
      setCapture(JobSchema.parse(result.job));
      setCaptureTab(result.tabId);
      setShowCapture(true);
      report("已提取，请核对岗位后保存");
    });
  }
  async function aiTask(kind: "analysis" | "tailor", recordId = selected) {
    const currentRecord = state?.records.find((r) => r.id === recordId);
    if (!currentRecord || !state) return;
    if (isPreview) {
      fail(Error("模型调用请在已加载的 Chrome 扩展中进行"));
      return;
    }
    const record = structuredClone(currentRecord),
      profile = structuredClone(state.master),
      settings = structuredClone(state.settings);
    const ctl = new AbortController();
    controller.current = ctl;
    setBusy(true);
    setAiIssue(undefined);
    setError("");
    setMessage("");
    try {
      const result =
        kind === "analysis"
          ? await analyze(settings, profile, record.job, ctl.signal)
          : await tailor(
              settings,
              profile,
              record.job,
              aiLanguage,
              preference,
              ctl.signal,
            );
      await refresh();
      const fresh = latest.current,
        live = fresh?.records.find((x) => x.id === record.id);
      if (
        !fresh ||
        !live ||
        live.revision !== record.revision ||
        fresh.master.version !== profile.version ||
        canonical(fresh.settings) !== canonical(settings)
      )
        throw Error("岗位、主简历或模型设置已变化，结果未应用；请重新生成");
      if ("visa" in result) {
        await command({
          type: "analysis",
          id: record.id,
          expectedRevision: record.revision,
          expectedMasterVersion: profile.version,
          analysis: result,
        });
        await refresh();
        report("岗位分析已保存，评分仅作参考");
      } else {
        launch(record, profile, {
          source: profile,
          suggestion: result.suggestion,
          generation: {
            provider: settings.activeProvider,
            model: settings[settings.activeProvider].model,
            promptVersion: "tailor-v2",
          },
        });
        if (result.warnings.length)
          report("草稿中有数字需要核对，请按左侧提示查看具体位置并修正。");
      }
    } catch (error) {
      setAiIssue({
        recovery: explainAIError(error).recovery,
        kind,
        recordId: record.id,
      });
    } finally {
      setBusy(false);
    }
  }
  function recoverAI(action: AIRecoveryAction) {
    if (!aiIssue || !state) return;
    const record = state.records.find((r) => r.id === aiIssue.recordId);
    if (action === "profile") {
      setView("profile");
      return;
    }
    if (action === "settings") {
      setView("settings");
      return;
    }
    if (!record) return;
    if (action === "retry") {
      void aiTask(aiIssue.kind, record.id);
      return;
    }
    if (action === "manual") {
      setAiIssue(undefined);
      launch(record, state.master);
      return;
    }
    if (action === "job") {
      setEditTarget(structuredClone(record));
      setCapture(structuredClone(record.job));
      setCaptureTab(undefined);
      setShowCapture(true);
    }
  }
  if (!state)
    return (
      <main className="loading">
        <span className="brand-mark">
          <Icon name="logo" />
        </span>
        <h2>正在打开求职工作台</h2>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  const records = state.records.filter(
    (r) =>
      (!category || r.categoryId === category) &&
      (!filter || r.status === filter) &&
      `${r.job.title} ${r.job.company} ${r.notes}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const stats = [
    { label: "已归档岗位", value: state.records.length },
    {
      label: "已投递",
      value: state.records.filter((r) => r.status === "applied").length,
    },
    {
      label: "面试进行中",
      value: state.records.filter((r) => r.status === "interviewing").length,
    },
    { label: "简历版本", value: state.resumes.length },
  ];
  const toast = (
    <>
      {isPreview && (
        <div className="preview-banner no-print">
          网页预览 · 数据与 Chrome 扩展独立 · 采集和外部连接请在扩展内使用
        </div>
      )}
      {(message || error) && (
        <div
          className={`toast no-print ${error ? "error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{error || message}</span>
          <button
            aria-label="关闭提示"
            onClick={() => {
              setMessage("");
              setError("");
            }}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
  const studioView = studio
    ? (() => {
        let initial = studio.initial;
        if (!initial && studio.suggestion) {
          // Build local rendering from validated selection, never replace the source snapshot.
          const s = studio.suggestion,
            p = studio.source;
          const select = (
            items: Profile["experiences"],
            chosen: Suggestion["experiences"],
          ) =>
            chosen.map((e) => ({
              ...structuredClone(
                items.find((x) => x.id === e.sourceExperienceId)!,
              ),
              bullets: e.bullets.map((b, i) => ({
                id: `${e.sourceExperienceId}-tailored-${i}`,
                text: b.text,
              })),
            }));
          initial = {
            id: uid(),
            applicationId: studio.application.id,
            jobSnapshot: studio.application.job,
            masterResumeVersion: p.version,
            sourceProfile: p,
            renderedProfile: {
              ...structuredClone(p),
              defaultSummary: s.summary.text,
              skills: s.orderedSkills,
              experiences: select(p.experiences, s.experiences),
              projects: select(p.projects, s.projects),
            },
            language: aiLanguage,
            layout: {
              templateVersion: "a4-v1",
              fontVersion: "noto-inter-v1",
              hiddenItemIds: [],
              orderedItemIds: [],
              pageBreakBeforeIds: [],
            },
            reviewedAt: now(),
            createdAt: now(),
            suggestion: s,
            generation: studio.generation,
          };
        }
        return (
          <div className={`studio-shell ${panel ? "panel-mode" : ""}`}>
            {toast}
            <ResumeWorkspace
              key={studio.key}
              initial={initial}
              application={studio.application}
              source={studio.source}
              suggestion={studio.suggestion}
              generation={studio.generation}
              onClose={() => setStudio(undefined)}
              historical={!!studio.initial}
              compact={panel}
              report={fail}
              onSave={async (resume) => {
                if (!studio.initial) delete resume.parentResumeId;
                const result = await command({
                  type: "resume",
                  resume,
                  expectedRevision: studio.expectedRevision,
                  expectedMasterVersion: studio.expectedMasterVersion,
                });
                await refresh();
                setStudio({
                  ...studio,
                  key: uid(),
                  initial: resume,
                  expectedRevision: result.state.records.find(
                    (r) => r.id === resume.applicationId,
                  )!.revision,
                  expectedMasterVersion: result.state.master.version,
                });
                report("独立简历版本已保存，可以打印");
              }}
            />
          </div>
        );
      })()
    : null;
  return (
    <>
      {studioView}
      <div
        className={`app-shell ${panel ? "panel-mode" : ""}`}
        hidden={!!studio}
      >
        {toast}
        <aside className="sidebar no-print">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setView("jobs");
              setDetailOpen(false);
            }}
          >
            <span className="brand-mark">
              <Icon name="logo" />
            </span>
            <span>
              求职工作台<small>JOBSDB COMPANION</small>
            </span>
          </a>
          <span className="nav-caption">我的工作空间</span>
          <nav>
            {(["jobs", "profile", "settings", "help"] as const).map((v, i) => (
              <button
                key={v}
                onClick={() => {
                  setView(v);
                  if (v === "jobs") setDetailOpen(false);
                }}
                className={view === v ? "active" : ""}
              >
                <Icon name={v} />
                {["职位投递表", "主简历底座", "设置与备份", "使用说明"][i]}
                {v === "jobs" && (
                  <span className="nav-count">{state.records.length}</span>
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <span className="online-dot" />
            本地优先 · 无需登录<p>数据保存在当前浏览器</p>
            <div className="storage-meter">
              <span
                style={{
                  width: `${Math.min(100, (bytes / (10 * 1024 * 1024)) * 100)}%`,
                }}
              />
            </div>
            <small>
              {(bytes / 1024 / 1024).toFixed(2)} / 10 MB{" "}
              {bytes > 8 * 1024 * 1024 ? "· 建议备份" : ""}
            </small>
          </div>
        </aside>
        <main className="main-content" ref={mainRef}>
          <header
            className="page-header"
            hidden={view === "jobs" && detailOpen && !!current}
          >
            <div>
              <span className="eyebrow">
                {view === "jobs"
                  ? "YOUR NEXT CHAPTER"
                  : view === "profile"
                    ? "YOUR SOURCE OF TRUTH"
                    : view === "help"
                      ? "HOW TO USE"
                      : "YOUR WORKSPACE"}
              </span>
              <h1>
                {view === "jobs"
                  ? "职位投递表"
                  : view === "profile"
                    ? "主简历底座"
                    : view === "help"
                      ? "使用说明"
                      : "设置与备份"}
              </h1>
              <p>
                {view === "jobs"
                  ? "把好机会留在这里，从容推进每一次申请。"
                  : view === "profile"
                    ? "维护完整经历，再为不同的机会选择重点。"
                    : view === "help"
                      ? "按步骤开始，随时回来查看功能说明。"
                      : "外部服务按需启用，本地工作始终可用。"}
              </p>
            </div>
            <div className="actions">
              {panel && (
                <button onClick={() => void request({ type: "openDashboard" })}>
                  打开全屏工作台 ↗
                </button>
              )}
              {view === "jobs" && (
                <>
                  <button
                    onClick={() => void captureCurrent()}
                    disabled={busy || isPreview}
                  >
                    提取当前岗位
                  </button>
                  <button
                    className="primary"
                    onClick={() => {
                      setEditTarget(undefined);
                      setCapture(undefined);
                      setCaptureTab(undefined);
                      setShowCapture(true);
                    }}
                  >
                    ＋ 手动录入
                  </button>
                </>
              )}
            </div>
          </header>
          {aiIssue && (view === "profile" || view === "settings") && (
            <div className="notice">
              <p>
                {view === "profile"
                  ? "补充资料后请点击“保存主简历”，再返回刚才的岗位继续生成。"
                  : "确认服务商和模型，测试连接成功并保存设置后，再返回刚才的岗位继续生成。"}
              </p>
              <button
                onClick={() => {
                  setSelected(aiIssue.recordId);
                  setView("jobs");
                  setDetailOpen(true);
                  setJobTab("resume");
                  setAiIssue(undefined);
                }}
              >
                返回刚才的岗位
              </button>
            </div>
          )}
          <div hidden={view !== "jobs"}>
            <div hidden={!!current && detailOpen}>
              <div className="stat-grid">
                {stats.map((s, i) => (
                  <div className="stat-card" key={s.label}>
                    <span>{s.label}</span>
                    <strong>{s.value.toString().padStart(2, "0")}</strong>
                    <span className={`stat-accent accent-${i}`}>
                      {["↗", "→", "◉", "▤"][i]}
                    </span>
                  </div>
                ))}
              </div>
              <section className="card tracker">
                <div className="tracker-heading">
                  <div>
                    <h2>
                      我的职位投递表{" "}
                      <span className="pill">{records.length}</span>
                    </h2>
                    <p className="help">
                      点击岗位可填写投递与面试时间，或查看简历和备注。
                    </p>
                  </div>
                  <div className="export-controls">
                    <label>
                      导出格式
                      <select
                        value={exportFormat}
                        disabled={busy}
                        onChange={(event) =>
                          setExportFormat(
                            event.target.value as TrackerExportFormat,
                          )
                        }
                      >
                        <option value="xlsx">Excel (.xlsx)</option>
                        <option value="csv">CSV (.csv)</option>
                      </select>
                    </label>
                    <button
                      disabled={busy}
                      title={`导出当前筛选的 ${records.length} 条岗位`}
                      onClick={() =>
                        void run(async () => {
                          const { createTrackerExport } =
                            await import("../services/trackerExport");
                          const file = createTrackerExport(
                            records,
                            state.categories,
                            exportFormat,
                          );
                          download(file.name, file.content, file.type);
                        })
                      }
                    >
                      导出投递表 ↗
                    </button>
                  </div>
                </div>
                <div className="toolbar">
                  <label className="search-field">
                    <span>⌕</span>
                    <input
                      aria-label="搜索岗位"
                      placeholder="搜索职位、公司或备注…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="投递表分类"
                    value={category}
                    onChange={(e) => {
                      setCategory(e.target.value);
                      setSelected("");
                    }}
                  >
                    <option value="">全部投递表</option>
                    {state.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="筛选状态"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="">全部状态</option>
                    {Object.entries(statusLabels).map(([s, label]) => (
                      <option key={s} value={s}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => {
                      setRename(false);
                      setCategoryName("");
                    }}
                  >
                    ＋ 分类
                  </button>
                  {category && (
                    <button
                      onClick={() => {
                        setRename(true);
                        setCategoryName(
                          state.categories.find((c) => c.id === category)
                            ?.name ?? "",
                        );
                      }}
                    >
                      改名
                    </button>
                  )}
                </div>
                <form
                  className="category-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      await command({
                        type: "category",
                        id: rename ? category : undefined,
                        name: categoryName,
                        expectedRevision: state.revision,
                      });
                      setCategoryName("");
                      setRename(false);
                      await refresh();
                      report("分类已保存");
                    });
                  }}
                >
                  <input
                    aria-label="分类名称"
                    placeholder={rename ? "输入新的分类名称" : "新分类名称"}
                    value={categoryName}
                    onChange={(e) => setCategoryName(e.target.value)}
                  />
                  <button disabled={busy || !categoryName.trim()}>
                    {rename ? "确认改名" : "添加分类"}
                  </button>
                </form>
                {records.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>职位 / 公司</th>
                          <th>投递进度</th>
                          <th>简历</th>
                          <th>同步</th>
                          <th>加入时间</th>
                          <th>投递时间</th>
                          <th>面试时间</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map((r) => (
                          <tr
                            key={r.id}
                            className={selected === r.id ? "selected" : ""}
                          >
                            <td>
                              <button
                                className="job-link"
                                onClick={() => {
                                  setSelected(r.id);
                                  setDetailOpen(true);
                                  setJobTab("tracking");
                                }}
                              >
                                <strong>{r.job.title}</strong>
                                <span>
                                  {r.job.company}{" "}
                                  <span className="muted">
                                    · {r.job.location || "地点未注明"}
                                  </span>
                                </span>
                              </button>
                            </td>
                            <td data-label="投递进度">
                              <select
                                aria-label={`${r.job.title}投递状态`}
                                className={`status-select status-${r.status}`}
                                value={r.status}
                                disabled={busy}
                                onChange={(e) =>
                                  changeStatus(
                                    r,
                                    e.target.value as Application["status"],
                                  )
                                }
                              >
                                {Object.entries(statusLabels).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {v}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td data-label="简历">
                              <span
                                className={`badge ${r.latestTailoredResumeId ? "green" : ""}`}
                              >
                                {r.latestTailoredResumeId ? "已保存" : "待准备"}
                              </span>
                            </td>
                            <td data-label="同步">
                              <span
                                className="sync-text"
                                title={r.sync.lastError}
                              >
                                {syncLabels[r.sync.status]}
                              </span>
                            </td>
                            <td className="muted" data-label="加入时间">
                              {formatTrackingTime(r.createdAt)}
                            </td>
                            <td className="muted" data-label="投递时间">
                              {formatTrackingTime(r.appliedAt)}
                            </td>
                            <td className="muted" data-label="面试时间">
                              {formatTrackingTime(r.interviewAt)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <Icon name="jobs" />
                    </div>
                    <h3>
                      {search || filter
                        ? "没有符合条件的岗位"
                        : "从一份值得申请的工作开始"}
                    </h3>
                    <p>在 JobsDB 打开岗位并提取，或手动录入第一个机会。</p>
                    <button
                      className="primary"
                      onClick={() => {
                        setEditTarget(undefined);
                        setCapture(undefined);
                        setCaptureTab(undefined);
                        setShowCapture(true);
                      }}
                    >
                      ＋ 录入一个岗位
                    </button>
                  </div>
                )}
              </section>
            </div>
            {current && (
              <section
                ref={detailRef}
                className="card job-details"
                hidden={!detailOpen}
              >
                <button
                  className="back-to-list"
                  onClick={() => setDetailOpen(false)}
                >
                  ← 返回投递表
                </button>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">OPPORTUNITY DETAILS</span>
                    <h2>{current.job.title}</h2>
                    <p>{current.job.company}</p>
                  </div>
                  <a
                    className="button"
                    href={current.job.jobUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    查看原岗位 ↗
                  </a>
                </div>
                <SectionTabs
                  id="job-detail"
                  label="岗位功能"
                  value={jobTab}
                  onChange={setJobTab}
                  options={[
                    { id: "tracking", label: "跟进记录" },
                    { id: "resume", label: "制作简历" },
                    { id: "job", label: "岗位资料" },
                    { id: "history", label: "历史版本" },
                  ]}
                />
                <div
                  role="tabpanel"
                  id="job-detail-panel-resume"
                  aria-labelledby="job-detail-tab-resume"
                  hidden={jobTab !== "resume"}
                >
                  <div className="form-grid">
                    <label>
                      AI 输出语言
                      <select
                        value={aiLanguage}
                        onChange={(e) =>
                          setAiLanguage(e.target.value as Resume["language"])
                        }
                      >
                        <option value="en">English</option>
                        <option value="zh-HK">繁體中文</option>
                        <option value="zh-CN">简体中文</option>
                      </select>
                    </label>
                    <label>
                      定制侧重
                      <input
                        value={preference}
                        onChange={(e) => setPreference(e.target.value)}
                        placeholder="例如：突出数据分析经历"
                      />
                    </label>
                  </div>
                  <div className="actions">
                    <button
                      className="primary"
                      onClick={() => launch(current, state.master)}
                    >
                      手工制作简历
                    </button>
                    <button
                      disabled={busy || isPreview}
                      onClick={() => void aiTask("tailor")}
                    >
                      AI 定制简历
                    </button>
                    {busy && (
                      <button onClick={() => controller.current?.abort()}>
                        取消生成
                      </button>
                    )}
                  </div>
                </div>
                {aiIssue?.recordId === current.id && (
                  <AIRecoveryPanel
                    recovery={aiIssue.recovery}
                    allowManual={aiIssue.kind === "tailor"}
                    busy={busy}
                    onAction={recoverAI}
                  />
                )}
                <p className="help" hidden={jobTab !== "resume"}>
                  AI
                  结果需要人工审阅；可选择英文、繁中或简中；手工编辑切换语言不会自动翻译正文。
                </p>
                <div
                  role="tabpanel"
                  id="job-detail-panel-tracking"
                  aria-labelledby="job-detail-tab-tracking"
                  hidden={jobTab !== "tracking"}
                >
                  <label>
                    投递状态
                    <select
                      aria-label="当前岗位投递状态"
                      className={`status-select status-${current.status}`}
                      value={current.status}
                      disabled={busy}
                      onChange={(e) =>
                        changeStatus(
                          current,
                          e.target.value as Application["status"],
                        )
                      }
                    >
                      {Object.entries(statusLabels).map(([id, label]) => (
                        <option key={id} value={id}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ApplicationTimeline
                    key={current.id}
                    record={current}
                    busy={busy}
                    onSave={(patch, expectedRevision) =>
                      run(async () => {
                        await command({
                          type: "updateRecord",
                          id: current.id,
                          expectedRevision,
                          patch,
                        });
                        await refresh();
                        report("投递与面试时间已保存");
                        return true;
                      })
                    }
                  />
                  <label>
                    个人备注
                    <textarea
                      rows={3}
                      value={
                        notes?.id === current.id ? notes.text : current.notes
                      }
                      onChange={(e) =>
                        setNotes({
                          id: current.id,
                          text: e.target.value,
                          revision:
                            notes?.id === current.id
                              ? notes.revision
                              : current.revision,
                        })
                      }
                    />
                  </label>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!notes) return;
                        const result = await command({
                          type: "updateRecord",
                          id: current.id,
                          expectedRevision: notes.revision,
                          patch: { notes: notes.text },
                        });
                        setNotes({
                          id: current.id,
                          text: notes.text,
                          revision: result.state.records.find(
                            (r) => r.id === current.id,
                          )!.revision,
                        });
                        await refresh();
                        report("备注已保存");
                      })
                    }
                  >
                    保存备注
                  </button>
                </div>
                <div
                  role="tabpanel"
                  id="job-detail-panel-job"
                  aria-labelledby="job-detail-tab-job"
                  hidden={jobTab !== "job"}
                >
                  <div className="actions">
                    {" "}
                    <button
                      onClick={() => {
                        setEditTarget(structuredClone(current));
                        setCapture(structuredClone(current.job));
                        setCaptureTab(undefined);
                        setShowCapture(true);
                      }}
                    >
                      编辑岗位信息
                    </button>
                    <button
                      disabled={busy || isPreview}
                      onClick={() => void aiTask("analysis")}
                    >
                      AI 岗位分析
                    </button>
                  </div>
                  {current.analysis && (
                    <div className="analysis">
                      <h3>
                        匹配参考 {current.analysis.matchScore}/100{" "}
                        {analysisStale && (
                          <span className="badge">
                            岗位或主简历已更新，请刷新分析
                          </span>
                        )}
                      </h3>
                      <p>{current.analysis.matchAnalysis}</p>
                      <p>签证：{current.analysis.visa.value}</p>
                      {[
                        current.analysis.visa,
                        ...current.analysis.languages,
                      ].map((e, i) => (
                        <p className="help" key={i}>
                          {e.value} {e.quotes.map((q) => `「${q}」`).join("；")}
                        </p>
                      ))}
                      <div className="tags">
                        {current.analysis.coreKeywords.map((k) => (
                          <span key={k}>{k}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <details open>
                    <summary>岗位描述</summary>
                    <div className="jd-text">{current.job.jdRawText}</div>
                  </details>
                </div>
                <div
                  role="tabpanel"
                  id="job-detail-panel-history"
                  aria-labelledby="job-detail-tab-history"
                  hidden={jobTab !== "history"}
                >
                  <h3>历史简历版本</h3>
                  {state.resumes
                    .filter((r) => r.applicationId === current.id)
                    .map((r) => (
                      <div className="history-row" key={r.id}>
                        <span>
                          {new Date(r.createdAt).toLocaleString("zh-CN")} ·{" "}
                          {r.language} · 来源 v{r.masterResumeVersion}
                        </span>
                        <button
                          onClick={() =>
                            launch(current, r.sourceProfile, { initial: r })
                          }
                        >
                          查看 / 另存版本
                        </button>
                      </div>
                    ))}
                  {!current.latestTailoredResumeId && (
                    <p className="help">还没有保存简历版本。</p>
                  )}
                </div>
              </section>
            )}
          </div>
          <div hidden={view !== "profile"}>
            {(view === "profile" || visited.includes("profile")) && (
              <section className="card profile-card">
                <div className="section-heading">
                  <div>
                    <p className="help">
                      当前已保存版本 v{state.master.version} ·
                      修改后不会影响历史定制简历
                    </p>
                  </div>
                </div>
                <SectionTabs
                  id="master-profile"
                  label="主简历功能"
                  value={profileTab}
                  onChange={setProfileTab}
                  options={[
                    ...profileSections,
                    { id: "import", label: "上传导入" },
                  ]}
                />
                <div
                  role="tabpanel"
                  id="master-profile-panel-import"
                  aria-labelledby="master-profile-tab-import"
                  hidden={profileTab !== "import"}
                >
                  {view === "profile" && profileTab === "import" && (
                    <ResumeImportPanel
                      settings={state.settings}
                      masterVersion={state.master.version}
                      text={importText}
                      source={importSource}
                      onTextChange={(text) => {
                        setImportText(text);
                        setImportSource(undefined);
                      }}
                      onExtracted={(result) => {
                        const { text, ...source } = result;
                        setImportText(text);
                        setImportSource(source);
                      }}
                      onDraft={(profile, baseVersion) => {
                        setProfileTab("basic");
                        setImported(profile);
                        setImportBase(baseVersion);
                        setImportReviewed(false);
                        setError("");
                        setMessage("");
                      }}
                      onBusyChange={setImportBusy}
                      onOpenSettings={() => setView("settings")}
                      preview={isPreview}
                      hasDraft={!!imported}
                    />
                  )}
                </div>
                <div hidden={profileTab === "import"}>
                  {imported && (
                    <div ref={importNoticeRef} tabIndex={-1} className="notice">
                      <p>
                        已将识别结果填入下方表单，尚未覆盖主简历。请逐项核对和修改；保存会以当前表单更新整份主简历，不会自动合并旧字段。
                      </p>
                      <button
                        onClick={() => {
                          setImported(undefined);
                          setImportReviewed(false);
                        }}
                      >
                        返回原表单
                      </button>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={importReviewed}
                          onChange={(e) => setImportReviewed(e.target.checked)}
                        />
                        我已核对下方全部解析字段与原文一致
                      </label>
                    </div>
                  )}
                  <ProfileEditor
                    section={profileTab === "import" ? "basic" : profileTab}
                    key={imported?.id ?? state.master.id}
                    initial={imported ?? manualDraft ?? state.master}
                    onDraftChange={(profile) => {
                      if (!imported) setManualDraft(profile);
                    }}
                    busy={busy || importBusy || (!!imported && !importReviewed)}
                    onSave={async (profile, version) => {
                      setBusy(true);
                      try {
                        const result = await command({
                          type: "profile",
                          profile,
                          expectedVersion: imported ? importBase : version,
                        });
                        await refresh();
                        setImported(undefined);
                        setManualDraft(undefined);
                        report("主简历已保存，历史简历保持不变");
                        return result.state.master;
                      } catch (e) {
                        fail(e);
                        throw e;
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </div>
              </section>
            )}
          </div>
          <div hidden={view !== "settings"}>
            {(view === "settings" || visited.includes("settings")) && (
              <SettingsPanel
                state={state}
                onChanged={refresh}
                report={report}
              />
            )}
          </div>
          <div hidden={view !== "help"}>
            {(view === "help" || visited.includes("help")) && (
              <UsageGuide
                onNavigate={(destination) => {
                  setView(destination);
                  if (destination === "jobs") setDetailOpen(false);
                }}
              />
            )}
          </div>
          <footer className="app-footer">
            每一个认真准备的机会，都值得被好好记录。
            <span>JobsDB Companion · v0.1.0</span>
          </footer>
        </main>
        {showCapture && (
          <div className="modal-backdrop">
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setShowCapture(false);
                }
                if (e.key === "Tab") {
                  const items = Array.from(
                    e.currentTarget.querySelectorAll<HTMLElement>(
                      "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[href]",
                    ),
                  );
                  const first = items[0],
                    last = items[items.length - 1];
                  if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                  } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                  }
                }
              }}
              aria-labelledby="capture-heading"
            >
              <div className="section-heading">
                <div>
                  <span className="eyebrow">SAVE AN OPPORTUNITY</span>
                  <h2 id="capture-heading">
                    {editTarget
                      ? "更新岗位信息"
                      : capture
                        ? "确认提取的岗位"
                        : "手动录入岗位"}
                  </h2>
                </div>
                <button
                  aria-label="关闭录入"
                  onClick={() => setShowCapture(false)}
                >
                  ×
                </button>
              </div>
              <CaptureForm
                key={capture?.jobKey ?? "manual"}
                initial={capture}
                categories={state.categories}
                categoryId={editTarget?.categoryId ?? category}
                busy={busy}
                editing={!!editTarget}
                onSave={async (job, categoryId) => {
                  await run(async () => {
                    const result = editTarget
                      ? await command({
                          type: "updateRecord",
                          id: editTarget.id,
                          expectedRevision: editTarget.revision,
                          patch: { job },
                        })
                      : captureTab
                        ? await request({
                            type: "saveCaptured",
                            tabId: captureTab,
                            job,
                            categoryId,
                          })
                        : await command({ type: "addJob", categoryId, job });
                    await refresh();
                    setSelected(result.selectedId ?? editTarget?.id ?? "");
                    setDetailOpen(true);
                    setJobTab("tracking");
                    setCategory(categoryId);
                    setShowCapture(false);
                    report(
                      editTarget
                        ? "岗位信息已更新，备注与投递进度保持不变"
                        : "岗位已保存；同表重复岗位自动定位到已有记录",
                    );
                  });
                }}
              />
            </section>
          </div>
        )}
      </div>
    </>
  );
}
function CaptureForm({
  initial,
  categories,
  categoryId,
  busy,
  onSave,
  editing = false,
}: {
  editing?: boolean;
  initial?: Job;
  categories: State["categories"];
  categoryId: string;
  busy: boolean;
  onSave: (j: Job, c: string) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    formRef.current
      ?.querySelector<HTMLInputElement>("input:not(:disabled)")
      ?.focus();
  }, []);
  const [values, setValues] = useState({
      url: initial?.jobUrl ?? "",
      title: initial?.title ?? "",
      company: initial?.company ?? "",
      location: initial?.location ?? "",
      salary: initial?.salary ?? "",
      workType: initial?.workType ?? "",
      jd: initial?.jdRawText ?? "",
    }),
    [category, setCategory] = useState(categoryId || categories[0]?.id || ""),
    [error, setError] = useState("");
  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        try {
          const id = jobIdFromUrl(values.url);
          if (!id) throw Error("请填写包含岗位 ID 的 JobsDB 详情链接");
          const job = JobSchema.parse({
            source: "jobsdb",
            sourceJobId: id,
            jobKey: `jobsdb:${id}`,
            title: values.title,
            company: values.company,
            location: values.location || null,
            salary: values.salary || null,
            workType: values.workType || null,
            jobUrl: `https://hk.jobsdb.com/job/${id}`,
            jdRawText: values.jd,
            jdParagraphs: values.jd.split(/\n+/).filter(Boolean),
            capturedAt: now(),
          });
          void onSave(job, category);
        } catch (err) {
          setError(err instanceof Error ? err.message : "字段不完整");
        }
      }}
    >
      <label>
        投递表
        <select
          disabled={editing}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="form-grid">
        {(
          ["url", "title", "company", "location", "salary", "workType"] as const
        ).map((k, i) => (
          <label key={k}>
            {
              [
                "岗位链接",
                "职位名称",
                "公司名称",
                "工作地点",
                "薪资（可选）",
                "工作类型（可选）",
              ][i]
            }
            <input
              disabled={editing && k === "url"}
              required={["url", "title", "company"].includes(k)}
              value={values[k]}
              onChange={(e) => setValues({ ...values, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label>
        岗位描述 JD
        <textarea
          required
          rows={7}
          value={values.jd}
          onChange={(e) => setValues({ ...values, jd: e.target.value })}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="sticky-actions">
        <span className="help">确认当前岗位信息后保存到本地</span>
        <button className="primary" disabled={busy} type="submit">
          保存到投递表
        </button>
      </div>
    </form>
  );
}
