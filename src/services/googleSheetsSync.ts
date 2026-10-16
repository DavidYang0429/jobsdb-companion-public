import { z } from "zod";
import { canonical, hash } from "./canonical";
import { projectRow, type createStore } from "./storage";
import { now, type Task, type Settings } from "../types/schema";
const AckSchema = z
  .object({
    ok: z.literal(true),
    targetId: z.string(),
    requestId: z.string(),
    recordId: z.string(),
    appliedRevision: z.number().int().positive(),
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export class SyncError extends Error {
  constructor(
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}
export async function postTask(
  task: Task,
  cfg: Settings["googleSheets"],
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(cfg.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: JSON.stringify({
      protocolVersion: 1,
      targetId: task.targetId,
      sharedSecret: cfg.sharedSecret,
      requestId: task.requestId,
      recordId: task.recordId,
      revision: task.revision,
      payload: task.payload,
    }),
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
    credentials: "omit",
  });
  if (!response.ok)
    throw new SyncError(
      `同步 HTTP ${response.status}`,
      response.status === 429 || response.status >= 500,
    );
  if (
    response.url &&
    !["script.google.com", "script.googleusercontent.com"].includes(
      new URL(response.url).hostname,
    )
  )
    throw new SyncError("同步响应跳转到非预期地址，请检查部署权限", false);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new SyncError(
      "无法读取同步确认，请检查 GAS 正式部署和访问权限",
      false,
    );
  }
  if (typeof data === "object" && data && "ok" in data && data.ok === false) {
    const error = z
      .object({
        ok: z.literal(false),
        code: z.string(),
        retryable: z.boolean(),
      })
      .parse(data);
    throw new SyncError(`同步失败：${error.code}`, error.retryable);
  }
  const ack = AckSchema.parse(data);
  if (
    ack.targetId !== task.targetId ||
    ack.recordId !== task.recordId ||
    ack.requestId !== task.requestId ||
    ack.appliedRevision !== task.revision ||
    ack.payloadHash !== (await hash(task.payload))
  )
    throw new SyncError("远端版本或内容冲突，请检查目标工作表", false);
  return ack;
}
export function createSyncRunner(
  store: ReturnType<typeof createStore>,
  send = postTask,
) {
  let running = false;
  return async function run() {
    if (running) return;
    running = true;
    try {
      await store.mutate((s) => {
        const first = new Set<string>();
        for (const t of s.outbox) {
          if (first.has(t.recordId)) continue;
          first.add(t.recordId);
          if (t.attempts >= 5) {
            const r = s.records.find((x) => x.id === t.recordId);
            if (r && r.sync.status !== "failed")
              r.sync = {
                status: "failed",
                targetId: t.targetId,
                lastError: "上次同步未收到确认，请手动补推",
              };
          }
        }
      });
      for (let i = 0; i < 8; i++) {
        const entry = await store.mutate((s) => {
          if (!s.settings.googleSheets.enabled) return;
          // Only the oldest task per record may run. Failed older versions block successors.
          const first = new Set<string>();
          const task = s.outbox.find((t) => {
            if (first.has(t.recordId)) return false;
            first.add(t.recordId);
            return (
              t.targetId === s.settings.googleSheets.targetId &&
              t.attempts < 5 &&
              Date.parse(t.nextAttemptAt) <= Date.now()
            );
          });
          if (!task) return;
          task.attempts++;
          const r = s.records.find((x) => x.id === task.recordId);
          if (r) r.sync.status = "syncing";
          return {
            task: structuredClone(task),
            config: structuredClone(s.settings.googleSheets),
          };
        });
        if (!entry) break;
        const { task, config } = entry;
        try {
          const ack = await send(task, config);
          await store.mutate((s) => {
            if (canonical(s.settings.googleSheets) !== canonical(config))
              return;
            s.outbox = s.outbox.filter((t) => t.requestId !== task.requestId);
            const r = s.records.find((x) => x.id === task.recordId);
            if (
              r &&
              r.revision === ack.appliedRevision &&
              canonical(projectRow(s, r)) === canonical(task.payload)
            )
              r.sync = {
                status: "synced",
                targetId: task.targetId,
                syncedRevision: ack.appliedRevision,
                lastSyncedAt: now(),
              };
            else if (r) r.sync = { status: "pending", targetId: task.targetId };
          });
        } catch (error) {
          await store.mutate((s) => {
            if (canonical(s.settings.googleSheets) !== canonical(config))
              return;
            const t = s.outbox.find((x) => x.requestId === task.requestId);
            if (!t) return;
            const retryable =
              error instanceof SyncError
                ? error.retryable
                : error instanceof TypeError || error instanceof DOMException;
            if (!retryable) t.attempts = 5;
            t.nextAttemptAt = new Date(
              Date.now() +
                Math.min(3600000, 30000 * 2 ** t.attempts) +
                Math.random() * 5000,
            ).toISOString();
            const r = s.records.find((x) => x.id === task.recordId);
            if (r)
              r.sync = {
                status: t.attempts >= 5 ? "failed" : "pending",
                targetId: t.targetId,
                lastError:
                  error instanceof SyncError
                    ? error.message
                    : "网络异常或响应无效，可重试同步",
              };
          });
        }
      }
    } finally {
      running = false;
    }
  };
}
