# [AI读]代码现状快照：JobsDB 求职助手

> 更新日期：2026-10-16。用户已明确授权开始实现；当前为首版本地实现，外部联调尚未完成。

## 一、当前事实

- 精确工作目录：`/path/to/jobsdb-companion`。初始只有三份方案文档，现已创建业务工程；用户已授权本阶段提交并上传至公开 GitHub 仓库 `DavidYang0429/jobsdb-companion-public`，使用 `main` 分支，构建 ZIP 作为阶段预发布附件。历史验证记录中“未提交”描述的是当时状态；尚未部署生产服务或发布到 Chrome 网上应用店。
- Node.js 24.11.1，React + TypeScript + Vite，Manifest V3，最低 Chrome 120。
- 全屏和侧栏共享 src/ui 界面。网页预览使用独立 localStorage 数据，生产扩展通过 Service Worker 统一写 chrome.storage.local；不能把网页预览当作实际扩展环境。
- 用户要求后续页面查看使用 Codex 内置浏览器；不要另开外部浏览器。

## 二、主要代码入口

| 路径 | 职责 |
| --- | --- |
| src/manifest.ts | 权限、侧栏、后台、内容脚本与 CSP |
| src/types/schema.ts | Zod 数据契约和默认数据 |
| src/services/storage.ts | 串行写入、并发版本、分类去重、快照、备份恢复 |
| src/background/serviceWorker.ts | 受信消息边界、采集转发、后台恢复与定时同步 |
| src/content/extract.ts | 详情 DOM／JSON-LD 身份核对与纯文本提取 |
| src/content/jobsdbExtractor.ts | 页面采集消息与快捷按钮 |
| src/services/llmAdapter.ts | Gemini／DeepSeek 请求、来源校验、改写装配与导入 |
| src/services/googleSheetsSync.ts | 不可变同步任务、确认、重试、目标切换 |
| src/ui/App.tsx | 岗位表、分类、状态、岗位修正、采集与 AI 操作 |
| src/ui/ProfileEditor.tsx | 主简历与人工编辑 |
| src/ui/ResumeWorkspace.tsx | 原文对照、完整快照、历史另存、显示与分页、打印 |
| src/ui/SettingsPanel.tsx | Key、GAS 配置与完整备份恢复 |
| gas/Code.gs | 需用户自行部署的鉴权／幂等写表脚本 |
| scripts/build.mjs、check-build.mjs | 生产打包、图标生成和入口校验 |

## 三、真实站点观察与未验证假设

内置浏览器已核对五个公开独立详情页。详情容器为 `[data-automation="jobDetailsPage"]`；标题、公司、地点、工作类型、JD 使用方案中的 data-automation 字段；容器内 `a[data-automation="job-detail-apply"]` 的岗位 ID 与当前 URL 一致才可提取。薪资缺失保持 null，不把登录后薪资匹配入口当成薪资。

首个样本的 JSON-LD 只有 WebSite，无 JobPosting。因此不能依赖岗位级结构化数据必然存在。本次搜索卡片进入独立详情，jobId 分栏参数会被移除，真实分栏模式未完成验收；构造样本通过不等于真实模式通过。

公开岗位 ID、字段长度和 DOM 摘录见 [验证记录](../../docs/verification/2026-10-16.md)，不要将历史选择器当作永远稳定。

## 四、必须保持的契约

- 本地为准，Sheets 只接收职位跟踪字段。确认必须可读且匹配目标、任务、记录、版本和哈希；不能用 no-cors 或 HTTP 200 代替成功确认。
- 分类 ID、岗位 ID 与投递记录 ID 分开，同分类去重、跨分类独立；投递进度不受简历生成影响。
- 模型输出只作建议。固定事实从来源装配，来源 ID 必须存在；可疑数字阻止一键确认，人工核对不能被 JSON 校验替代。
- 定制简历完整保存原始和最终数据及模板／字体／排版版本；更新主简历不能修改旧简历，历史编辑另存新版本。
- Key 不暴露给 Content Script，不进入备份、职位表或日志。恢复仅向空数据集写入，不自动清空或合并。
- 用户已接受本人真实简历调用 Gemini 免费 API 的风险，保留此路线，不强制改为付费、不反复确认。这不等于供应商条款豁免或其他用户同意。
- 本期仍不做跨站批量海投、自建账号后端、Sheets 双向同步、静默保存 PDF 和 AI 自动新增事实。

## 五、验证与下一步

构建及自动化测试已通过；内置浏览器完成手动录入、虚构主简历、独立版本保存、面试状态、刷新持久化、完整备份与空集恢复、390 像素侧栏检查。具体数量与边界见验证记录及本轮终端输出。

待验证：真实 Chrome 扩展加载与采集闭环、真实分栏页面、两个模型的实际账号、GAS 测试部署。PDF 直接下载已补充实际文件验收，原生打印跨环境仍需自行确认。未使用用户 Key，未写真实 Google 表格，未发布生产。

