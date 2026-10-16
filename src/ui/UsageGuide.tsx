import { useState } from "react";
import { SectionTabs } from "./SectionTabs";
type Destination = "jobs" | "profile" | "settings";
export function UsageGuide({
  onNavigate,
}: {
  onNavigate: (destination: Destination) => void;
}) {
  const [tab, setTab] = useState("start");
  return (
    <article className="usage-guide" aria-label="插件使用说明">
      <SectionTabs
        id="guide"
        label="说明主题"
        value={tab}
        onChange={setTab}
        options={[
          { id: "start", label: "快速开始" },
          { id: "profile", label: "主简历" },
          { id: "jobs", label: "岗位与简历" },
          { id: "model", label: "模型设置" },
          { id: "sync", label: "表格同步" },
          { id: "backup", label: "备份恢复" },
        ]}
      />

      <div
        role="tabpanel"
        id="guide-panel-start"
        aria-labelledby="guide-tab-start"
        hidden={tab !== "start"}
      >
        <section className="card">
          <span className="eyebrow">QUICK START</span>
          <h2>先完成这四步</h2>
          <ol>
            <li>
              <strong>准备主简历。</strong>手工填写，或上传
              PDF／DOCX／TXT，检查原文后用 AI
              识别。核对姓名、联系方式、日期和经历，勾选确认并保存。
            </li>
            <li>
              <strong>收藏岗位。</strong>在 JobsDB
              打开具体职位，用插件侧栏“提取当前岗位”，核对后选择投递表保存；也可以手动录入链接与
              JD。
            </li>
            <li>
              <strong>制作简历。</strong>
              打开已保存岗位的“制作简历”标签，选择手工制作或 AI
              定制，编辑内容、对照原文，确认事实后保存一个独立版本。
            </li>
            <li>
              <strong>下载和跟进。</strong>点“下载
              PDF”，完成实际投递后手动更新状态和备注。插件不会替你自动提交申请。
            </li>
          </ol>
          <div className="actions">
            <button className="primary" onClick={() => onNavigate("profile")}>
              准备主简历
            </button>
            <button onClick={() => onNavigate("jobs")}>查看岗位</button>
            <button onClick={() => onNavigate("settings")}>配置服务</button>
          </div>
        </section>
        <section className="card">
          <h2>首次加载和更新插件</h2>
          <ol>
            <li>
              在支持扩展的 Chrome 中打开 <code>chrome://extensions</code>
              ，开启开发者模式，选择“加载已解压的扩展程序”，选中构建后的{" "}
              <code>dist</code> 文件夹。
            </li>
            <li>
              将插件图标固定到工具栏，点击图标打开侧栏；侧栏里的“打开全屏工作台”适合维护完整资料。
            </li>
            <li>
              首次加载或更新后，刷新已经打开的 JobsDB
              页面。更新时在扩展管理页点击“重新加载”，不需要卸载；卸载会清除本地数据。
            </li>
          </ol>
        </section>
        <section className="card">
          <h2>网页预览和真正的插件有什么不同？</h2>
          <p>
            当前本地网页可检查界面、读取简历文件和测试本地流程，数据与扩展独立。采集、AI
            调用和后台同步需要在支持扩展的 Chrome 中加载
            dist。修改构建后，在扩展管理页重新加载插件，再刷新 JobsDB 页面。
          </p>
          <p>
            侧栏内容最多
            520px；复杂操作可使用“打开全屏工作台”。不会替你自动海投、自动判断签证资格或承诺所有
            ATS 都能完全一致地解析 PDF。
          </p>
        </section>
      </div>
      <div
        role="tabpanel"
        id="guide-panel-profile"
        aria-labelledby="guide-tab-profile"
        hidden={tab !== "profile"}
      >
        <section className="card">
          <h2>上传或维护主简历</h2>
          <ol>
            <li>
              进入“主简历底座 → 上传导入”，选择 PDF、Word（.docx）或
              TXT，文件最大 10 MB，PDF 最多 20 页。旧版 .doc 请先另存为 .docx。
            </li>
            <li>
              系统在本地提取文字。先检查下方原文；多栏简历的文字顺序可能需要调整，也可以直接粘贴正文。
            </li>
            <li>
              在“设置与备份 → 模型连接”填好对应的 API Key
              和模型，测试连接成功并保存设置，再回来点击“AI
              识别并填入表单”。原始文件不会发送给模型，发送的是可见原文。
            </li>
            <li>
              AI
              结果会填进待确认表单。逐项检查并修改；需要时点“返回原表单”恢复识别前的编辑。勾选确认并点“保存主简历”才会更新已保存资料。
            </li>
          </ol>
          <p>
            保存识别草稿会以当前表单更新整份主简历，不会自动合并旧字段；历史岗位简历仍保留自己的快照。
          </p>
          <p className="help">
            扫描／图片 PDF、受密码保护或损坏的文件可能无法提取。可改用文字版
            PDF、DOCX 或直接粘贴；当前没有图片
            OCR。没有真实数字或资质就留空，不需要为了识别补造经历。
          </p>
        </section>
      </div>
      <div
        role="tabpanel"
        id="guide-panel-jobs"
        aria-labelledby="guide-tab-jobs"
        hidden={tab !== "jobs"}
      >
        <section className="card">
          <h2>采集岗位和投递表</h2>
          <p>
            首次加载扩展后，刷新已打开的 JobsDB
            页面。进入具体岗位，打开侧栏后提取；页面仍在切换时等待加载完成。采集失败可用“手动录入”填写岗位链接、职位、公司与
            JD。
          </p>
          <p>
            同一投递表重复录入会定位已有岗位，不覆盖备注；同一岗位可放进不同表分别跟踪。可以新增／改名分类、搜索岗位、修改进度和备注；“编辑岗位信息”可修正
            JD，但不能把已有记录换成另一个职位。
          </p>
          <p>
            在投递表的“导出格式”选择 Excel（.xlsx，默认）或
            CSV，再点击“导出投递表”。只导出当前分类、状态和搜索条件筛选出的岗位，包含加入、投递和面试时间。Excel
            保留中文和换行，提供表头冻结与筛选；时间按本机时区显示，未填写的时间留空。Excel／CSV
            不包含完整简历，不能替代 JSON 备份。
          </p>
          <p>
            待投递、已投递、等面试、面试中、已拿
            Offer、已失败、无回应由你维护。生成简历不会把面试进度改回待投递。加入时间是归档时间；点击岗位后可在“跟进记录
            →
            投递与面试时间”填写或修改实际投递时间、最近一次或下一次面试时间，并点击“保存时间”。时间按本机时区显示，不随状态切换自动填写，也不会推断旧记录日期；清空后保存即可移除填写的时间。
          </p>
        </section>
        <section className="card">
          <h2>定制、审核和下载简历</h2>
          <p>
            先保存主简历，再从岗位选择“手工制作简历”或“AI 定制简历”。AI
            可选择英文、繁中、简中并填写定制侧重。手工切换语言只改变模板语言，不会自动翻译正文。
          </p>
          <p>
            在“编辑”修改内容，在“原文对照”核查真实资料，在“显示与分页”隐藏条目、调整同组顺序或添加分页。AI
            提示缺少依据时可重试或手工制作；数字提示会指出需要修正的位置。
          </p>
          <p>
            确认事实后保存独立版本，“下载
            PDF”才可用；“打印…”是另一个系统打印入口。侧栏可切换编辑与预览，预览按宽度缩小，下载仍是
            A4。中文文件完整嵌入字体，通常会较大。
          </p>
          <p>
            历史版本打开后可以下载，修改会另存新版本。修改主简历不会自动改变历史简历。
          </p>
        </section>
      </div>
      <div
        role="tabpanel"
        id="guide-panel-model"
        aria-labelledby="guide-tab-model"
        hidden={tab !== "model"}
      >
        <section className="card">
          <h2>哪些功能需要 API Key？</h2>
          <dl className="guide-facts">
            <div>
              <dt>不需要模型 Key</dt>
              <dd>
                读取文件文字、手工填写主简历、JobsDB
                采集、岗位管理、手工制作及下载 PDF、完整备份和恢复。
              </dd>
            </div>
            <div>
              <dt>需要模型 Key</dt>
              <dd>
                AI 识别文件／粘贴简历并自动填表、AI 岗位分析、AI
                定制简历。使用当前设置中的 Gemini 或 DeepSeek。
              </dd>
            </div>
            <div>
              <dt>Google Sheets 同步</dt>
              <dd>
                不需要模型 Key，但要单独部署自己的 GAS 脚本，配置目标
                ID、共享密钥和正式 Web App 地址。
              </dd>
            </div>
          </dl>
          <p className="help">
            插件不内置通用 Key，也不会自动切换模型。只有你主动点击相关 AI
            功能才会发送内容。测试连接会消耗少量模型额度。
          </p>
        </section>
        <section className="card">
          <h2>配置模型和排查连接</h2>
          <p>
            在“设置与备份 → 模型连接”选服务商，填写它对应的 API Key
            和可访问的模型名称，点击“测试当前连接”。成功结果包含服务商、请求模型和接口返回的模型；接口未返回标识时会明确说明。确认后点“保存设置”。
          </p>
          <p>
            鉴权失败检查
            Key、服务商和模型权限；额度或频率受限时稍后再试；网络异常先测试连接。插件不会自动重试收费请求，AI
            返回的内容仍需你核对。
          </p>
        </section>
      </div>
      <div
        role="tabpanel"
        id="guide-panel-sync"
        aria-labelledby="guide-tab-sync"
        hidden={tab !== "sync"}
      >
        <section className="card">
          <h2>Google Sheets 可选同步</h2>
          <ol>
            <li>
              在自己的测试表中打开“扩展程序 → Apps
              Script”，复制插件设置页提供的完整 GAS 脚本。
            </li>
            <li>
              在脚本属性中设置 SPREADSHEET_ID、SHEET_NAME、TARGET_ID 和
              SHARED_SECRET；后两项与插件配置一致。
            </li>
            <li>
              部署为 Web App，以自己身份执行并完成授权，使用正式 /exec
              地址。组织策略可能限制这种部署方式。
            </li>
            <li>
              启用并保存设置。岗位记录会排队同步，失败时检查原因并用“补推未同步岗位”。修改脚本后要部署新版本。
            </li>
          </ol>
          <p>
            本地为准，远端仅为职位镜像。Sheets
            人工修改不回写，插件管理列可能被后续推送覆盖；切换目标需新的目标
            ID。同步不发送主简历正文或模型 Key。
          </p>
        </section>
      </div>
      <div
        role="tabpanel"
        id="guide-panel-backup"
        aria-labelledby="guide-tab-backup"
        hidden={tab !== "backup"}
      >
        <section className="card">
          <h2>备份、恢复和数据位置</h2>
          <p>
            完整 JSON 包含分类、岗位、主简历和历史简历，不含 API Key、Webhook
            或共享密钥；Excel／CSV
            只导出职位表。恢复时先检查预览，仅支持向空数据集恢复，不会清空或自动合并现有资料。
          </p>
          <p>
            卸载扩展会清除本地数据，更新／卸载前请自己保存完整备份。Sheets
            职位镜像不能代替完整备份；恢复后需重新配置模型和同步服务。
          </p>
        </section>
      </div>
    </article>
  );
}
