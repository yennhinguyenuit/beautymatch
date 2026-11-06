// Real Docker/browser acceptance. No API response mocks, no outbound calls.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const output = "test-results/self-service";
await mkdir(output, { recursive: true });
const credentials = JSON.parse(
  await readFile(".local/seminar-credentials.json", "utf8"),
);
const report = {
  started_at: new Date().toISOString(),
  checks: [],
  errors: [],
  screenshots: [],
  failures: [],
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts = [];
function bench(method, args = {}) {
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
      method,
      "--kwargs",
      JSON.stringify(args),
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return raw.trim() ? JSON.parse(raw) : null;
}
const counts = () =>
  bench("beautymatch.scripts.self_service_audit.snapshot").counts;
async function help(page) {
  const el = page.locator(".fixed.z-50.right-0");
  if (await el.isVisible()) {
    await el.locator(":scope > div:first-child button").last().click();
    await el.waitFor({ state: "hidden" });
  }
}
async function login(role) {
  const ctx = await browser.newContext({
    baseURL: "http://localhost:8000",
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(ctx);
  await ctx.addInitScript(() =>
    localStorage.setItem("crm_persona_captured", "1"),
  );
  const p = await ctx.newPage();
  p.on("pageerror", (e) => report.errors.push({ role, message: e.message }));
  await p.goto(
    role === "customer"
      ? "/beautymatch/portal/"
      : "/login?redirect-to=/crm/beautymatch/care",
  );
  const c = credentials[role];
  if (role === "customer") {
    await p.locator("[name=usr]").fill(c.login);
    await p.locator("[name=pwd]").fill(c.password);
    await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await p.locator("#portal-form:not([hidden])").waitFor();
  } else {
    await p.locator("#login_email").fill(c.login);
    await p.locator("#login_password").fill(c.password);
    await p.locator(".btn-login").click();
    await p.locator(".bm-native-tabs").waitFor();
    await p
      .getByRole("heading", { name: "Yêu cầu liên hệ", exact: true })
      .waitFor();
    await help(p);
  }
  return { ctx, p };
}
async function rpc(page, method, args = {}) {
  return page.evaluate(
    async ({ method, args }) => {
      const r = await fetch("/api/method/" + method, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token":
            window.csrf_token ||
            document.querySelector("meta[name=csrf-token]")?.content ||
            "",
        },
        body: JSON.stringify(args),
      });
      const b = await r.json();
      return { status: r.status, data: b.message, error: b.exc_type };
    },
    { method, args },
  );
}
async function call(p, method, args = {}) {
  const r = await rpc(p, method, args);
  assert.equal(r.status, 200, `${method}: ${r.error}`);
  return r.data;
}
const self = (p, method, args) =>
  call(p, "beautymatch.api.self_service." + method, args);
const care = (p, method, args) =>
  call(p, "beautymatch.api.customer_care." + method, args);
async function shot(p, name) {
  await help(p);
  assert(
    await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `overflow ${name}`,
  );
  const path = output + "/" + name + ".png";
  await p.screenshot({ path, fullPage: true, animations: "disabled" });
  report.screenshots.push(path);
}
const response = (p, method) =>
  p.waitForResponse((r) => r.url().endsWith("/api/method/" + method));
try {
  const customer = await login("customer"),
    staff = await login("staff"),
    manager = await login("manager");
  const before = counts();
  const p = customer.p;
  await p.locator("[name=phone]").fill("0999990001");
  await p.locator("[name=skin_type]").selectOption("COMBINATION");
  await p
    .locator("[name=sensitivity]")
    .selectOption("Not specifically sensitive");
  for (const key of ["concern_oil_control", "concern_acne", "concern_aging"])
    await p.locator(`[name=${key}]`).check();
  await p.locator("[name=requested_category]").selectOption("SERUM");
  await p.locator("[name=max_budget]").fill("325000");
  await p.locator("#portal-form [name=consent]").check();
  const generated = response(p, "beautymatch.api.self_service.recommend");
  await p
    .getByRole("button", { name: "Xem sản phẩm phù hợp", exact: true })
    .click();
  const generatedResponse = await generated;
  const originalGeneration = generatedResponse.request().postDataJSON();
  const a = (await generatedResponse.json()).message;
  assert(a?.session_id);
  report.session = a.session_id;
  await p
    .locator(
      `#portal-discovery[data-session-id="${a.session_id}"] [data-portal-item]`,
    )
    .first()
    .waitFor();
  await p
    .locator("#portal-discovery")
    .getByRole("heading", { name: "Sản phẩm dành cho bạn", exact: true })
    .waitFor();
  assert.equal(await p.locator("[data-portal-item]").count(), 3);
  assert.equal(counts()["CRM Task"], before["CRM Task"]);
  assert.equal(counts()["CRM Notification"], before["CRM Notification"]);
  await shot(p, "instant-top3-desktop");
  report.checks.push(
    "Customer khach logs in through UI, saves CRM profile and receives actual Top 3 immediately; no Task or contact notification is created",
  );
  const after = counts();
  await p.reload();
  await p.locator("[data-portal-item]").first().waitFor();
  assert.equal(
    counts()["Recommendation Session"],
    after["Recommendation Session"],
  );
  const own = await self(p, "get_result", { session_id: a.session_id });
  assert.equal(
    own.results[0].final_match_score,
    a.results[0].final_match_score,
  );
  const first = p.locator("[data-portal-item]").first(),
    item = a.results[0].item_id;
  await first.getByRole("button", { name: "♡ Quan tâm", exact: true }).click();
  await p
    .locator("[data-portal-item]")
    .first()
    .getByText("Đã quan tâm", { exact: true })
    .waitFor();
  assert.equal(counts()["CRM Task"], before["CRM Task"]);
  assert.equal(counts()["CRM Notification"], before["CRM Notification"]);
  await p.getByRole("button", { name: "Không, cảm ơn", exact: true }).click();
  await p
    .getByText("Bạn chưa yêu cầu liên hệ; không tạo công việc mới.", {
      exact: false,
    })
    .waitFor();
  assert.equal(counts()["CRM Task"], before["CRM Task"]);
  report.checks.push(
    "Reload restores the saved session without generation; customer Interested and declining contact preserve feedback but create no work or notification",
  );
  await staff.p.locator("#notifications-btn").click();
  await p
    .getByRole("button", { name: "Có, tôi muốn được tư vấn thêm", exact: true })
    .click();
  await p.locator("#portal-contact-form [name=channel]").selectOption("Phone");
  await p
    .locator("#portal-contact-form [name=customer_note]")
    .fill("DEMO seminar: khách chủ động muốn được tư vấn serum.");
  await p.locator("#portal-contact-form [name=contact_consent]").check();
  const requested = response(
    p,
    "beautymatch.api.customer_care.request_contact",
  );
  await p
    .getByRole("button", { name: "Gửi yêu cầu tư vấn thêm", exact: true })
    .click();
  const contactResponse = await requested;
  const contactArgs = contactResponse.request().postDataJSON();
  const contact = (await contactResponse.json()).message;
  assert.equal(contact.follow_up_status, "CREATED");
  report.contact = contact.request_id;
  const href = "/crm/beautymatch/contact/" + contact.request_id;
  await staff.p.locator(`a[href="${href}"]`).waitFor();
  await shot(staff.p, "assigned-contact-notification");
  await shot(p, "customer-contact-confirmed");
  const once = counts();
  assert.equal(once["CRM Task"], before["CRM Task"] + 1);
  assert.equal(once["CRM Notification"], before["CRM Notification"] + 1);
  const concurrentContacts = await Promise.all(
    [0, 1, 2].map(() => care(p, "request_contact", contactArgs)),
  );
  assert(concurrentContacts.every((r) => r.request_id === contact.request_id));
  const concurrentGeneration = await Promise.all(
    [0, 1, 2].map(() => self(p, "recommend", originalGeneration)),
  );
  assert(concurrentGeneration.every((r) => r.session_id === a.session_id));
  assert.equal(
    (await call(p, "beautymatch.api.portal.submit_profile", originalGeneration))
      .session_id,
    a.session_id,
  );
  assert.equal(
    counts()["Recommendation Session"],
    once["Recommendation Session"],
  );
  assert.equal(counts()["CRM Task"], once["CRM Task"]);
  assert.equal(counts()["CRM Notification"], once["CRM Notification"]);
  report.checks.push(
    "Real concurrent retries reuse one generation receipt/session and one Contact Request/Task/Notification",
  );
  await staff.p.locator(`a[href="${href}"]`).click();
  await staff.p.locator(`[data-contact="${contact.request_id}"]`).waitFor();
  await staff.p.reload();
  await staff.p.locator(`[data-contact="${contact.request_id}"]`).waitFor();
  await shot(staff.p, "staff-contact-details");
  const notices = await call(
    staff.p,
    "crm.api.notifications.get_notifications",
  );
  assert.equal(
    notices.filter((n) => n.notification_type_doc === contact.request_id)
      .length,
    1,
  );
  assert.equal(
    notices.find((n) => n.notification_type_doc === contact.request_id).read,
    1,
  );
  const detail = await care(staff.p, "get_contact", {
    request_id: contact.request_id,
  });
  report.task = detail.task;
  assert.equal(detail.assigned_to, credentials.staff.username);
  assert.equal(detail.task_status, "Todo");
  report.checks.push(
    "Explicit contact consent creates one native assigned Task and one notification; Sales User Demo receives realtime, clicks exact request, reloads and marks it read through native CRM",
  );
  const row = staff.p.locator(`[data-contact="${contact.request_id}"]`);
  await row.getByRole("button", { name: "Mở CRM Task", exact: true }).click();
  await staff.p.getByRole("dialog").waitFor();
  await staff.p
    .getByRole("dialog")
    .getByRole("button", { name: "Update", exact: true })
    .waitFor();
  await shot(staff.p, "native-created-task");
  await staff.p.goto(href);
  await staff.p.locator(`[data-contact="${contact.request_id}"]`).waitFor();
  await staff.p
    .getByRole("button", { name: "Ghi nhận cuộc gọi", exact: true })
    .click();
  const form = staff.p.locator("form.bm-care-form");
  await form.getByLabel("Số điện thoại nhân viên đã dùng").fill("0999990002");
  await form.getByLabel("Kết quả chăm sóc").selectOption("No Answer");
  await form
    .getByLabel("Nội dung trao đổi")
    .fill("DEMO: thử gọi giả lập, khách chưa nghe máy.");
  await form
    .getByLabel("Tôi xác nhận đã thực hiện hoặc thử cuộc gọi được ghi.")
    .check();
  await form
    .getByLabel("Cuộc gọi giả lập DEMO, không trình bày là cuộc gọi thật.")
    .check();
  await staff.p
    .getByRole("button", { name: "Lưu Call Log", exact: true })
    .click();
  await staff.p
    .getByText("[DEMO] Khách chưa nghe máy", { exact: true })
    .waitFor();
  assert.notEqual(
    (await care(staff.p, "get_contact", { request_id: contact.request_id }))
      .task_status,
    "Done",
  );
  const next = new Date(Date.now() + 86400000);
  const local = new Date(next - next.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
  await staff.p.getByLabel("Thời hạn liên hệ lại").fill(local);
  await staff.p
    .getByRole("button", { name: "Lên lịch liên hệ lại", exact: true })
    .click();
  await staff.p
    .getByText("Đã cập nhật công việc trong CRM.", { exact: true })
    .waitFor();
  await shot(staff.p, "callback-keeps-task-open");
  assert.equal(
    (await care(staff.p, "care_metrics")).callback_customers >= 1,
    true,
  );
  await staff.p
    .getByRole("button", { name: "Ghi nhận cuộc gọi", exact: true })
    .click();
  await form.getByLabel("Kết quả chăm sóc").selectOption("Consulted");
  await form
    .getByLabel("Nội dung trao đổi")
    .fill("DEMO: đã tư vấn giả lập, khách đã hiểu sản phẩm.");
  await form
    .getByLabel("Tôi xác nhận đã thực hiện hoặc thử cuộc gọi được ghi.")
    .check();
  await form
    .getByLabel("Cuộc gọi giả lập DEMO, không trình bày là cuộc gọi thật.")
    .check();
  await staff.p
    .getByRole("button", { name: "Lưu Call Log", exact: true })
    .click();
  await staff.p
    .getByText("[DEMO] Đã tư vấn thành công", { exact: true })
    .waitFor();
  assert.notEqual(
    (await care(staff.p, "get_contact", { request_id: contact.request_id }))
      .task_status,
    "Done",
  );
  await staff.p
    .getByRole("button", { name: "Hoàn thành chăm sóc", exact: true })
    .click();
  await staff.p.getByText("Đã hoàn thành", { exact: true }).waitFor();
  assert.equal(
    (await care(staff.p, "get_contact", { request_id: contact.request_id }))
      .task_status,
    "Done",
  );
  await shot(staff.p, "explicit-task-completion");
  report.checks.push(
    "Sales User records two explicitly labeled DEMO native calls through UI; no-answer remains open, callback sets a real due date, successful call still needs explicit Task completion",
  );
  const saved = await care(staff.p, "get_contact", {
    request_id: contact.request_id,
  });
  await staff.p
    .getByRole("button", { name: "Mở Call Log gốc", exact: true })
    .first()
    .click();
  await staff.p.locator("[role=dialog]").waitFor();
  await shot(staff.p, "native-call-log-modal");
  const privateDenied = await rpc(
    p,
    "beautymatch.api.customer_care.get_contact",
    { request_id: contact.request_id },
  );
  assert.equal(privateDenied.status, 403);
  assert.equal((await customer.ctx.request.get("/crm")).status(), 403);
  const foreign = bench(
    "beautymatch.scripts.self_service_audit.snapshot",
  ).foreign_session;
  assert(foreign);
  assert.equal(
    (
      await rpc(p, "beautymatch.api.self_service.get_result", {
        session_id: foreign,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await rpc(p, "beautymatch.api.self_service.submit_feedback", {
        session_id: a.session_id,
        item_id: "not-owned",
        customer_feedback: "Interested",
      })
    ).status,
    403,
  );
  report.checks.push(
    "Customer cannot read internal contact records, CRM shell, other sessions or foreign items",
  );
  await manager.p.goto("/crm/beautymatch/dashboard");
  await manager.p.locator("[data-care-metric=calls]").waitFor();
  const metrics = await care(manager.p, "care_metrics");
  assert(metrics.calls >= 2);
  assert(metrics.completed_tasks >= 1);
  await shot(manager.p, "manager-real-care-dashboard");
  const sessionBefore = counts()["Recommendation Session"];
  await p.locator("[name=max_budget]").fill("1");
  await p.locator("#portal-form [name=consent]").check();
  const emptyResponse = response(p, "beautymatch.api.self_service.recommend");
  await p
    .getByRole("button", { name: "Xem sản phẩm phù hợp", exact: true })
    .click();
  const empty = (await (await emptyResponse).json()).message;
  await p
    .locator(`#portal-discovery[data-session-id="${empty.session_id}"]`)
    .waitFor();
  await p
    .getByRole("heading", { name: "Chưa có sản phẩm phù hợp", exact: true })
    .waitFor();
  assert.equal(empty.results.length, 0);
  assert.equal(counts()["Recommendation Session"], sessionBefore + 1);
  assert.equal(
    (await self(p, "get_result", { session_id: a.session_id })).results[0]
      .final_match_score,
    a.results[0].final_match_score,
  );
  report.checks.push(
    "Manager sees real scoped care metrics; empty matching still saves a session and a returning profile leaves earlier scores and feedback intact",
  );
  const history = await self(p, "history");
  await p
    .locator("#portal-session-history")
    .getByRole("button", { name: new RegExp(a.session_id) })
    .click();
  await p.locator("[data-portal-item]").first().waitFor();
  for (const width of [390, 320]) {
    await p.setViewportSize({ width, height: 844 });
    await shot(p, "portal-" + width);
  }
  await staff.p.goto("/crm/beautymatch/care");
  await staff.p.locator("[data-contact]").first().waitFor();
  await staff.p.setViewportSize({ width: 390, height: 844 });
  await shot(staff.p, "staff-care-mobile");
  report.checks.push(
    "Saved session history opens from portal; desktop and 390/320 portal plus native care mobile render without horizontal overflow",
  );
  await staff.p.setViewportSize({ width: 1440, height: 1000 });
  await staff.p.goto("/crm/leads/CRM-LEAD-2026-00038");
  await staff.p
    .getByRole("button", { name: "Tư vấn với BeautyMatch", exact: true })
    .first()
    .click();
  await staff.p.locator("input[name=consent]").waitFor();
  await staff.p.locator("input[name=max_budget]").fill("325000");
  await staff.p.locator("input[name=consent]").check();
  await staff.p
    .getByRole("button", { name: "Lưu hồ sơ & tạo gợi ý", exact: true })
    .click();
  await staff.p.locator("[data-item-id]").first().waitFor();
  assert.equal(await staff.p.locator("[data-item-id]").count(), 3);
  const beforeStaff = counts()["CRM Task"];
  const staffFeedback = response(
    staff.p,
    "beautymatch.api.feedback.submit_feedback",
  );
  await staff.p
    .locator("[data-item-id]")
    .first()
    .getByRole("button", { name: "Quan tâm", exact: true })
    .click();
  const recorded = (await (await staffFeedback).json()).message;
  assert.equal(recorded.feedback_source, "Staff");
  assert.equal(recorded.follow_up_status, "NOT_REQUESTED");
  assert.equal(counts()["CRM Task"], beforeStaff);
  await staff.p
    .getByRole("button", { name: "Ghi nhận khách đồng ý liên hệ", exact: true })
    .click();
  await staff.p
    .getByLabel("Khách đã đồng ý được liên hệ theo thông tin này.")
    .check();
  const staffContact = response(
    staff.p,
    "beautymatch.api.customer_care.request_staff_contact",
  );
  await staff.p
    .getByRole("button", { name: "Gửi yêu cầu tư vấn thêm", exact: true })
    .click();
  assert.equal(
    (await (await staffContact).json()).message.follow_up_status,
    "CREATED",
  );
  assert.equal(counts()["CRM Task"], beforeStaff + 1);
  await shot(staff.p, "staff-direct-consultation-separate-consent");
  report.checks.push(
    "Sales User Demo still consults from native Lead UI, generates actual Top 3 and records Staff-attributed feedback; separate explicit contact consent creates the Task",
  );
  const qaTitle = `BeautyMatch Self Service QA ${Date.now()}`;
  const qaLead = await call(staff.p, "frappe.client.insert", {
    doc: {
      doctype: "CRM Lead",
      first_name: qaTitle,
      email: `bm-care-crud-${randomUUID()}@example.invalid`,
      lead_owner: credentials.staff.username,
      status: "New",
    },
  });
  await call(staff.p, "frappe.client.set_value", {
    doctype: "CRM Lead",
    name: qaLead.name,
    fieldname: "first_name",
    value: qaTitle + " Updated",
  });
  await staff.p.goto("/crm/leads/" + qaLead.name);
  await staff.p
    .getByRole("button", { name: "Tư vấn với BeautyMatch", exact: true })
    .first()
    .waitFor();
  assert(
    (await staff.p.locator("body").innerText()).includes(qaTitle + " Updated"),
  );
  report.checks.push(
    "Sales User Demo creates and updates a labeled native CRM Lead via real APIs and opens the updated record in the native Lead UI",
  );
  assert.deepEqual(report.errors, []);
} catch (e) {
  report.failures.push(e.stack);
  process.exitCode = 1;
  for (let index = 0; index < contexts.length; index++) {
    for (const page of contexts[index].pages()) {
      await page
        .screenshot({
          path: output + "/failed-" + index + ".png",
          fullPage: true,
        })
        .catch(() => {});
    }
  }
} finally {
  for (const ctx of contexts) await ctx.close().catch(() => {});
  await browser.close();
  report.finished_at = new Date().toISOString();
  report.passed = !report.errors.length && !report.failures.length;
  await writeFile(output + "/report.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
