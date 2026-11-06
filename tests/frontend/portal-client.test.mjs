import test from "node:test";
import assert from "node:assert/strict";
import {
  createPortalClient,
  validatePortalProfile,
} from "../../beautymatch/public/js/portal-client.mjs";

test("portal timeout covers slow response and exposes a Vietnamese retry error", async () => {
  const call = createPortalClient({
    timeout: 10,
    fetcher: async (_, { signal }) =>
      new Promise((_, reject) =>
        signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        ),
      ),
  });
  await assert.rejects(
    call("beautymatch.api.portal.get_my_profile"),
    /phản hồi quá lâu/,
  );
});
test("portal profile rejects malformed response before any DOM hydration", () => {
  for (const invalid of [
    null,
    {},
    {
      full_name: "A",
      email: "a@example.invalid",
      profile: {},
      requests: [null],
    },
    { full_name: "A", email: "a@example.invalid", profile: [], requests: [] },
  ])
    assert.throws(() => validatePortalProfile(invalid), /Phản hồi hồ sơ/);
  const valid = {
    full_name: "A",
    email: "a@example.invalid",
    profile: {},
    requests: [],
  };
  assert.equal(validatePortalProfile(valid), valid);
});
test("portal client sends CSRF and original payload; rejects permission errors without false success", async () => {
  let posted;
  const call = createPortalClient({
    csrf: () => "csrf",
    fetcher: async (_, options) => {
      posted = options;
      return {
        ok: false,
        status: 403,
        json: async () => ({ exc_type: "PermissionError" }),
      };
    },
  });
  await assert.rejects(
    call("submit_profile", { payload: { request_id: "preserved" } }),
    /đăng nhập tài khoản khách hàng/,
  );
  assert.equal(JSON.parse(posted.body).payload.request_id, "preserved");
  assert.equal(posted.headers["X-Frappe-CSRF-Token"], "csrf");
});
