import test from "node:test";
import assert from "node:assert/strict";
import { latestRequest } from "../../frontend/crm/latest-request.mjs";
import {
  createAccountContext,
  currentAccount,
} from "../../beautymatch/public/js/account-context.mjs";
import {
  fieldErrors,
  emptyForm,
} from "../../beautymatch/public/js/intake-domain.mjs";

function storage() {
  const value = {};
  Object.defineProperties(value, {
    getItem: { value: (key) => value[key] ?? null },
    setItem: {
      value: (key, entry) => {
        value[key] = String(entry);
      },
    },
    removeItem: {
      value: (key) => {
        delete value[key];
      },
    },
  });
  return value;
}
test("latest query wins when responses resolve out of order, including stale errors", async () => {
  const next = latestRequest();
  let displayed = null,
    error = "";
  const resolvers = [];
  async function load() {
    const current = next();
    displayed = null;
    error = "";
    try {
      const reply = await new Promise((resolve, reject) =>
        resolvers.push({ resolve, reject }),
      );
      if (current()) displayed = reply;
    } catch (e) {
      if (current()) error = e.message;
    }
  }
  const a = load(),
    b = load();
  resolvers[1].resolve("Completed");
  await b;
  resolvers[0].reject(new Error("old Pending failed"));
  await a;
  assert.equal(displayed, "Completed");
  assert.equal(error, "");
  const c = load();
  assert.equal(displayed, null);
  resolvers[2].reject(new Error("network"));
  await c;
  assert.equal(displayed, null);
  assert.equal(error, "network");
});
test("same account reload restores context; account switch, logout and unowned legacy keys cannot inherit it", () => {
  const data = storage();
  let user = "staff-A";
  data.setItem(
    "beautymatch_customer_v1",
    JSON.stringify({ crm_lead: "old-unowned" }),
  );
  const context = createAccountContext(data, () => user);
  assert.equal(context.read("lead"), null);
  context.write("lead", "Lead-A");
  context.write("opened", { session_id: "Session-A" });
  assert.equal(createAccountContext(data, () => user).read("lead"), "Lead-A");
  user = "staff-B";
  assert.equal(context.read("lead"), null);
  assert.equal(context.read("opened"), null);
  context.write("lead", "Lead-B");
  user = "";
  assert.equal(context.read("lead"), null);
  user = "staff-A";
  assert.equal(context.read("lead"), null);
});
test("account cookie decoding fails closed; inline validation points to first invalid field", () => {
  assert.equal(currentAccount("user_id=Guest"), "");
  assert.equal(currentAccount("user_id=bad%xx"), "");
  assert.equal(
    currentAccount("sid=x; user_id=sales%40example.invalid"),
    "sales@example.invalid",
  );
  const errors = fieldErrors(emptyForm());
  assert.equal(Object.keys(errors)[0], "full_name");
  assert(errors.consent && errors.max_budget && errors.concern_oil_control);
});
