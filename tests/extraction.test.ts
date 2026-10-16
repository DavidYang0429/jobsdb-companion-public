import { expect, it } from "vitest";
import { JSDOM } from "jsdom";
import { extractJob, jobIdFromUrl } from "../src/content/extract";
const dom = (id = "95315223", salary = false) =>
  new JSDOM(
    `<div data-automation="jobDetailsPage"><a data-automation="job-detail-apply" href="/job/${id}/apply">Apply</a><h1 data-automation="job-detail-title">Business Analyst - Data &amp; AI Governance (18-month contract)</h1><span data-automation="advertiser-name">Cathay Pacific Airways Ltd</span><span data-automation="job-detail-location">Tung Chung, Islands District</span><span data-automation="job-detail-work-type">Full time</span>${salary ? '<span data-automation="job-detail-salary">HK$30,000</span>' : ""}<div data-automation="jobAdDetails"><p>Reports to: Data &amp; AI Governance Manager</p><p>Minimum 3 years of proven experience in Data &amp; AI Governance</p></div></div>`,
  ).window.document;
it("extracts observed DOM shape on standalone and split routes without a JobPosting", () => {
  for (const url of [
    "https://hk.jobsdb.com/job/95315223",
    "https://hk.jobsdb.com/data-analyst-jobs?jobId=95315223",
  ]) {
    const j = extractJob(dom(), url, "95315223");
    expect(j.company).toBe("Cathay Pacific Airways Ltd");
    expect(j.salary).toBeNull();
    expect(j.jdParagraphs).toHaveLength(2);
  }
});
it("rejects mixed old details and new URL during SPA transitions", () => {
  expect(() =>
    extractJob(
      dom("94677046"),
      "https://hk.jobsdb.com/data-analyst-jobs?jobId=95315223",
      "95315223",
    ),
  ).toThrow("切换");
});
it("rejects non-JobsDB URLs and wrong expected identity", () => {
  expect(jobIdFromUrl("https://hk.jobsdb.com.evil/job/123")).toBeNull();
  expect(() =>
    extractJob(dom(), "https://hk.jobsdb.com/job/94677046", "95315223"),
  ).toThrow("变化");
});
it("does not fall back to arbitrary page headings or unrelated structured data", () => {
  const doc = new JSDOM(
    '<h1>Search results</h1><script type="application/ld+json">{"@type":"JobPosting","url":"https://hk.jobsdb.com/job/111"}</script>',
  ).window.document;
  expect(() =>
    extractJob(doc, "https://hk.jobsdb.com/job/95315223", "95315223"),
  ).toThrow("身份");
});
it("supports matching JSON-LD @graph and strips script content", () => {
  const p = {
    "@graph": [
      {
        "@type": "JobPosting",
        url: "https://hk.jobsdb.com/job/123",
        title: "Analyst",
        hiringOrganization: { name: "Acme" },
        description: "<p>SQL</p><script>evil()</script>",
      },
    ],
  };
  const doc = new JSDOM(
    `<script type="application/ld+json">${JSON.stringify(p).replaceAll("<", "\\u003c")}</script>`,
  ).window.document;
  expect(
    extractJob(doc, "https://hk.jobsdb.com/job/123", "123").jdRawText,
  ).toBe("SQL");
});
it("preserves text outside paragraphs without duplicating nested list content", () => {
  const doc = dom();
  doc.querySelector('[data-automation="jobAdDetails"]')!.innerHTML =
    "Requirements<div>SQL<br>Python</div><ul><li><p>Reporting</p></li></ul><script>do not capture</script>";
  const j = extractJob(doc, "https://hk.jobsdb.com/job/95315223", "95315223");
  expect(j.jdParagraphs).toEqual([
    "Requirements",
    "SQL",
    "Python",
    "Reporting",
  ]);
});