开发命令与安装方式见 [README](../../README.md)。主线为完成这些真实验收，不要重复实现已完成的本地模块，也不要把模拟器结果提升为外部服务通过证明。


## 六、用户测试后的修复（2026-10-16）

- src/services/resumePdf.ts 新增本地直接下载，保留打印入口。已检查三语言单／双页 PDF，内置浏览器实际下载可验证；不再以 window.print 代替下载功能。
- PDF 字体资源 public/fonts/pdf-v1，layout.pdfExportVersion 可选字段兼容旧数据，新保存标记 pdf-v1。完整嵌入字体避免子集化造成“文本可复制但显示缺字”。
- testConnection 保留服务商、请求模型与响应中的模型元数据，SettingsPanel 展示具体结果，接口缺失模型标识时明确提示；没有使用用户真实 Key 做请求。
- 更新验证记录见 docs/verification/2026-10-16-fixes.md。旧记录中的 PDF 待验证是本次修复前状态。


## 七、AI 错误引导补充（2026-10-16）

新增 src/services/aiErrors.ts 和 src/ui/AIRecoveryPanel.tsx。AI 定制失败在岗位内展示原因、具体步骤和恢复按钮；区分用户资料不足与模型错误。总结事实目录已纳入个人总结、技能、语言和签证等已有内容；仍严格拒绝无依据引用，不自动编造来源，不自动重试。

原文对照展示用户能读懂的实际资料；数字错误定位到具体经历／要点与数字。验证记录为 docs/verification/2026-10-16-ai-recovery.md；模型请求采用模拟响应，没有读取或使用用户 Key。


## 八、侧栏布局修复（2026-10-16）

panel-mode 内容最大 520px；职位表在侧栏显示为卡片。简历工作室保留该模式，通过 compact 控制编辑／预览切换，ResponsiveResumePreview 负责显示缩放和占位高度。切换保留草稿，打印明确取消缩放；直接 PDF 生成器不变，全屏布局不受内容上限约束。

已在内置浏览器检查 320px、390px、900px 侧栏及 1440px 全屏。真实 Chrome 宿主仍需重载插件后查看；详见 docs/verification/2026-10-16-panel-layout.md。


## 上传已有简历与完整使用说明（2026-10-16）

- 主简历新增 PDF／DOCX／TXT 文件入口，单文件 10 MB、PDF 最多 20 页、文字最多 50,000 字符。提取在本地完成，无需 Key；不做扫描图片 OCR、旧版 DOC 解析或复刻原文件版式。
- AI 自动填表沿用当前 Gemini／DeepSeek 配置，需要对应 API Key。只有主动点击识别才发送可见原文；原文件不上传。先展示可编辑草稿，逐项确认并保存才更新整份主简历，不自动合并；可返回识别前的手工表单，历史简历不变。
- 文件读取错误、超限、扫描 PDF 和密码文件给出具体改法；读取失败保留已有原文。离开页面会取消进行中的任务，旧响应不应用，主简历版本或模型配置改变时拒绝填入。
- 实现入口：src/services/resumeFile.ts、resumePdfReader.ts、src/ui/ResumeImportPanel.tsx。PDF.js 同源模块 Worker、CMaps、标准字体和许可证离线打包；DOCX 只读正文及页眉页脚 XML，限制解压量、不读取外部关系。App 保留原文及手工草稿，保存沿用版本冲突保护。
- 导航新增“使用说明”（src/ui/UsageGuide.tsx），覆盖加载更新、入门流程、Key 要求、导入、采集、岗位管理、审核下载、模型排错、GAS、备份与预览边界。侧栏导航为两行。
- 自动化共 83 项通过；实际内置浏览器已读取虚构 PDF、DOCX、TXT，扫描 PDF 出现可操作提示。真实 Chrome 扩展内文件 Worker 和真实模型端到端识别仍待验证，未使用用户 Key。

详细验证见 docs/verification/2026-10-16-resume-import.md。后续不重复实现已完成入口；无 OCR、不自动保存／合并、不上传原文件是当前边界。


## 投递表状态与时间补充（2026-10-16）

- 用户要求补充加入、投递、面试时间，以及已投递、等面试、已失败、无回应等状态。加入时间沿用 createdAt，只读；appliedAt、interviewAt 为可选 UTC ISO 时间（null 表示清空），界面按本机时区填写与显示到分钟。旧记录不推断或自动补日期，切换状态也不自动填时间。
- 状态为 saved／applied／waiting_interview／interviewing／offer／rejected／no_response，界面分别是待投递、已投递、等面试、面试中、已拿 Offer、已失败、无回应。rejected 仅改显示名称，兼容旧记录。筛选、列表及 CSV 同步更新。
- 点击岗位，在“投递与面试时间”编辑并保存；保留乐观并发版本校验。保存失败保留输入，记录版本变化后阻止旧草稿覆盖。主简历／历史简历逻辑不变。
- RecordSchema、PayloadSchema 和 CommandSchema 增加可选时间字段，projectRow 只在字段存在时加入，避免改变旧同步任务 payload 哈希。JSON 备份恢复自动保留新字段，无字段的旧数据依然可用。
- GAS 保持协议 v1 并兼容旧 payload；尾部追加 appliedAt、interviewAt。只对精确旧表头且目标列完全空白的表扩展，已有自定义列内容时返回 HEADER_MISMATCH，不覆盖。已部署用户需更新并重新发布脚本。
- 本期只保存一个面试时间，不新增多轮面试历史、提醒或自动认定无回应。92 项测试、生产构建及内置浏览器 320px 布局检查通过；未更新真实表格或部署扩展。详细证据见 docs/verification/2026-10-16-tracking-times.md。


