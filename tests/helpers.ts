import {
  initialState,
  now,
  type State,
  type Job,
  type Resume,
  defaultLayout,
  uid,
} from "../src/types/schema";
import { reduceCommand, createStore } from "../src/services/storage";
export const job = (id = "95315223"): Job => ({
  source: "jobsdb",
  sourceJobId: id,
  jobKey: `jobsdb:${id}`,
  title: "Data Analyst",
  company: "Example Company",
  location: "Hong Kong",
  salary: null,
  workType: "Full time",
  jobUrl: `https://hk.jobsdb.com/job/${id}`,
  jdRawText: "SQL and Python required. Fluent English.",
  jdParagraphs: ["SQL and Python required. Fluent English."],
  capturedAt: now(),
});
export function stateWithJob(sync = false) {
  let s = initialState();
  if (sync)
    s.settings.googleSheets = {
      enabled: true,
      targetId: "target",
      webhookUrl: "https://script.google.com/macros/s/test/exec",
      sharedSecret: "s".repeat(32),
    };
  s = reduceCommand(s, {
    type: "addJob",
    categoryId: s.categories[0].id,
    job: job(),
  }).state;
  return s;
}
export function memoryStore(initial?: State) {
  let saved = initial ? structuredClone(initial) : undefined;
  let fail = false;
  return {
    store: createStore({
      read: async () => saved,
      write: async (s) => {
        if (fail) throw Error("QUOTA_BYTES");
        saved = structuredClone(s);
      },
    }),
    get: () => structuredClone(saved),
    fail: () => {
      fail = true;
    },
  };
}
export function resumeFor(s: State): Resume {
  return {
    id: uid(),
    applicationId: s.records[0].id,
    jobSnapshot: structuredClone(s.records[0].job),
    masterResumeVersion: s.master.version,
    sourceProfile: structuredClone(s.master),
    renderedProfile: structuredClone(s.master),
    language: "en",
    layout: defaultLayout(),
    createdAt: now(),
    reviewedAt: now(),
  };
}
