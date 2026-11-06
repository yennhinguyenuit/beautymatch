// End-to-end seminar acceptance on the real local site. No intercepted APIs.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const baseURL = "http://localhost:8000";
const output = "test-results/seminar";
await mkdir(output, { recursive: true });
const credentials = JSON.parse(
  await readFile(".local/seminar-credentials.json", "utf8"),
);
const seeded = JSON.parse(await readFile(".local/seminar-data.json", "utf8"));
const report = {
  checks: [],
  screenshots: [],
  errors: [],
  denied: [],
  failures: [],
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts = [];
async function context(mobile = false) {
  const ctx = await browser.newContext({
    baseURL,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  contexts.push(ctx);
  await ctx.addInitScript(() => {
    if (["localhost", "127.0.0.1"].includes(location.hostname))
      localStorage.setItem("crm_persona_captured", "1");
  });
  ctx.on("page", (page) =>
    page.on("pageerror", (error) => report.errors.push(error.message)),
  );
  return ctx;
}
async function login(ctx, role) {
  const entry = credentials[role];
  assert(
    (
      await ctx.request.post("/api/method/login", {
        form: { usr: entry.username, pwd: entry.password },
      })
    ).ok(),
    `${role} login failed`,
  );
}
async function call(page, method, args = {}, verb = "POST") {
  return page.evaluate(
    async ({ method, args, verb }) => {
      const r = await fetch(`/api/method/${method}`, {
        method: verb,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token":
            window.csrf_token ||
            document.querySelector('meta[name="csrf-token"]')?.content ||
            "",
        },
        ...(verb === "POST" ? { body: JSON.stringify(args) } : {}),
      });
      const data = await r.json();
      return { status: r.status, data: data.message, exc_type: data.exc_type };
    },
    { method, args, verb },
  );
}
async function rpc(page, method, args = {}, verb = "POST") {
  const r = await call(page, method, args, verb);
  assert(
    !r.exc_type && r.status === 200,
    `${method}: HTTP ${r.status} ${r.exc_type || ""}`,
  );
  return r.data;
}
async function screenshot(page, name) {
  const help = page.locator(".fixed.z-50.right-0");
  if (await help.isVisible()) {
    await help.locator(":scope > div:first-child button").last().click();
    await help.waitFor({ state: "hidden" });
  }
  await page.evaluate(() => document.fonts.ready);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `Horizontal overflow: ${name}`,
  );
  const path = `${output}/${name}.png`;
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  report.screenshots.push(path);
}
const waitRpc = (page, method) =>
  page.waitForResponse((r) => r.url().endsWith(`/api/method/${method}`));
async function staffGenerate(page) {
  await page.locator('.bm-native-form input[name="consent"]').waitFor();
  assert.equal(await page.locator('input[name="consent"]').isChecked(), false);
  await page.locator('input[name="consent"]').check();
  const generated = waitRpc(
    page,
    "beautymatch.api.portal.generate_for_request",
  );
  await page
    .getByRole("button", { name: "Xác nhận & tạo gợi ý", exact: true })
    .click();
  const { receipt, result } = (await (await generated).json()).message;
  assert(result?.session_id && receipt?.crm_lead);
  await page.locator(".bm-native-product").first().waitFor();
  return { receipt, result };
}
try {
  for (let i = 0; i < 30; i++) {
    if (
      await fetch(`${baseURL}/api/method/ping`)
        .then((r) => r.ok)
        .catch(() => false)
    )
      break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const customer = await context();
  const page = await customer.newPage();
  await page.goto("/beautymatch/portal");
  await page
    .getByLabel("Email hoặc tên đăng nhập", { exact: true })
    .fill(credentials.customer.username);
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill(credentials.customer.password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.locator("#portal-form:not([hidden])").waitFor();
  assert.equal(await page.locator('[name="consent"]').isChecked(), false);
  assert(await page.locator('[name="email"]').evaluate((el) => el.readOnly));
  await page.locator('[name="max_budget"]').fill("325000");
  await page.locator('[name="consent"]').check();
  await screenshot(page, "customer-intake");
  // Actual offline failure: no successful response is fabricated.
  await customer.setOffline(true);
  await page
    .getByRole("button", { name: "Gửi yêu cầu tư vấn", exact: true })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#portal-status").dataset.error === "1",
  );
  const retry = await page.evaluate(() =>
    JSON.parse(
      sessionStorage.getItem(
        `beautymatch_portal_retry_v1:${document.querySelector('[name="email"]').value}`,
      ),
    ),
  );
  assert(retry?.payload.request_id);
  await customer.setOffline(false);
  const submitResponse = waitRpc(page, "beautymatch.api.portal.submit_profile");
  await page
    .getByRole("button", { name: "Gửi yêu cầu tư vấn", exact: true })
    .click();
  const submitted = (await (await submitResponse).json()).message;
  assert.equal(submitted.request_id, retry.payload.request_id);
  await page.getByText(/Đã gửi yêu cầu thành công/).waitFor();
  const duplicates = await Promise.all([
    rpc(page, "beautymatch.api.portal.submit_profile", {
      payload: retry.payload,
    }),
    rpc(page, "beautymatch.api.portal.submit_profile", {
      payload: retry.payload,
    }),
  ]);
  assert(duplicates.every((row) => row.request_id === submitted.request_id));
  await screenshot(page, "customer-submitted");
  report.checks.push(
    "Customer login -> own profile -> real offline failure -> retry keeps UUID -> successful authenticated intake; concurrent retries share one request",
  );

  const failures = [
    ["beautymatch.api.frontend.get_workspace", {}],
    ["beautymatch.api.portal.list_requests", {}],
    [
      "beautymatch.api.portal.submit_profile",
      {
        payload: {
          ...retry.payload,
          email: "tran.ngoc.ha.demo@example.invalid",
        },
      },
    ],
    [
      "beautymatch.api.portal.submit_profile",
      { payload: { ...retry.payload, crm_lead: seeded.customers.B.crm_lead } },
    ],
    [
      "frappe.client.get",
      { doctype: "CRM Lead", name: seeded.customers.B.crm_lead },
    ],
    [
      "frappe.client.get",
      { doctype: "Beauty Profile", name: seeded.customers.B.beauty_profile },
    ],
  ];
  for (const [method, args] of failures) {
    const r = await call(page, method, args);
    assert(
      r.exc_type && r.status >= 400,
      `Customer unexpectedly accessed ${method}`,
    );
    report.denied.push({ method, status: r.status });
  }
  const crm = await customer.request.get("/crm/beautymatch");
  assert.equal(crm.status(), 403);
  const guest = await context();
  const denied = await guest.request.post(
    "/api/method/beautymatch.api.portal.get_my_profile",
    { data: {} },
  );
  assert.equal(denied.status(), 403);
  report.checks.push(
    "Customer is denied CRM shell, staff APIs, other Lead/profile reads, forged email and caller-selected Lead; Guest is denied intake",
  );

  const staff = await context();
  await login(staff, "staff");
  const crmPage = await staff.newPage();
  await crmPage.goto("/crm/beautymatch/requests");
  const row = crmPage.locator(`[data-request="${submitted.request_id}"]`);
  await row.waitFor();
  await crmPage.evaluate(() => (window.__seminarHost = "same-crm-document"));
  const sidebar = await crmPage
    .locator('[data-slot="sidebar"]')
    .elementHandle();
  await screenshot(crmPage, "staff-requests");
  await row
    .getByRole("button", { name: "Tiếp nhận tư vấn", exact: true })
    .click();
  await crmPage.waitForURL("**/crm/beautymatch/consultation");
  await screenshot(crmPage, "beauty-profile");
  const first = await staffGenerate(crmPage);
  assert.equal(first.result.results.length, 3);
  assert.equal(first.receipt.crm_lead, seeded.customers.A.crm_lead);
  assert.equal(
    await crmPage.evaluate(() => window.__seminarHost),
    "same-crm-document",
  );
  assert(await sidebar.evaluate((el) => el.isConnected));
  await screenshot(crmPage, "recommendations");
  const a11y = await new AxeBuilder({ page: crmPage })
    .include(".bm-native")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  assert.equal(a11y.violations.length, 0);
  report.native_accessibility = [];
  report.checks.push(
    "Sales User accepts customer request in native CRM; saves the same Lead/profile and generates actual Top 3, retaining host sidebar/document",
  );
  const card = crmPage.locator(".bm-native-product").first();
  const feedbackResponse = waitRpc(
    crmPage,
    "beautymatch.api.feedback.submit_feedback",
  );
  await card.getByRole("button", { name: "Quan tâm", exact: true }).click();
  const feedback = (await (await feedbackResponse).json()).message;
  assert.equal(feedback.follow_up_status, "CREATED");
  assert(feedback.follow_up_task);
  await card.locator(".bm-native-confirmation").waitFor();
  await screenshot(crmPage, "feedback-created");
  await card.getByRole("button", { name: /^Mở CRM Task/ }).click();
  await crmPage.waitForURL("**/crm/tasks**");
  const modal = crmPage.getByRole("dialog");
  await modal.waitFor();
  await modal.getByRole("button", { name: "Update", exact: true }).waitFor();
  const task = await rpc(crmPage, "frappe.client.get", {
    doctype: "CRM Task",
    name: feedback.follow_up_task,
  });
  assert.equal(task.assigned_to, credentials.staff.username);
  assert.equal(task.reference_docname, first.receipt.crm_lead);
  assert.equal(task.beautymatch_session, first.result.session_id);
  assert.equal(task.beautymatch_item, first.result.results[0].item_id);
  await screenshot(crmPage, "crm-task");
  await modal.locator(".mb-5").first().getByRole("button").last().click();
  await modal.waitFor({ state: "hidden" });
  const repeated = await rpc(
    crmPage,
    "beautymatch.api.feedback.submit_feedback",
    {
      session_id: first.result.session_id,
      item_id: first.result.results[0].item_id,
      customer_feedback: "Interested",
    },
  );
  assert.equal(repeated.follow_up_task, feedback.follow_up_task);
  const taskList = await rpc(crmPage, "frappe.client.get_list", {
    doctype: "CRM Task",
    filters: {
      beautymatch_follow_up_key: `${first.result.session_id}:${first.result.results[0].item_id}`,
    },
    fields: ["name"],
  });
  assert.equal(taskList.length, 1);
  report.checks.push(
    "Interested confirms CREATED; assigned employee opens the actual linked Task modal; repeated Interested preserves exactly one Task",
  );

  const original = await rpc(crmPage, "beautymatch.api.frontend.read", {
    operation: "get_recommendation_result",
    parameters: { session_id: first.result.session_id },
  });
  await page.locator('[name="max_budget"]').fill("324000");
  await page.locator('[name="consent"]').check();
  const returningResponse = waitRpc(
    page,
    "beautymatch.api.portal.submit_profile",
  );
  await page
    .getByRole("button", { name: "Gửi yêu cầu tư vấn", exact: true })
    .click();
  const returning = (await (await returningResponse).json()).message;
  await crmPage.goto("/crm/beautymatch/requests");
  const returningRow = crmPage.locator(
    `[data-request="${returning.request_id}"]`,
  );
  await returningRow.waitFor();
  await screenshot(crmPage, "returning-request");
  await returningRow
    .getByRole("button", { name: "Tiếp nhận tư vấn", exact: true })
    .click();
  const second = await staffGenerate(crmPage);
  assert.equal(second.receipt.crm_lead, first.receipt.crm_lead);
  assert.equal(second.receipt.beauty_profile, first.receipt.beauty_profile);
  assert.notEqual(second.result.session_id, first.result.session_id);
  const savedOriginal = await rpc(crmPage, "beautymatch.api.frontend.read", {
    operation: "get_recommendation_result",
    parameters: { session_id: first.result.session_id },
  });
  assert.deepEqual(savedOriginal, original);
  await crmPage
    .getByRole("link", { name: "Khách hàng & lịch sử", exact: true })
    .click();
  await crmPage.locator(".bm-native-session").first().waitFor();
  await screenshot(crmPage, "history");
  await page
    .getByRole("button", { name: "Cập nhật trạng thái", exact: true })
    .click();
  await page.getByText(/Đã cập nhật trạng thái yêu cầu/).waitFor();
  assert(
    (await page.locator("#portal-requests").innerText()).includes("Đã tư vấn"),
  );
  report.checks.push(
    "Returning customer updates the same current profile; second session is new and previous result remains identical; customer sees Completed",
  );

  await crmPage.evaluate((data) => {
    sessionStorage.setItem(
      "beautymatch_native_v2:lead",
      JSON.stringify(data.crm_lead),
    );
    sessionStorage.setItem(
      "beautymatch_native_v2:opened",
      JSON.stringify({ crm_lead: data.crm_lead, session_id: data.session_id }),
    );
  }, seeded.customers.C);
  await crmPage.goto("/crm/beautymatch/result");
  await crmPage
    .getByRole("heading", { name: "Chưa có sản phẩm phù hợp", exact: true })
    .waitFor();
  assert.equal(await crmPage.locator(".bm-native-product").count(), 0);
  await screenshot(crmPage, "empty-result");
  await crmPage.goto("/crm/leads");
  await crmPage
    .getByPlaceholder("Full Name", { exact: true })
    .first()
    .waitFor();
  await crmPage
    .getByPlaceholder("Full Name", { exact: true })
    .first()
    .fill("Nguyễn Minh Anh");
  await screenshot(crmPage, "crm-leads");
  await crmPage.goto("/crm/beautymatch/dashboard");
  await crmPage.locator('[data-metric="total_sessions"]').waitFor();
  await screenshot(crmPage, "dashboard");
  const dash = await rpc(
    crmPage,
    "beautymatch.api.dashboard.get_dashboard_data",
    {},
    "GET",
  );
  assert.equal(
    await crmPage.locator('[data-metric="total_sessions"] strong').innerText(),
    new Intl.NumberFormat("vi-VN").format(dash.kpis.total_sessions),
  );
  const manager = await context();
  await login(manager, "manager");
  const managerPage = await manager.newPage();
  await managerPage.goto("/crm/beautymatch/dashboard");
  await managerPage.locator('[data-metric="total_sessions"]').waitFor();
  await screenshot(managerPage, "manager-dashboard");
  const managerQueue = await rpc(
    managerPage,
    "beautymatch.api.portal.list_requests",
    { status: "Completed" },
  );
  assert(managerQueue.requests.some((r) => r.name === returning.request_id));
  report.checks.push(
    "Empty result is real and has no fabricated cards; Leads, staff dashboard and Sales Manager dashboard/queue load with real scoped data",
  );

  const mobile = await context(true);
  await login(mobile, "customer");
  const mobilePage = await mobile.newPage();
  await mobilePage.goto("/beautymatch/portal");
  await mobilePage.locator("#portal-form:not([hidden])").waitFor();
  await screenshot(mobilePage, "customer-mobile");
  const portalAxe = await new AxeBuilder({ page: mobilePage })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  report.portal_accessibility = portalAxe.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.length,
  }));
  assert.equal(portalAxe.violations.length, 0, "Customer mobile accessibility");
  await crmPage.evaluate(() => localStorage.setItem("theme", "dark"));
  await crmPage.reload();
  await crmPage.locator('[data-metric="total_sessions"]').waitFor();
  await screenshot(crmPage, "native-dark");
  for (const route of [
    "",
    "requests",
    "consultation",
    "customer",
    "result",
    "feedback",
    "dashboard",
  ]) {
    await crmPage.goto(`/crm/beautymatch/${route}`);
    await crmPage.locator('[data-testid="beautymatch-native"]').waitFor();
    assert.equal(
      await crmPage
        .locator('[data-slot="sidebar"] nav a[href="/crm/beautymatch"]')
        .count(),
      1,
    );
  }
  report.checks.push(
    "Customer mobile layout and Axe pass; native dark mode and all seven routes reload with one sidebar entry",
  );
  const raw = execFileSync(
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
      "beautymatch.scripts.seminar_audit.verify",
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  report.backend = JSON.parse(raw.trim());
  report.sessions = [first.result.session_id, second.result.session_id];
  report.task = String(task.name);
  report.catalog = seeded.catalog;
} catch (error) {
  report.failures.push(error.message);
} finally {
  for (const ctx of contexts) {
    await ctx.request.get("/api/method/logout").catch(() => {});
    await ctx.close();
  }
  await browser.close();
  report.passed = !report.errors.length && !report.failures.length;
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        passed: report.passed,
        checks: report.checks,
        errors: report.errors,
        failures: report.failures,
        report: `${output}/report.json`,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}
