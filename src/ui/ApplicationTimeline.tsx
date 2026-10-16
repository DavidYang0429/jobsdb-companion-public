import { useState } from "react";
import type { Application } from "../types/schema";

export function formatTrackingTime(value?: string | null, empty = "未填写") {
  return value
    ? new Date(value).toLocaleString("zh-CN", {
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : empty;
}
function localInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
type Times = { appliedAt: string | null; interviewAt: string | null };
export function ApplicationTimeline({
  record,
  busy,
  onSave,
}: {
  record: Application;
  busy: boolean;
  onSave: (
    patch: Times,
    expectedRevision: number,
  ) => Promise<boolean | undefined>;
}) {
  const [draft, setDraft] = useState<{
    appliedAt: string;
    interviewAt: string;
    revision: number;
  }>();
  const appliedAt = draft?.appliedAt ?? localInput(record.appliedAt);
  const interviewAt = draft?.interviewAt ?? localInput(record.interviewAt);
  const stale = !!draft && draft.revision !== record.revision;
  function edit(key: "appliedAt" | "interviewAt", value: string) {
    setDraft({
      appliedAt,
      interviewAt,
      revision: draft?.revision ?? record.revision,
      [key]: value,
    });
  }
  return (
    <form
      className="tracking-times"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft || stale) return;
        void onSave(
          {
            appliedAt:
              appliedAt === localInput(record.appliedAt)
                ? (record.appliedAt ?? null)
                : appliedAt
                  ? new Date(appliedAt).toISOString()
                  : null,
            interviewAt:
              interviewAt === localInput(record.interviewAt)
                ? (record.interviewAt ?? null)
                : interviewAt
                  ? new Date(interviewAt).toISOString()
                  : null,
          },
          draft.revision,
        ).then((saved) => {
          if (saved) setDraft(undefined);
        });
      }}
    >
      <h3>投递与面试时间</h3>
      <p className="help">
        加入时间：{formatTrackingTime(record.createdAt)}
        。以下两项均为选填，可全部留空，不影响保存简历或修改状态。按本机时区填写；状态变化不会自动填写时间。面试时间可记录最近一次或下一次面试。
      </p>
      <div className="form-grid">
        <label>
          投递时间（选填）
          <input
            type="datetime-local"
            max="9999-12-31T23:59"
            value={appliedAt}
            onChange={(e) => edit("appliedAt", e.target.value)}
            disabled={busy}
          />
        </label>
        <label>
          面试时间（选填）
          <input
            type="datetime-local"
            max="9999-12-31T23:59"
            value={interviewAt}
            onChange={(e) => edit("interviewAt", e.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      {stale && (
        <p className="help" role="status">
          记录已更新，本次修改尚未保存。请先载入已保存时间，再重新编辑。
        </p>
      )}
      <div className="actions">
        <button disabled={busy || !draft || stale}>保存时间</button>
        {draft && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setDraft(undefined)}
          >
            载入已保存时间
          </button>
        )}
      </div>
    </form>
  );
}
