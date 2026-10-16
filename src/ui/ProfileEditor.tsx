import { useState } from "react";
import { uid, type Profile, type Experience } from "../types/schema";
import { SectionTabs } from "./SectionTabs";
export const profileSections = [
  { id: "basic", label: "基本资料" },
  { id: "summary", label: "总结技能" },
  { id: "experiences", label: "工作经历" },
  { id: "projects", label: "项目经历" },
  { id: "education", label: "教育背景" },
] as const;
export type ProfileSection = (typeof profileSections)[number]["id"];
export function ProfileFields({
  value,
  onChange,
  section,
}: {
  value: Profile;
  onChange: (p: Profile) => void;
  section?: ProfileSection;
}) {
  const [localSection, setLocalSection] = useState<ProfileSection>("basic");
  const active = section ?? localSection;
  const prefix = section ? "master-profile" : "resume-fields";
  const panel = (id: ProfileSection) => ({
    role: "tabpanel",
    id: `${prefix}-panel-${id}`,
    "aria-labelledby": `${prefix}-tab-${id}`,
    hidden: active !== id,
  });
  const field = (key: keyof Profile, label: string, multiline = false) => (
    <label key={key}>
      {label}
      {multiline ? (
        <textarea
          value={String(value[key])}
          rows={4}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        />
      ) : (
        <input
          value={String(value[key])}
          onChange={(e) => onChange({ ...value, [key]: e.target.value })}
        />
      )}
    </label>
  );
  function experienceGroup(key: "experiences" | "projects", label: string) {
    const update = (index: number, patch: Partial<Experience>) =>
      onChange({
        ...value,
        [key]: value[key].map((e, i) => (i === index ? { ...e, ...patch } : e)),
      });
    return (
      <section className="form-section">
        <div className="section-heading">
          <h3>{label}</h3>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                [key]: [
                  ...value[key],
                  {
                    id: uid(),
                    companyOrOrg: "",
                    role: "",
                    location: "",
                    period: "",
                    bullets: [],
                  },
                ],
              })
            }
          >
            ＋ 添加{label}
          </button>
        </div>
        {value[key].map((e, i) => (
          <fieldset key={e.id}>
            <legend>
              {label} {i + 1}
            </legend>
            <div className="form-grid">
              {(["companyOrOrg", "role", "location", "period"] as const).map(
                (k, j) => (
                  <label key={k}>
                    {["公司／机构", "职位／项目角色", "地点", "起止时间"][j]}
                    <input
                      value={e[k]}
                      onChange={(ev) => update(i, { [k]: ev.target.value })}
                    />
                  </label>
                ),
              )}
            </div>
            <p className="help">
              每条要点保留独立来源。添加空白条目后，可保持空白并在简历预览中隐藏。
            </p>
            {e.bullets.map((b, bi) => (
              <label key={b.id}>
                经历要点 {bi + 1}
                <textarea
                  rows={2}
                  value={b.text}
                  onChange={(ev) =>
                    update(i, {
                      bullets: e.bullets.map((x, xi) =>
                        xi === bi ? { ...x, text: ev.target.value } : x,
                      ),
                    })
                  }
                />
              </label>
            ))}
            <button
              type="button"
              onClick={() =>
                update(i, { bullets: [...e.bullets, { id: uid(), text: "" }] })
              }
            >
              ＋ 添加要点
            </button>
          </fieldset>
        ))}
      </section>
    );
  }
  return (
    <>
      {!section && (
        <SectionTabs
          id="resume-fields"
          label="简历内容分区"
          value={active}
          options={profileSections}
          onChange={setLocalSection}
        />
      )}
      <div {...panel("basic")}>
        <div className="form-grid">
          {field("fullName", "姓名")}
          {field("email", "邮箱")}
          {field("phone", "电话")}
          {field("location", "所在地")}
          {field("linkedinOrPortfolio", "LinkedIn／作品集")}
          {field("visaStatus", "签证状态")}
        </div>
      </div>
      <div {...panel("summary")}>
        {field("defaultSummary", "个人总结", true)}
        <div className="form-grid">
          <label>
            技能（每行一项）
            <textarea
              rows={4}
              value={value.skills.join("\n")}
              onChange={(e) =>
                onChange({ ...value, skills: e.target.value.split("\n") })
              }
            />
          </label>
          <label>
            语言（每行一项）
            <textarea
              rows={4}
              value={value.languages.join("\n")}
              onChange={(e) =>
                onChange({ ...value, languages: e.target.value.split("\n") })
              }
            />
          </label>
        </div>
      </div>
      <div {...panel("experiences")}>
        {experienceGroup("experiences", "工作经历")}
      </div>
      <div {...panel("projects")}>
        {experienceGroup("projects", "项目经历")}
      </div>
      <section className="form-section" {...panel("education")}>
        <div className="section-heading">
          <h3>教育背景</h3>
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                education: [
                  ...value.education,
                  {
                    id: uid(),
                    school: "",
                    degree: "",
                    period: "",
                    details: "",
                  },
                ],
              })
            }
          >
            ＋ 添加教育
          </button>
        </div>
        {value.education.map((ed, i) => (
          <fieldset key={ed.id}>
            <legend>教育 {i + 1}</legend>
            <div className="form-grid">
              {(["school", "degree", "period", "details"] as const).map(
                (k, j) => (
                  <label key={k}>
                    {["学校", "学位／专业", "起止时间", "补充说明"][j]}
                    <input
                      value={ed[k]}
                      onChange={(e) =>
                        onChange({
                          ...value,
                          education: value.education.map((x, xi) =>
                            xi === i ? { ...x, [k]: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                ),
              )}
            </div>
          </fieldset>
        ))}
      </section>
    </>
  );
}
export function ProfileEditor({
  initial,
  onSave,
  busy,
  onDraftChange,
  section,
}: {
  section?: ProfileSection;
  onDraftChange?: (profile: Profile) => void;
  initial: Profile;
  onSave: (profile: Profile, expectedVersion: number) => Promise<Profile>;
  busy: boolean;
}) {
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [base, setBase] = useState(initial.version);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const saved = await onSave(draft, base);
          setDraft(structuredClone(saved));
          setBase(saved.version);
        } catch {
          /* Parent retains visible error and draft. */
        }
      }}
    >
      <ProfileFields
        section={section}
        value={draft}
        onChange={(profile) => {
          setDraft(profile);
          onDraftChange?.(profile);
        }}
      />
      <div className="sticky-actions">
        <span className="help">基于主简历 v{base} · 只保存你确认过的事实</span>
        <button className="primary" disabled={busy} type="submit">
          保存主简历
        </button>
      </div>
    </form>
  );
}
