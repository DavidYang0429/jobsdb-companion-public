import { JobSchema, type Job } from "../types/schema";
export function jobIdFromUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.origin !== "https://hk.jobsdb.com") return null;
    return (
      u.pathname.match(/^\/job\/(\d+)(?:\/|$)/)?.[1] ??
      (/^\d+$/.test(u.searchParams.get("jobId") ?? "")
        ? u.searchParams.get("jobId")
        : null)
    );
  } catch {
    return null;
  }
}
function flatten(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flatten);
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return [v, ...(Array.isArray(v["@graph"]) ? flatten(v["@graph"]) : [])];
  }
  return [];
}
function clean(node: Element | null): string {
  return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}
function segments(element: Element | null): string[] {
  if (!element) return [];
  const box = element.cloneNode(true) as Element;
  box.querySelectorAll("script,style").forEach((n) => n.remove());
  box.querySelectorAll("br").forEach((n) => n.replaceWith("\n"));
  box.querySelectorAll("p,li,div,h1,h2,h3,h4,ul,ol").forEach((n) => {
    n.prepend("\n");
    n.append("\n");
  });
  return (box.textContent ?? "")
    .split(/\n+/)
    .map((t) => t.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}
function plain(doc: Document, html: string): string {
  const box = doc.createElement("div");
  box.innerHTML = html;
  return segments(box).join("\n");
}
export function extractJob(
  doc: Document,
  url: string,
  expectedId: string,
): Job {
  if (jobIdFromUrl(url) !== expectedId)
    throw Error("页面岗位已变化，请重新提取");
  const roots = Array.from(
    doc.querySelectorAll('[data-automation="jobDetailsPage"]'),
  );
  const validRoots = roots.filter((root) => {
    const applyLinks = Array.from(
      root.querySelectorAll('a[data-automation="job-detail-apply"]'),
    );
    const ids = applyLinks.map((a) =>
      jobIdFromUrl(new URL(a.getAttribute("href") ?? "", url).href),
    );
    return ids.length > 0 && ids.every((id) => id === expectedId);
  });
  if (validRoots.length === 1) {
    const root = validRoots[0],
      get = (name: string) =>
        clean(root.querySelector(`[data-automation="${name}"]`));
    const paragraphs = segments(
      root.querySelector('[data-automation="jobAdDetails"]'),
    );
    const raw = paragraphs.join("\n");
    return JobSchema.parse({
      source: "jobsdb",
      sourceJobId: expectedId,
      jobKey: `jobsdb:${expectedId}`,
      title: get("job-detail-title"),
      company: get("advertiser-name"),
      location: get("job-detail-location") || null,
      salary: get("job-detail-salary") || null,
      workType: get("job-detail-work-type") || null,
      jobUrl: `https://hk.jobsdb.com/job/${expectedId}`,
      jdRawText: raw,
      jdParagraphs: paragraphs.length ? paragraphs : [raw],
      capturedAt: new Date().toISOString(),
    });
  }
  // If a live detail container exists but belongs to another ID, fail closed during SPA transitions.
  if (roots.length)
    throw Error("详情仍在切换或岗位身份缺失，请等待加载后重新提取");
  const postings = Array.from(
    doc.querySelectorAll('script[type="application/ld+json"]'),
  )
    .flatMap((n) => {
      try {
        return flatten(JSON.parse(n.textContent ?? ""));
      } catch {
        return [];
      }
    })
    .filter(
      (p) =>
        p["@type"] === "JobPosting" ||
        (Array.isArray(p["@type"]) && p["@type"].includes("JobPosting")),
    );
  const matching = postings.filter((p) => {
    const identifier = p.identifier as { value?: unknown } | undefined;
    return (
      (typeof p.url === "string" && jobIdFromUrl(p.url) === expectedId) ||
      (identifier && String(identifier.value) === expectedId)
    );
  });
  if (matching.length !== 1)
    throw Error("当前详情身份尚未确认，请等待页面加载或手动录入");
  const p = matching[0];
  // Prefer one internally consistent JobPosting over mixing old DOM with a new URL.
  const org = p.hiringOrganization as { name?: string } | undefined;
  const locations = Array.isArray(p.jobLocation)
    ? p.jobLocation
    : [p.jobLocation];
  const location = locations
    .map((l) => {
      const a = (
        l as
          | { address?: { addressLocality?: string; addressRegion?: string } }
          | undefined
      )?.address;
      return a?.addressLocality || a?.addressRegion || "";
    })
    .filter(Boolean)
    .join(", ");
  const salary = p.baseSalary as
    | {
        currency?: string;
        value?: {
          minValue?: number;
          maxValue?: number;
          value?: number;
          unitText?: string;
        };
      }
    | undefined;
  const value = salary?.value;
  const salaryText = value
    ? [
        salary?.currency,
        value.minValue ?? value.value,
        value.maxValue ? `– ${value.maxValue}` : "",
        value.unitText,
      ]
        .filter((x) => x !== undefined && x !== "")
        .join(" ")
    : null;
  const jd = typeof p.description === "string" ? plain(doc, p.description) : "";
  const result = JobSchema.parse({
    source: "jobsdb",
    sourceJobId: expectedId,
    jobKey: `jobsdb:${expectedId}`,
    title: typeof p.title === "string" ? p.title : "",
    company: org?.name ?? "",
    location: location || null,
    salary: salaryText,
    workType:
      typeof p.employmentType === "string"
        ? p.employmentType
        : Array.isArray(p.employmentType)
          ? p.employmentType.join(", ")
          : null,
    jobUrl: `https://hk.jobsdb.com/job/${expectedId}`,
    jdRawText: jd,
    jdParagraphs: [],
    capturedAt: new Date().toISOString(),
  });
  const box = doc.createElement("div");
  box.innerHTML = String(p.description);
  result.jdParagraphs = segments(box);
  if (!result.jdParagraphs.length) result.jdParagraphs = [result.jdRawText];
  // Visible details must agree with the structured title if present.
  const visibleTitle = clean(
    doc.querySelector('[data-automation="job-detail-title"]'),
  );
  if (visibleTitle && visibleTitle !== result.title)
    throw Error("详情仍在切换，请稍后重新提取");
  return result;
}
