import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError,
  createLiveApi,
  readConsultation,
  feedbackMessage,
} from "../../beautymatch/public/js/api.mjs";
import { safeUrl, escape } from "../../beautymatch/public/js/components.mjs";

const pending = {
  crm_lead: "PRIVATE-LEAD",
  beauty_profile: "PRIVATE-PROFILE",
  request_id: "0d853655-8f72-4ee7-a476-7ae238be46db",
  profile_version: "2026-11-05 10:00:00.123456",
};
const response = (message) => ({
  ok: true,
  status: 200,
  json: async () => ({ message }),
});

test("generation shares in-flight work and retries with the original identifiers", async () => {
  const calls = [];
  let resolve;
  const api = createLiveApi({
    fetcher: (url, options) => {
      calls.push({ url, options });
      return new Promise((done) => {
        resolve = done;
      });
    },
    csrf: "token",
  });
  const first = api.generate(pending);
  const duplicate = api.generate(pending);
  assert.equal(first, duplicate);
  assert.equal(calls.length, 1);
  resolve(response({ recommendation_session: "SESSION" }));
  await first;
  const retry = api.generate(pending);
  resolve(response({ recommendation_session: "SESSION" }));
  await retry;
  assert.deepEqual(
    calls.map((c) => JSON.parse(c.options.body).request_id),
    [pending.request_id, pending.request_id],
  );
  assert.equal(calls[0].options.headers["X-Frappe-CSRF-Token"], "token");
});
test("sensitive reads use POST bridge bodies with no identifiers in URLs", async () => {
  const calls = [];
  const api = createLiveApi({
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return response({ sessions: [] });
    },
  });
  await api.history(pending.crm_lead);
  await api.result("PRIVATE-SESSION");
  await api.context("PRIVATE-SESSION");
  for (const call of calls) {
    assert.equal(call.options.method, "POST");
    assert.equal(call.url, "/api/method/beautymatch.api.frontend.read");
    assert(!call.url.includes("PRIVATE"));
  }
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    operation: "get_customer_history",
    parameters: { crm_lead: "PRIVATE-LEAD", start: 0, limit: 20 },
  });
});
test("dashboard sends only date filters; feedback preserves exact existing payload", async () => {
  const calls = [];
  const api = createLiveApi({
    fetcher: async (url, options) => {
      calls.push({ url, options });
      return response({ status: "ok" });
    },
  });
  await api.dashboard({ start_date: "2026-11-01", end_date: "2026-11-05" });
  const payload = {
    recommendation_session: "S",
    recommendation_item: "I",
    feedback: "Not Interested",
  };
  await api.feedback(payload);
  assert.match(calls[0].url, /start_date=2026-11-01/);
  assert.equal(calls[0].options.method, "GET");
  assert.deepEqual(JSON.parse(calls[1].options.body), payload);
});
test("failed feedback never returns a success; auth and malformed data are handled", async () => {
  const api = createLiveApi({
    fetcher: async () => ({
      ok: false,
      status: 403,
      json: async () => ({ exc: "private traceback" }),
    }),
  });
  await assert.rejects(
    api.feedback({}),
    (error) =>
      error instanceof ApiError &&
      error.status === 403 &&
      !error.message.includes("traceback"),
  );
  const invalid = createLiveApi({ fetcher: async () => response(undefined) });
  await assert.rejects(invalid.generate(pending), /thiếu dữ liệu/);
});
test("timeouts release the in-flight slot so manual retry works", async () => {
  let count = 0;
  const api = createLiveApi({
    timeout: 5,
    fetcher: async (url, { signal }) => {
      count++;
      if (count > 1) return response({ ok: true });
      return new Promise((resolve, reject) =>
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error(), { name: "AbortError" })),
        ),
      );
    },
  });
  await assert.rejects(api.generate(pending), /quá thời gian/);
  assert.deepEqual(await api.generate(pending), { ok: true });
});
test("consultation handoff rejects invalid data and never creates a new request ID", () => {
  assert.deepEqual(
    readConsultation({
      getItem: () => JSON.stringify({ ...pending, email: "must-not-pass" }),
    }),
    pending,
  );
  assert.equal(readConsultation({ getItem: () => null }), null);
  assert.throws(() => readConsultation({ getItem: () => "{" }), ApiError);
  assert.throws(
    () =>
      readConsultation({
        getItem: () => JSON.stringify({ ...pending, profile_version: null }),
      }),
    ApiError,
  );
});
test("feedback presentation honors exact CREATED, PENDING and current backend task contract", () => {
  assert.equal(
    feedbackMessage({ customer_feedback: "Interested", status: "CREATED" })
      .kind,
    "success",
  );
  assert.equal(
    feedbackMessage({ customer_feedback: "Interested", status: "PENDING" })
      .kind,
    "pending",
  );
  assert.match(
    feedbackMessage({
      customer_feedback: "Interested",
      status: "Follow-up Created",
      follow_up_task: "TASK",
    }).title,
    /Follow-up Created/,
  );
  assert.equal(
    feedbackMessage({
      customer_feedback: "Interested",
      status: "Feedback Received",
    }).kind,
    "pending",
  );
  assert.throws(() => feedbackMessage({ status: "CREATED" }), ApiError);
});
test("dynamic product content rejects executable URLs and escapes markup", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:image/svg+xml,evil",
    "//evil.test",
    "/\\evil.test",
    "https://user:pass@example.com",
  ])
    assert.equal(safeUrl(url), "");
  assert.equal(safeUrl("/files/photo.png"), "/files/photo.png");
  assert.equal(safeUrl("https://example.com/p"), "https://example.com/p");
  assert.equal(
    escape('<img onerror="x">'),
    "&lt;img onerror=&quot;x&quot;&gt;",
  );
});