## 保存版本错配与时间选填（2026-10-16）

用户反馈保存简历时出现 layout.pdfExportVersion 的 unrecognized_keys。当前源码和生成的后台都已包含该可选字段，因此旧插件后台／页面混用是疑似原因，未声称已复现用户 Chrome 的真实运行版本。新增 src/services/runtimeContract.ts：界面在写操作前向后台检查契约，后台也在命令解析前校验；不同版本拒绝写入并提示保留草稿、在扩展管理页重新加载、关闭旧侧栏／工作台后重开。旧校验错误也转换为相同步骤。不丢弃 pdfExportVersion，不放宽结构校验，不自动重载或卸载。

投递时间和面试时间均明确标注“选填”，可全部为空、只填一项或清空后保存，不影响保存简历与状态修改。数据仍是可选／nullable，无自动填充。

99 项测试通过，包含真实打包后台消息入口保存 pdfExportVersion、时间留空、持久化回读，以及新旧后台契约拒绝与原有 92 项。生产构建通过。未重载用户真实扩展，需在真实 Chrome 中重新加载产物后验收。


## 功能分区与标签页整理（2026-10-16）

用户要求整合整个插件，按功能分区并拆开过长页面。保留四个主入口，调整为：

| 主入口 | 功能分区 |
| --- | --- |
| 职位投递表 | 列表与岗位详情分开；详情包含跟进记录、制作简历、岗位资料、历史版本，可返回列表 |
| 主简历底座 | 基本资料、总结技能、工作经历、项目经历、教育背景、上传导入 |
| 设置与备份 | 模型连接、表格同步、数据备份；备份页不出现无关保存设置按钮 |
| 使用说明 | 快速开始、主简历、岗位与简历、模型设置、表格同步、备份恢复 |

SectionTabs 提供带 tablist／tab／tabpanel 关联的切换，支持左右方向键、Home、End。非活动区域用 hidden 隐藏并保留已挂载编辑器。主页面、岗位标签、返回列表及进入／退出简历工作室保留当前会话中的未保存内容；刷新／关闭页面不提供草稿持久化保证。导入区离开时仍取消文件／模型任务，原文缓存保留在 App，不应用过期识别响应。

主简历和简历工作室共享字段分组；保存仍一次提交整份简历，不按标签单独落库。设置草稿不再因页面切换丢失，保存使用最新工作台版本，同时比较已保存配置基线；其他窗口修改配置后阻止覆盖并提供重新载入操作。侧栏主导航固定顶部，压缩标题和统计区，保持最大 520px 与窄屏卡片，桌面保留表格和双栏简历预览。

实现涉及 src/ui/App.tsx、SectionTabs.tsx、ProfileEditor.tsx、SettingsPanel.tsx、UsageGuide.tsx、style.css；没有改数据结构、同步协议、模型接口或存储位置。本期不增加新业务模块、自动投递或云端草稿。

自动化为 16 个文件、103 项通过；新增分区显示、跨标签编辑保留、主页面／简历工作室往返、设置草稿保存、键盘和面板关联检查。真实 Chrome 插件仍需重新加载构建产物验收。详见 docs/verification/2026-10-16-workspace-sections.md。


## 投递表可选 Excel／CSV 导出（2026-10-16）

用户要求优先 Excel 并允许选择。导出格式下拉默认 xlsx，可选 csv；仍只导出当前筛选的 records，九列字段不变。src/services/trackerExport.ts 用已有 fflate 本地生成 OOXML，按需加载，不新增依赖或外部请求；client.download 增加 ArrayBuffer 支持。Excel 含冻结表头、筛选、列宽和时间格式，业务文字为 inlineStr，未填写时间不生成日期值；日期使用本机时区墙上时间。CSV 保持原有 BOM、引号换行、公式保护。单元格超过 32,767 字符时提示改用 CSV，不静默截断。原字段、同步协议与备份结构不变，Excel／CSV 不能替代 JSON 备份。

新增 6 项测试，共 109 项通过；覆盖真实 ZIP／XML 结构、中文和特殊字符、无公式、日期和空值、空集、长文本、默认格式及筛选范围。生产构建和内置浏览器 XLSX 下载通过，独立 openpyxl 读取验证通过；真实 Excel／WPS 桌面应用未测试。详见 docs/verification/2026-10-16-excel-export.md。
