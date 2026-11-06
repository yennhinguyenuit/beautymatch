import test from "node:test";
import assert from "node:assert/strict";
import { feedbackMessage } from "../../beautymatch/public/js/api.mjs";
import { careCall } from "../../frontend/crm/care-api.mjs";

test("preference confirmation must not promise contact work before explicit consent", () => {
  const state = feedbackMessage({
    customer_feedback: "Interested",
    follow_up_status: "NOT_REQUESTED",
    follow_up_task: null,
  });
  assert.equal(state.kind, "success");
  assert.match(state.text, /bước riêng/);
  assert.doesNotMatch(state.title, /CREATED|PENDING/);
});

test("care response from an earlier account is rejected before exposing its data", async () => {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    fetch: globalThis.fetch,
  };
  let release, posted;
  try {
    globalThis.document = { cookie: "user_id=staff%40example.invalid" };
    globalThis.window = { csrf_token: "test-csrf" };
    globalThis.fetch = (_, options) => {
      posted = options;
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const pending = careCall("get_contact", { request_id: "opaque" });
    globalThis.document.cookie = "user_id=other%40example.invalid";
    release({
      ok: true,
      json: async () => ({ message: { customer_note: "previous account" } }),
    });
    await assert.rejects(pending, /Tài khoản đã thay đổi/);
    assert.equal(posted.method, "POST");
    assert.equal(posted.headers["X-Frappe-CSRF-Token"], "test-csrf");
    assert.equal(JSON.parse(posted.body).request_id, "opaque");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
