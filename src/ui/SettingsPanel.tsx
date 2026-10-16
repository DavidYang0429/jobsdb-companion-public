import { SectionTabs } from "./SectionTabs";
import { canonical } from "../services/canonical";
import { useState } from "react";
import { uid, type Settings, type State } from "../types/schema";
import { command, download, isPreview } from "../services/client";
import { parseBackup, exportBackup } from "../services/storage";
import {
  testConnection,
  connectionMessage,
  providerLabel,
  type ModelConnection,
} from "../services/llmAdapter";
export function SettingsPanel({
  state,
  onChanged,
  report,
}: {
  state: State;
  onChanged: () => Promise<void>;
  report: (s: string) => void;
}) {
  const [settings, setSettings] = useState(() =>
      structuredClone(state.settings),
    ),
    [baseline, setBaseline] = useState(() => canonical(state.settings)),
    [tab, setTab] = useState<"model" | "sync" | "backup">("model"),
    [busy, setBusy] = useState(false),
    [backup, setBackup] = useState<ReturnType<typeof parseBackup>>(),
    [gas, setGas] = useState(""),
    [connection, setConnection] = useState<{
      identity: ModelConnection;
      error?: string;
    }>();
  const conflict = canonical(state.settings) !== baseline;
  async function save() {
    setBusy(true);
    try {
      if (conflict)
        throw Error("设置已在其他窗口更新，请先载入已保存设置，再重新编辑。");
      const result = await command({
        type: "settings",
        settings,
        expectedRevision: state.revision,
      });
      setBaseline(canonical(result.state.settings));
      await onChanged();
      report("设置已保存");
    } catch (e) {
      report(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }
  const provider = settings.activeProvider,
    cfg = settings[provider];
  return (
    <div className="settings-workspace">
      <SectionTabs
        id="settings"
        label="设置功能"
        value={tab}
        onChange={setTab}
        options={[
          { id: "model", label: "模型连接" },
          { id: "sync", label: "表格同步" },
          { id: "backup", label: "数据备份" },
        ]}
      />
      {conflict && (
        <div className="notice">
          <p>已保存设置发生变化。请先载入最新设置，再编辑并保存。</p>
          <button
            onClick={() => {
              setSettings(structuredClone(state.settings));
              setBaseline(canonical(state.settings));
              setConnection(undefined);
            }}
          >
            载入已保存设置
          </button>
        </div>
      )}
      <div>
        <section
          className="card"
          role="tabpanel"
          id="settings-panel-model"
          aria-labelledby="settings-tab-model"
          hidden={tab !== "model"}
        >
          <span className="eyebrow">AI PROVIDERS</span>
          <h2>模型连接</h2>
          <p className="help">
            使用你自己的 API Key。只有主动解析或生成时才调用模型。
          </p>
          <label>
            当前服务
            <select
              disabled={busy}
              value={provider}
              onChange={(e) => {
                setConnection(undefined);
                setSettings({
                  ...settings,
                  activeProvider: e.target.value as Settings["activeProvider"],
                });
              }}
            >
              <option value="gemini">Google Gemini</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </label>
          <label>
            API Key
            <input
              type="password"
              autoComplete="off"
              disabled={busy}
              value={cfg.apiKey}
              onChange={(e) => {
                setConnection(undefined);
                setSettings({
                  ...settings,
                  [provider]: { ...cfg, apiKey: e.target.value },
                });
              }}
            />
          </label>
          <label>
            模型名称
            <input
              disabled={busy}
              value={cfg.model}
              onChange={(e) => {
                setConnection(undefined);
                setSettings({
                  ...settings,
                  [provider]: { ...cfg, model: e.target.value },
                });
              }}
            />
          </label>
          <p className="help">
            Gemini 免费 API 路线按已确认决定保留。实际额度与模型权限以账号为准。
          </p>
          <button
            disabled={busy || isPreview}
            onClick={async () => {
              setBusy(true);
              setConnection(undefined);
              const tested = structuredClone(settings);
              const context: ModelConnection = {
                provider: tested.activeProvider,
                requestedModel: tested[tested.activeProvider].model,
              };
              try {
                const identity = await testConnection(
                  tested,
                  new AbortController().signal,
                );
                setConnection({ identity });
                report(connectionMessage(identity));
              } catch (e) {
                const error = e instanceof Error ? e.message : "连接失败";
                setConnection({ identity: context, error });
                report(
                  `连接失败 · ${providerLabel(context.provider)} · 请求模型：${context.requestedModel} · ${error}`,
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "正在测试…" : "测试当前连接"}
          </button>
          {connection && (
            <div
              className={connection.error ? "error" : "notice"}
              role={connection.error ? "alert" : "status"}
            >
              <strong>{connection.error ? "连接失败" : "连接成功"}</strong>
              <p>服务商：{providerLabel(connection.identity.provider)}</p>
              <p>请求模型：{connection.identity.requestedModel}</p>
              {!connection.error && (
                <p>
                  服务端返回模型：
                  {connection.identity.responseModel ?? "接口未提供模型标识"}
                </p>
              )}
              {connection.error && <p>{connection.error}</p>}
            </div>
          )}
        </section>
        <section
          className="card"
          role="tabpanel"
          id="settings-panel-backup"
          aria-labelledby="settings-tab-backup"
          hidden={tab !== "backup"}
        >
          <span className="eyebrow">LOCAL DATA</span>
          <h2>备份与恢复</h2>
          <p className="help">
            完整 JSON 包含主简历和所有历史版本，不含 API Key
            和同步密钥。卸载扩展会清除本地数据。
          </p>
          <button
            onClick={() =>
              download(
                `JobsDB_Backup_${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(exportBackup(state), null, 2),
              )
            }
          >
            导出完整备份
          </button>
          <label>
            恢复 JSON（仅支持空工作台）
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  if (f.size > 10 * 1024 * 1024)
                    throw Error("备份超过本地容量限制");
                  setBackup(parseBackup(JSON.parse(await f.text())));
                } catch (error) {
                  report(
                    error instanceof Error ? error.message : "备份读取失败",
                  );
                  setBackup(undefined);
                }
              }}
            />
          </label>
          {backup && (
            <div className="notice">
              <p>
                备份预览：{backup.categories.length} 个分类、
                {backup.records.length} 个岗位、{backup.resumes.length}{" "}
                份简历；主简历 v{backup.master.version}。
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await command({ type: "restore", backup });
                    await onChanged();
                    setBackup(undefined);
                    report("恢复成功，请重新配置外部服务");
                  } catch (e) {
                    report(e instanceof Error ? e.message : "恢复失败");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                确认恢复到空工作台
              </button>
            </div>
          )}
        </section>
      </div>
      <section
        className="card"
        role="tabpanel"
        id="settings-panel-sync"
        aria-labelledby="settings-tab-sync"
        hidden={tab !== "sync"}
      >
        <span className="eyebrow">GOOGLE SHEETS</span>
        <h2>可选的单向同步</h2>
        <p className="help">
          本地为准，同步到同一工作表的分类列。Sheets
          人工编辑不会回写，后续推送可能覆盖插件管理列。
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.googleSheets.enabled}
            onChange={(e) =>
              setSettings({
                ...settings,
                googleSheets: {
                  ...settings.googleSheets,
                  enabled: e.target.checked,
                },
              })
            }
          />
          启用同步
        </label>
        <label>
          GAS Web App URL
          <input
            placeholder="https://script.google.com/macros/s/…/exec"
            value={settings.googleSheets.webhookUrl}
            onChange={(e) =>
              setSettings({
                ...settings,
                googleSheets: {
                  ...settings.googleSheets,
                  webhookUrl: e.target.value,
                },
              })
            }
          />
        </label>
        <label>
          目标 ID
          <input
            value={settings.googleSheets.targetId}
            onChange={(e) =>
              setSettings({
                ...settings,
                googleSheets: {
                  ...settings.googleSheets,
                  targetId: e.target.value,
                },
              })
            }
          />
        </label>
        <label>
          共享密钥
          <input
            type="password"
            autoComplete="off"
            value={settings.googleSheets.sharedSecret}
            onChange={(e) =>
              setSettings({
                ...settings,
                googleSheets: {
                  ...settings.googleSheets,
                  sharedSecret: e.target.value,
                },
              })
            }
          />
        </label>
        <button
          onClick={() =>
            setSettings({
              ...settings,
              googleSheets: {
                ...settings.googleSheets,
                targetId: uid(),
                sharedSecret: uid() + uid(),
              },
            })
          }
        >
          生成新目标 ID 与密钥
        </button>
        <ol className="instructions">
          <li>在目标 Google Sheets 中打开“扩展程序 → Apps Script”。</li>
          <li>复制下方完整脚本，粘贴到脚本编辑器。</li>
          <li>
            在“项目设置 → 脚本属性”填写 SPREADSHEET_ID、SHEET_NAME（如
            JobsDB）、TARGET_ID 和 SHARED_SECRET。后两项与此处保持一致。
          </li>
          <li>
            部署为 Web App，以自己身份执行，设置允许本扩展请求的访问范围并完成
            Google 授权。使用正式 /exec 地址；组织策略可能限制匿名访问。
          </li>
          <li>
            保存设置后，本地岗位进入同步队列。更换工作表或部署目标时使用新的目标
            ID；修改脚本后部署新版本。
          </li>
        </ol>
        <div className="actions">
          <button
            onClick={async () => {
              try {
                const content =
                  gas ||
                  (await (
                    await fetch(
                      isPreview
                        ? "/gas/Code.gs"
                        : chrome.runtime.getURL("gas/Code.gs"),
                    )
                  ).text());
                setGas(content);
                await navigator.clipboard.writeText(content);
                report("GAS 脚本已复制");
              } catch {
                report("复制失败，请从安装包 gas/Code.gs 打开脚本");
              }
            }}
          >
            复制 GAS 脚本
          </button>
          <button
            onClick={async () => {
              try {
                const result = await command({ type: "retry" });
                await onChanged();
                report("已重新排队未同步记录");
              } catch (e) {
                report(e instanceof Error ? e.message : "补推失败");
              }
            }}
          >
            补推未同步岗位
          </button>
        </div>
        {gas && (
          <details>
            <summary>查看脚本</summary>
            <pre>{gas}</pre>
          </details>
        )}
        <p className="help">
          关闭面板不影响已持久化队列；网络异常最多自动尝试 5
          次。鉴权或配置错误需要修正后手动补推。
        </p>
      </section>
      <div className="sticky-actions" hidden={tab === "backup"}>
        <span className="help">保存模型与同步配置；密钥仅保存在本地。</span>
        <button className="primary" disabled={busy} onClick={() => void save()}>
          保存设置
        </button>
      </div>
    </div>
  );
}
