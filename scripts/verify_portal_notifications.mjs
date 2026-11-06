// Real Frappe/CRM acceptance. Static-cache and network fault injection only;
// no API responses are mocked. Database fault uses one labeled QA notification.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const output = "test-results/portal-notifications",
  baseURL = "http://localhost:8000";
await mkdir(output, { recursive: true });
const credentials = JSON.parse(
  await readFile(".local/seminar-credentials.json", "utf8"),
);
const native = JSON.parse(
  await readFile("test-results/crm-native/report.json", "utf8"),
);
const outside = native.sessions.find(
  (row) => row.identity === "administrator",
).lead;
const report = {
  started_at: new Date().toISOString(),
  checks: [],
  screenshots: [],
  errors: [],
  expected_denials: [],
  failures: [],
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts = [];
let activeFaultId;
function bench(method, args = {}) {
  return JSON.parse(
    execFileSync(
      "docker",
      [
        "exec",
        "-w",
        "/home/frappe/frappe-bench",
        "crm-frappe-1",
        "bench",
        "--site",
        "crm.localhost",
        "execute",
        method,
        "--kwargs",
        JSON.stringify(args),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim(),
  );
}
async function context() {
  const ctx = await browser.newContext({
    baseURL,
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(ctx);
  await ctx.addInitScript(() => {
    if (location.hostname === "localhost")
      localStorage.setItem("crm_persona_captured", "1");
  });
  return ctx;
}
async function closeHelp(page) {
  const panel = page.locator(".fixed.z-50.right-0");
  if (await panel.isVisible()) {
    await panel.locator(":scope > div:first-child button").last().click();
    await panel.waitFor({ state: "hidden" });
  }
}
async function login(role, ui = true) {
  const ctx = await context(),
    page = await ctx.newPage(),
    entry = credentials[role];
  page.on("pageerror", (e) => report.errors.push({ role, error: e.message }));
  if (ui) {
    await page.goto(
      role === "customer"
        ? "/beautymatch/portal/"
        : "/login?redirect-to=/crm/beautymatch/requests",
    );
    if (role === "customer") {
      await page.locator('[name="usr"]').fill(entry.login);
      await page.locator('[name="pwd"]').fill(entry.password);
      await page
        .getByRole("button", { name: "Đăng nhập", exact: true })
        .click();
    } else {
      await page.locator("#login_email").fill(entry.login);
      await page.locator("#login_password").fill(entry.password);
      await page.locator(".btn-login").click();
    }
  } else {
    assert(
      (
        await ctx.request.post("/api/method/login", {
          form: { usr: entry.login, pwd: entry.password },
        })
      ).ok(),
    );
    await page.goto(
      role === "customer"
        ? "/beautymatch/portal/"
        : "/crm/beautymatch/requests",
    );
  }
  await page
    .locator(
      role === "customer" ? "#portal-form:not([hidden])" : ".bm-native-toolbar",
    )
    .waitFor();
  if (role !== "customer") {
    await page.waitForTimeout(400);
    await closeHelp(page);
  }
  return { ctx, page };
}
async function call(page, method, args = {}) {
  return page.evaluate(
    async ({ method, args }) => {
      const r = await fetch(`/api/method/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token":
            window.csrf_token ||
            document.querySelector('meta[name="csrf-token"]')?.content ||
            "",
        },
        body: JSON.stringify(args),
      });
      const b = await r.json();
      return { status: r.status, data: b.message, exc_type: b.exc_type };
    },
    { method, args },
  );
}
async function rpc(page, method, args = {}) {
  const r = await call(page, method, args);
  assert.equal(r.status, 200, `${method} ${r.exc_type || r.status}`);
  return r.data;
}
const portal = (page, operation, args) =>
  rpc(page, "beautymatch.api.portal." + operation, args);
const waitRpc = (page, method) =>
  page.waitForResponse((r) => r.url().endsWith("/api/method/" + method));
async function shot(page, name) {
  await closeHelp(page);
  await page.evaluate(() => document.fonts.ready);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `Overflow ${name}`,
  );
  const path = `${output}/${name}.png`;
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  report.screenshots.push(path);
}
async function submit(page, budget) {
  await page.locator('[name="max_budget"]').fill(String(budget));
  await page.locator('[name="consent"]').check();
  const response = waitRpc(page, "beautymatch.api.portal.submit_profile");
  await page
    .getByRole("button", { name: "Gửi yêu cầu tư vấn", exact: true })
    .click();
  const body = await (await response).json();
  assert(!body.exc_type);
  await page
    .locator("#portal-confirmation")
    .filter({ hasText: body.message.request_id.slice(0, 8) })
    .waitFor();
  return body.message;
}
try {
  const customer = await login("customer"),
    staff = await login("staff"),
    manager = await login("manager");
  report.checks.push(
    "khach/tuvan/quanly authenticate through the actual portal/Frappe login screens using short usernames; forms and native CRM render",
  );
  await staff.page.goto("/crm/leads/CRM-LEAD-2026-00038");
  await staff.page
    .getByRole("button", { name: "Tư vấn với BeautyMatch", exact: true })
    .waitFor();
  await staff.page.waitForFunction(() => {
    const el = document.querySelector(".bm-crm-insights");
    return (
      el &&
      !el.textContent.includes("Đang tải") &&
      !el.textContent.includes("Chưa tải")
    );
  });
  assert(
    !(await staff.page.locator("body").innerText()).includes("Error occurred"),
  );
  await shot(staff.page, "sales-user-lead-00038");
  const denied = await staff.ctx.newPage();
  denied.on("pageerror", (e) => report.expected_denials.push(e.message));
  await denied.goto(`/crm/leads/${outside}`);
  await denied
    .getByText("Not allowed via controller permission check", { exact: false })
    .first()
    .waitFor();
  await denied.close();
  report.checks.push(
    "Sales User Demo opens assigned Lead 00038 in the real CRM UI, including BeautyMatch actions; an Administrator-owned QA Lead remains denied",
  );
  await staff.page.goto("/crm/beautymatch/requests");
  await staff.page.locator(".bm-native-toolbar").waitFor();
  await closeHelp(staff.page);
  await staff.page.locator("#notifications-btn").click();
  const a = await submit(customer.page, 325000);
  report.request_a = a.request_id;
  const href = `/crm/beautymatch/request/${a.request_id}`;
  await staff.page.locator(`a[href="${href}"]`).waitFor({ timeout: 25000 });
  report.realtime_seen_without_reload = true;
  await shot(staff.page, "staff-new-request-notification");
  const notices = await rpc(
    staff.page,
    "crm.api.notifications.get_notifications",
  );
  const matches = notices.filter(
    (n) => n.notification_type_doc === a.request_id,
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].read, 0);
  assert.equal(matches[0].to_user, credentials.staff.username);
  assert(
    !(await rpc(manager.page, "crm.api.notifications.get_notifications")).some(
      (n) => n.notification_type_doc === a.request_id,
    ),
  );
  await staff.page.locator(`a[href="${href}"]`).click();
  await staff.page.locator(`[data-request-detail="${a.request_id}"]`).waitFor();
  await shot(staff.page, "notification-opens-exact-request");
  const read = await rpc(staff.page, "crm.api.notifications.get_notifications");
  assert.equal(
    read.find((n) => n.notification_type_doc === a.request_id).read,
    1,
  );
  await staff.page.reload();
  await staff.page.locator(`[data-request-detail="${a.request_id}"]`).waitFor();
  await staff.page
    .getByRole("button", { name: "Tiếp nhận tư vấn", exact: true })
    .click();
  await staff.page.waitForURL("**/crm/beautymatch/consultation");
  await staff.page
    .getByRole("heading", { name: "Hồ sơ khách đã gửi", exact: true })
    .waitFor();
  assert.equal(
    await staff.page.locator('input[name="consent"]').isChecked(),
    false,
  );
  await shot(staff.page, "accepted-request-snapshot");
  await staff.page.locator('input[name="consent"]').check();
  const gen = waitRpc(
    staff.page,
    "beautymatch.api.portal.generate_for_request",
  );
  await staff.page
    .getByRole("button", { name: "Xác nhận & tạo gợi ý", exact: true })
    .click();
  const generated = (await (await gen).json()).message;
  assert.equal(generated.result.results.length, 3);
  report.session = generated.result.session_id;
  const requestSnapshot = await portal(staff.page, "get_request", {
    request_id: a.request_id,
  });
  const replay = await portal(staff.page, "generate_for_request", {
    request_id: a.request_id,
    payload: {
      ...requestSnapshot.snapshot,
      request_id: generated.receipt.request_id,
    },
  });
  assert.equal(replay.result.session_id, generated.result.session_id);
  assert.equal(
    (
      await rpc(staff.page, "frappe.client.get_list", {
        doctype: "CRM Lead",
        filters: { email: credentials.customer.username },
        fields: ["name"],
      })
    ).length,
    1,
  );
  await staff.page.locator(".bm-native-product").first().waitFor();
  await staff.page
    .getByText("Đã xử lý yêu cầu · Backend xác nhận hoàn tất.", { exact: true })
    .waitFor();
  await shot(staff.page, "real-top3");
  const card = staff.page.locator(".bm-native-product").first(),
    feedback = waitRpc(staff.page, "beautymatch.api.feedback.submit_feedback");
  await card.getByRole("button", { name: "Quan tâm", exact: true }).click();
  const saved = (await (await feedback).json()).message;
  assert.equal(saved.follow_up_status, "CREATED");
  report.task = saved.follow_up_task;
  await card.locator(".bm-native-confirmation").waitFor();
  await card.getByRole("button", { name: /^Mở CRM Task/ }).click();
  const modal = staff.page.getByRole("dialog");
  await modal.waitFor();
  await modal.getByRole("button", { name: "Update", exact: true }).waitFor();
  const task = await rpc(staff.page, "frappe.client.get", {
    doctype: "CRM Task",
    name: saved.follow_up_task,
  });
  assert.equal(task.assigned_to, credentials.staff.username);
  assert.equal(task.beautymatch_session, generated.result.session_id);
  assert.equal(task.reference_docname, generated.receipt.crm_lead);
  assert.equal(task.beautymatch_item, generated.result.results[0].item_id);
  await shot(staff.page, "actual-linked-task");
  await modal.locator(".mb-5").first().getByRole("button").last().click();
  await modal.waitFor({ state: "hidden" });
  const repeated = await rpc(
    staff.page,
    "beautymatch.api.feedback.submit_feedback",
    {
      session_id: generated.result.session_id,
      item_id: generated.result.results[0].item_id,
      customer_feedback: "Interested",
    },
  );
  assert.equal(repeated.follow_up_task, saved.follow_up_task);
  await staff.page.goto("/crm/beautymatch/customer");
  await staff.page.locator(".bm-native-session").first().waitFor();
  await staff.page.getByLabel("Chỉ phiên có phản hồi", { exact: true }).check();
  await staff.page.locator(".bm-native-history-product").first().waitFor();
  await shot(staff.page, "history-with-feedback");
  await staff.page.goto("/crm/beautymatch/dashboard");
  await staff.page.locator('[data-metric="total_sessions"]').waitFor();
  await shot(staff.page, "real-dashboard");
  report.checks.push(
    "Live targeted CRM Notification appears without reload; native read state, exact request deep link/reload, accept, immutable snapshot, Top 3, real assigned Task, feedback history and dashboard work as Sales User Demo",
  );

  const b = await submit(customer.page, 325001);
  await portal(staff.page, "accept_request", { request_id: b.request_id });
  const c = await submit(customer.page, 325002);
  const old = await portal(staff.page, "get_request", {
    request_id: b.request_id,
  });
  assert.equal(old.status, "Superseded");
  assert.equal(old.superseded_by, c.request_id);
  const list = await rpc(staff.page, "crm.api.notifications.get_notifications");
  assert.equal(
    list.find((n) => n.notification_type_doc === b.request_id).read,
    1,
  );
  assert.equal(
    list.filter((n) => n.notification_type_doc === c.request_id).length,
    1,
  );
  const profile = await portal(customer.page, "get_my_profile");
  const retryPayload = {
    ...profile.profile,
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    consent: 1,
    request_id: c.request_id,
  };
  const repeats = await Promise.all([
    portal(customer.page, "submit_profile", { payload: retryPayload }),
    portal(customer.page, "submit_profile", { payload: retryPayload }),
  ]);
  assert(repeats.every((r) => r.request_id === c.request_id));
  assert.equal(
    (await rpc(staff.page, "crm.api.notifications.get_notifications")).filter(
      (n) => n.notification_type_doc === c.request_id,
    ).length,
    1,
  );
  report.checks.push(
    "Replacing an In Progress request marks it Superseded and its old bell entry read; parallel same-UUID retries preserve one request and one new notification",
  );

  const faultId = randomUUID();
  bench(
    "beautymatch.scripts.portal_notification_audit.prepare_delivery_failure",
    { request_id: faultId },
  );
  activeFaultId = faultId;
  const fault = await portal(customer.page, "submit_profile", {
    payload: { ...retryPayload, request_id: faultId, max_budget: 325003 },
  });
  assert.equal(fault.status, "Pending");
  const outbox = bench("frappe.db.get_value", {
    doctype: "BeautyMatch Customer Request",
    filters: faultId,
    fieldname: ["status", "notification_status"],
    as_dict: 1,
  });
  assert.equal(outbox.status, "Pending");
  assert.equal(outbox.notification_status, "Failed");
  assert.equal(
    (await rpc(staff.page, "crm.api.notifications.get_notifications")).find(
      (n) => n.notification_type_doc === c.request_id,
    ).read,
    1,
  );
  bench(
    "beautymatch.scripts.portal_notification_audit.clear_delivery_failure",
    { request_id: faultId },
  );
  activeFaultId = undefined;
  await staff.page.goto("/crm/beautymatch/requests");
  await staff.page.locator(`[data-request="${faultId}"]`).waitFor();
  await staff.page.locator("#notifications-btn").click();
  await staff.page
    .locator(`a[href="/crm/beautymatch/request/${faultId}"]`)
    .waitFor();
  assert.equal(
    (await rpc(staff.page, "crm.api.notifications.get_notifications")).filter(
      (n) => n.notification_type_doc === faultId,
    ).length,
    1,
  );
  report.checks.push(
    "Actual database notification identity failure leaves customer request committed/Pending; clearing only the owned QA fault and refreshing the real queue retries delivery exactly once",
  );

  const slow = await customer.ctx.newCDPSession(customer.page);
  await slow.send("Network.enable");
  await slow.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 15000,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await customer.page.locator("#portal-refresh").click();
  await customer.page
    .locator("#portal-status")
    .filter({ hasText: "phản hồi quá lâu" })
    .waitFor({ timeout: 16000 });
  await shot(customer.page, "portal-api-timeout");
  await slow.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  await customer.page.locator("#portal-retry").click();
  await customer.page
    .locator("#portal-status")
    .filter({ hasText: "Chọn nhu cầu hiện tại" })
    .waitFor();
  await slow.send("Network.setBlockedURLs", {
    urls: ["*beautymatch.api.portal.get_my_profile*"],
  });
  await customer.page.reload();
  await customer.page.locator("#portal-retry:not([hidden])").waitFor();
  assert.equal(await customer.page.locator("#portal-form").isVisible(), false);
  await slow.send("Network.setBlockedURLs", { urls: [] });
  await customer.page.locator("#portal-retry").click();
  await customer.page.locator("#portal-form:not([hidden])").waitFor();
  await slow.send("Network.setBlockedURLs", {
    urls: ["*beautymatch_portal.bundle*"],
  });
  await customer.page.reload();
  await customer.page
    .locator("#portal-asset-retry:not([hidden])")
    .waitFor({ timeout: 13000 });
  await shot(customer.page, "portal-bundle-error-recovery");
  await slow.send("Network.setBlockedURLs", { urls: [] });
  await customer.page.locator("#portal-asset-retry").click();
  await customer.page.locator("#portal-form:not([hidden])").waitFor();
  report.checks.push(
    "Actual delayed API, blocked profile API and blocked hashed bundle exit loading with Vietnamese errors and working retry controls; restored network loads the full form",
  );
  for (const width of [390, 320]) {
    await customer.page.setViewportSize({ width, height: 844 });
    await shot(customer.page, `portal-${width}`);
  }
  await staff.page.reload();
  await staff.page.locator(".bm-native-toolbar").waitFor();
  await closeHelp(staff.page);
  await staff.page.evaluate(async () => {
    await fetch("/api/method/logout", {
      method: "POST",
      headers: { "X-Frappe-CSRF-Token": window.csrf_token },
    });
  });
  assert(
    (
      await staff.ctx.request.post("/api/method/login", {
        form: {
          usr: credentials.manager.login,
          pwd: credentials.manager.password,
        },
      })
    ).ok(),
  );
  await staff.page.goto("/crm/beautymatch/customer");
  await staff.page
    .getByRole("heading", { name: "Chọn khách hàng để tiếp tục", exact: true })
    .waitFor();
  report.checks.push(
    "Portal is usable without horizontal overflow at 390/320; same-browser account switch clears the previous selected customer/session",
  );
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failures.push(e.stack);
  process.exitCode = 1;
} finally {
  if (activeFaultId) {
    try {
      bench(
        "beautymatch.scripts.portal_notification_audit.clear_delivery_failure",
        {
          request_id: activeFaultId,
        },
      );
    } catch (e) {
      report.failures.push(`QA fault cleanup: ${e.message}`);
    }
  }
  for (const ctx of contexts) await ctx.close().catch(() => {});
  await browser.close();
  report.finished_at = new Date().toISOString();
  report.passed = !report.failures.length && !report.errors.length;
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
