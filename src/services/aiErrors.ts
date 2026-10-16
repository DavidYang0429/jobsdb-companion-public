export type AIRecoveryAction =
  "retry" | "profile" | "settings" | "manual" | "job";
export type AIErrorCode =
  | "profile-empty"
  | "summary-source-missing"
  | "summary-source-invalid"
  | "skills-invalid"
  | "experience-duplicate"
  | "experience-source-invalid"
  | "bullet-source-invalid"
  | "format"
  | "key"
  | "quota"
  | "timeout"
  | "cancelled"
  | "network"
  | "stale"
  | "job-evidence"
  | "incomplete"
  | "unexpected";
export interface AIRecovery {
  code: AIErrorCode;
  title: string;
  explanation: string;
  steps: string[];
  actions: AIRecoveryAction[];
}
const recoveries: Record<AIErrorCode, Omit<AIRecovery, "code">> = {
  "profile-empty": {
    title: "主简历还没有可用于定制的内容",
    explanation:
      "AI 需要依据你真实填写的资料改写；目前没有找到可用的总结、技能或经历等内容，尚未调用模型。",
    steps: [
      "点击“去完善主简历”，填写个人总结、技能、教育背景，或一段工作／项目经历。",
      "经历要点可以写“做了什么、使用什么工具、产生什么结果”，例如“使用 SQL 整理订单数据，制作每周销售报表”。没有真实数字就不填数字。",
      "点击“保存主简历”，再返回这个岗位生成。",
    ],
    actions: ["profile"],
  },
  "summary-source-missing": {
    title: "AI 生成的个人总结没有附上依据",
    explanation:
      "这是本次生成结果的问题，不代表你的简历填错了；这次结果没有保存。",
    steps: [
      "先点击“重新生成”。如果仍然失败，可选“手工制作简历”，直接使用已保存的主简历继续编辑。",
      "如果资料还比较简单，也可以在“主简历底座”补充真实职责或成果，保存后再试；不需要修改任何内部编号。",
    ],
    actions: ["retry", "manual", "profile"],
  },
  "summary-source-invalid": {
    title: "AI 的个人总结引用了无效依据",
    explanation: "模型没有正确对应你的原始资料，因此未采用本次结果。",
    steps: [
      "点击“重新生成”，让 AI 重新使用已保存的资料。",
      "反复失败时可手工制作简历；不需要自己寻找或修改来源编号。",
    ],
    actions: ["retry", "manual"],
  },
  "skills-invalid": {
    title: "AI 返回了新增或重复的技能",
    explanation: "AI 返回的技能列表与主简历不一致，本次结果没有采用。",
    steps: [
      "先点击“重新生成”，或选择“手工制作简历”只保留已有技能。",
      "如果确实具备该技能，在“主简历底座”的“技能（每行一项）”中补充并保存，再返回岗位生成；不要为了通过检查填写不会的技能。",
    ],
    actions: ["retry", "manual", "profile"],
  },
  "experience-duplicate": {
    title: "AI 重复选择了同一段经历",
    explanation: "这是生成结果重复，不需要你删除主简历里的真实经历。",
    steps: [
      "点击“重新生成”。",
      "仍然失败时选择“手工制作简历”，自行选择需要展示的经历。",
    ],
    actions: ["retry", "manual"],
  },
  "experience-source-invalid": {
    title: "AI 使用了主简历中不存在的经历",
    explanation: "本次生成结果没有通过原文核对，未保存。",
    steps: [
      "点击“重新生成”，不用修改经历编号。",
      "若想新增一段真实经历，先在“主简历底座”添加、保存，再返回岗位生成；也可以改用手工制作。",
    ],
    actions: ["retry", "manual", "profile"],
  },
  "bullet-source-invalid": {
    title: "AI 把经历要点对应到了错误的原文",
    explanation: "这属于模型生成错误，并不说明你填写的经历有问题。",
    steps: [
      "点击“重新生成”，不需要修改任何要点编号。",
      "反复失败时选择“手工制作简历”，对照原文编辑要点。",
    ],
    actions: ["retry", "manual"],
  },
  format: {
    title: "AI 返回的结果格式不完整",
    explanation: "本次结果未保存，这通常不需要修改你的简历。",
    steps: [
      "点击“重新生成”。",
      "若连续出现，进入“设置与备份”测试连接，或改选可用模型后再试；也可以手工制作简历。",
    ],
    actions: ["retry", "settings", "manual"],
  },
  key: {
    title: "当前模型的连接设置需要检查",
    explanation: "缺少有效的 API Key，或当前账号没有这个模型的访问权限。",
    steps: [
      "进入“设置与备份”，确认服务商、对应的 API Key 和模型名称。",
      "点击“测试当前连接”，看到成功及模型反馈后，再返回岗位生成。",
    ],
    actions: ["settings", "manual"],
  },
  quota: {
    title: "模型额度或请求频率受限",
    explanation: "本次未生成可保存的结果；反复立即点击通常不能解决。",
    steps: [
      "稍后再点击“重新生成”。",
      "也可在“设置与备份”检查账号额度、选择可用模型并测试连接，或先手工制作简历。",
    ],
    actions: ["settings", "retry", "manual"],
  },
  timeout: {
    title: "这次生成等待超时",
    explanation: "尚未获得完整结果，已保存的资料不会被覆盖。",
    steps: [
      "稍后点击“重新生成”。",
      "长篇资料可在主简历中精简重复内容并保存，或先手工制作简历。",
    ],
    actions: ["retry", "manual", "profile"],
  },
  cancelled: {
    title: "本次生成已取消",
    explanation: "没有保存生成结果。",
    steps: ["需要继续时点击“重新生成”，也可以手工制作简历。"],
    actions: ["retry", "manual"],
  },
  network: {
    title: "暂时无法连接模型服务",
    explanation: "请求未能完成，这通常与网络或服务暂时不可用有关。",
    steps: [
      "检查网络连接后点击“重新生成”。",
      "仍然失败时去“设置与备份”测试当前连接，或手工制作简历。",
    ],
    actions: ["retry", "settings", "manual"],
  },
  stale: {
    title: "生成期间，岗位或简历资料发生了变化",
    explanation: "为避免覆盖新内容，没有应用这次结果。",
    steps: ["确认已保存最新主简历和岗位信息，再点击“重新生成”。"],
    actions: ["retry", "profile", "manual"],
  },
  "job-evidence": {
    title: "AI 提取的岗位要求无法在原文中核对",
    explanation: "未保存这次岗位分析，不能把没有依据的要求当作事实。",
    steps: [
      "先检查当前岗位描述是否完整，缺失时点击“检查岗位描述”补全并保存。",
      "描述完整时直接重新生成分析。",
    ],
    actions: ["job", "retry"],
  },
  incomplete: {
    title: "AI 没有返回完整结果",
    explanation: "输出可能中途停止或被服务拒绝，本次结果未保存。",
    steps: [
      "先点击“重新生成”。",
      "仍然失败时在“设置与备份”检查模型是否可用，或手工制作简历。",
    ],
    actions: ["retry", "settings", "manual"],
  },
  unexpected: {
    title: "这次 AI 操作没有完成",
    explanation: "未能取得可用结果，已保存的资料不会因此改变。",
    steps: [
      "先点击“重新生成”；持续失败时去“设置与备份”测试模型连接。",
      "也可以先手工制作简历，继续准备当前岗位。",
    ],
    actions: ["retry", "settings", "manual"],
  },
};
export class AITaskError extends Error {
  readonly recovery: AIRecovery;
  constructor(code: AIErrorCode, detail?: string) {
    const recovery = { code, ...recoveries[code] };
    if (detail) recovery.explanation += " " + detail;
    super(
      `${recovery.title}。${recovery.explanation} ${recovery.steps.join(" ")}`,
    );
    this.name = "AITaskError";
    this.recovery = recovery;
  }
}
export function explainAIError(error: unknown): AITaskError {
  if (error instanceof AITaskError) return error;
  if (error instanceof Error) {
    if (error.name === "TimeoutError") return new AITaskError("timeout");
    if (error.name === "AbortError") return new AITaskError("cancelled");
    const message = error.message;
    if (/API Key|鉴权失败/.test(message)) return new AITaskError("key");
    if (/额度|速率/.test(message)) return new AITaskError("quota");
    if (/JSON|结构不完整/.test(message)) return new AITaskError("format");
    if (
      /岗位、主简历或模型设置已变化|主简历已更新|记录已在其他页面更新/.test(
        message,
      )
    )
      return new AITaskError("stale");
    if (/岗位要求缺少原文依据|引用不在当前 JD/.test(message))
      return new AITaskError("job-evidence");
    if (/未完整返回|截断|拒绝/.test(message))
      return new AITaskError("incomplete");
    if (
      error instanceof TypeError ||
      /Failed to fetch|NetworkError|网络/.test(message)
    )
      return new AITaskError("network");
  }
  return new AITaskError("unexpected");
}
export const aiActionLabels: Record<AIRecoveryAction, string> = {
  retry: "重新生成",
  profile: "去完善主简历",
  settings: "检查模型设置",
  manual: "手工制作简历",
  job: "检查岗位描述",
};
