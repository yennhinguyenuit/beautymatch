// Real Frappe CRM host, real APIs, no route interception or fake responses.
// --exercise-flow creates two clearly named QA Leads/consultations (Admin + Sales).
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { skinTypes, categories } from "../frontend/crm/domain.mjs";

const exercise = process.argv.includes("--exercise-flow");
const baseURL = process.env.BM_LIVE_BASE_URL || "http://localhost:8000";
assert(
  ["localhost", "127.0.0.1", "crm.localhost"].includes(
    new URL(baseURL).hostname,
  ),
);
const output = exercise
  ? "test-results/crm-native"
  : "test-results/crm-native-smoke";
await mkdir(output, { recursive: true });
const report = {
  checks: [],
  screenshots: [],
  errors: [],
  failures: [],
  leads_created: 0,
  sessions: [],
  api_responses: [],
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts = [];
let sales;
function bench(method, args) {
  const command = [
    "exec",
    "-w",
    "/home/frappe/frappe-bench",
    "crm-frappe-1",
    "bench",
    "--site",
    "crm.localhost",
    "execute",
    method,
  ];
  if (args) command.push("--kwargs", JSON.stringify(args));
  const raw = execFileSync("docker", command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    return JSON.parse(raw.trim());
  } catch {
    throw new Error(`Cannot parse local audit method ${method}`);
  }
}
async function contextFor(identity, usr, pwd, mobile = false) {
  const context = await browser.newContext({
    baseURL,
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    isMobile: mobile,
    hasTouch: mobile,
  });
  contexts.push(context);
  await context.addInitScript(() => {
    if (["localhost", "127.0.0.1", "crm.localhost"].includes(location.hostname))
      localStorage.setItem("crm_persona_captured", "1");
  });
  assert(
    (
      await context.request.post("/api/method/login", { form: { usr, pwd } })
    ).ok(),
    `${identity} login failed`,
  );
  context.on("page", (page) => {
    page.on("pageerror", (error) =>
      report.errors.push({
        identity,
        path: new URL(page.url()).pathname,
        message: error.message,
      }),
    );
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.pathname.startsWith("/api/method/beautymatch."))
        report.api_responses.push({
          identity,
          method: url.pathname.split("/").at(-1),
          status: response.status(),
        });
    });
  });
  return context;
}
async function api(page, method, args = {}, verb = "POST") {
  return page.evaluate(
    async ({ method, args, verb }) => {
      const response = await fetch(`/api/method/${method}`, {
        method: verb,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": window.csrf_token,
        },
        ...(verb === "POST" ? { body: JSON.stringify(args) } : {}),
      });
      const body = await response.json();
      if (!response.ok || body.exc_type)
        throw new Error(
          `Real API ${method} failed: ${response.status()} ${body.exc_type || ""}`,
        );
      return body.message;
    },
    { method, args, verb },
  );
}
async function settled(page) {
  await page.locator("#app").waitFor();
  const help = page
    .locator(".fixed.z-50.right-0")
    .filter({ hasText: "Getting started" });
  if (await help.isVisible())
    await help.locator(":scope > div:first-child button").last().click();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}
async function snapshot(page, name, mask = false) {
  await settled(page);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `${name} horizontal overflow`,
  );
  const file = `${output}/${name}.png`;
  await page.screenshot({
    path: file,
    fullPage: true,
    animations: "disabled",
    mask: mask ? [page.locator(".bm-native table tbody td")] : [],
    maskColor: "#d5ded1",
  });
  report.screenshots.push(file);
}
const nativeLink = (page) =>
  page.locator('[data-slot="sidebar"] nav a[href="/crm/beautymatch"]');
async function proveHost(page, marker) {
  assert.match(new URL(page.url()).pathname, /^\/crm\//);
  assert.equal(
    await page.evaluate(() => window.__nativeBeautyMatchTest),
    marker,
    "Document navigated instead of changing host content",
  );
  assert.equal(
    await page.locator("[data-bm-sidebar-entry]").count(),
    0,
    "Legacy injected menu still present",
  );
  assert.equal(
    await page.locator('[data-testid="beautymatch-native"] iframe').count(),
    0,
  );
  assert.equal(await nativeLink(page).count(), 1);
  assert.equal(await nativeLink(page).getAttribute("aria-current"), "page");
}
async function openNative(page) {
  await page.goto("/crm", { waitUntil: "domcontentloaded" });
  await nativeLink(page).waitFor();
  const before = await nativeLink(page).evaluate((node) =>
    node
      .closest('[data-slot="sidebar-item"]')
      .previousElementSibling.querySelector("a")
      .getAttribute("href"),
  );
  assert.equal(before, "/crm/dashboard");
  const marker = `host-${Date.now()}`;
  await page.evaluate(
    (value) => (window.__nativeBeautyMatchTest = value),
    marker,
  );
  await nativeLink(page).click();
  await page.locator(".bm-native-toolbar").waitFor();
  await proveHost(page, marker);
  return marker;
}
async function flow(context, identity, usr, profile) {
  const page = await context.newPage();
  let marker = await openNative(page);
  await snapshot(page, `${identity}-overview`, true);
  const stamp = Date.now();
  const email = `beautymatch-native-${identity}-${stamp}@example.invalid`;
  const lead = await api(page, "frappe.client.insert", {
    doc: {
      doctype: "CRM Lead",
      first_name: `BeautyMatch Native CRM QA ${identity} ${stamp}`,
      email,
      lead_owner: usr,
      status: "New",
    },
  });
  report.leads_created++;
  await page.goto(`/crm/leads/${encodeURIComponent(lead.name)}`, {
    waitUntil: "domcontentloaded",
  });
  await page
    .getByRole("button", { name: "Tư vấn với BeautyMatch", exact: true })
    .waitFor();
  marker = `lead-${stamp}`;
  await page.evaluate(
    (value) => (window.__nativeBeautyMatchTest = value),
    marker,
  );
  const sidebar = await page.locator('[data-slot="sidebar"]').elementHandle();
  await page
    .getByRole("button", { name: "Tư vấn với BeautyMatch", exact: true })
    .click();
  await page.waitForURL("**/crm/beautymatch/consultation");
  await page.getByLabel(/^Họ và tên/).waitFor();
  assert.equal(
    await page.getByLabel("Email", { exact: true }).inputValue(),
    email,
  );
  await proveHost(page, marker);
  assert(
    await sidebar.evaluate((node) => node.isConnected),
    "Native sidebar was replaced",
  );
  for (const [label, value] of [
    ["Loại da", skinTypes[profile.skin_type]],
    [
      "Độ nhạy cảm",
      profile.sensitivity === "Sensitive"
        ? "Da nhạy cảm"
        : "Không đặc biệt nhạy cảm",
    ],
    ["Danh mục sản phẩm", categories[profile.requested_category]],
  ]) {
    await page.getByRole("combobox", { name: new RegExp(`^${label}`) }).click();
    await page.getByRole("option", { name: value, exact: true }).click();
  }
  await page
    .getByLabel(/^Ngân sách tối đa \(VND\)/)
    .fill(String(profile.max_budget));
  for (const [key, value] of Object.entries(profile))
    if (key.startsWith("concern_") && Number(value))
      await page.locator(`.bm-native input[name="${key}"]`).check();
  await page.locator('.bm-native input[name="consent"]').check();
  await snapshot(page, `${identity}-consultation`);
  const invalid = await page.locator(".bm-native-form").evaluate((form) =>
    [...form.elements]
      .filter((field) => field.validity && !field.validity.valid)
      .map((field) => ({
        name: field.name,
        reason: field.validationMessage,
      })),
  );
  assert.deepEqual(
    invalid,
    [],
    "Native form constraints disagree with the valid consultation",
  );
  const saveResponse = page
    .waitForResponse((r) =>
      r
        .url()
        .endsWith("/api/method/beautymatch.api.frontend.save_consultation"),
    )
    .catch((error) => error);
  const generateResponse = page
    .waitForResponse((r) =>
      r
        .url()
        .endsWith(
          "/api/method/beautymatch.api.recommendation.generate_recommendations",
        ),
    )
    .catch((error) => error);
  await page
    .getByRole("button", { name: "Lưu hồ sơ & tạo gợi ý", exact: true })
    .click();
  const saveReply = await saveResponse;
  if (saveReply instanceof Error) throw saveReply;
  const saved = await saveReply.json();
  assert(!saved.exc_type, `Save consultation failed ${saved.exc_type}`);
  assert.equal(
    saved.message.crm_lead,
    lead.name,
    "Selected Lead was duplicated",
  );
  const generateReply = await generateResponse;
  if (generateReply instanceof Error) throw generateReply;
  const generated = await generateReply.json();
  assert(!generated.exc_type, `Generate failed ${generated.exc_type}`);
  const result = generated.message;
  assert.equal(result.request_id, saved.message.request_id);
  assert(
    result.results.length > 0 && result.results.length <= 3,
    "Expected actual catalog matching results",
  );
  await page.locator(".bm-native-product").first().waitFor();
  await proveHost(page, marker);
  assert(await sidebar.evaluate((node) => node.isConnected));
  const repeated = await api(
    page,
    "beautymatch.api.recommendation.generate_recommendations",
    Object.fromEntries(
      ["crm_lead", "beauty_profile", "request_id", "profile_version"].map(
        (key) => [key, saved.message[key]],
      ),
    ),
  );
  assert.equal(repeated.session_id, result.session_id);
  const sameLead = await api(page, "frappe.client.get_list", {
    doctype: "CRM Lead",
    filters: { email },
    fields: ["name"],
  });
  assert.equal(sameLead.length, 1);
  report.sessions.push({
    identity,
    lead: lead.name,
    session: result.session_id,
    results: result.results.length,
    request_id: result.request_id,
  });
  await snapshot(page, `${identity}-results`);
  report.checks.push(
    `${identity}: native Lead action -> form -> TASK2 save -> TASK3 matching; same Lead, same document/sidebar; repeated generation reuses session`,
  );

  const card = page.locator(".bm-native-product").first();
  const interested = page.waitForResponse((r) =>
    r.url().endsWith("/api/method/beautymatch.api.feedback.submit_feedback"),
  );
  await card.getByRole("button", { name: "Quan tâm", exact: true }).click();
  const feedback = (await (await interested).json()).message;
  assert.equal(feedback.customer_feedback, "Interested");
  assert(["CREATED", "PENDING"].includes(feedback.follow_up_status));
  await card.locator(".bm-native-confirmation").waitFor();
  assert((await card.innerText()).includes(feedback.follow_up_status));
  const sameFeedback = await api(
    page,
    "beautymatch.api.feedback.submit_feedback",
    {
      session_id: result.session_id,
      item_id: result.results[0].item_id,
      customer_feedback: "Interested",
    },
  );
  assert.equal(sameFeedback.follow_up_task, feedback.follow_up_task);
  report.checks.push(
    `${identity}: real Interested confirmed ${feedback.follow_up_status}; repeated feedback preserves task identity`,
  );
  await snapshot(page, `${identity}-interested`);
  await card
    .getByRole("button", { name: "Không quan tâm", exact: true })
    .click();
  const reason = page.getByRole("combobox", { name: /^Lý do không quan tâm/ });
  await reason.waitFor();
  assert.equal(await reason.getAttribute("aria-required"), "true");
  await reason.click();
  await page
    .getByRole("option", { name: "Muốn tìm lựa chọn khác", exact: true })
    .click();
  const rejected = page.waitForResponse((r) =>
    r.url().endsWith("/api/method/beautymatch.api.feedback.submit_feedback"),
  );
  await card.getByRole("button", { name: "Gửi phản hồi", exact: true }).click();
  const rejection = (await (await rejected).json()).message;
  assert.equal(rejection.customer_feedback, "Not Interested");
  assert.equal(rejection.follow_up_status, "NOT_APPLICABLE");
  await page.getByRole("button", { name: "Mở CRM Lead", exact: true }).click();
  await page.getByRole("button", { name: "BeautyMatch", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Hồ sơ & lịch sử", exact: true })
    .click();
  await page.waitForURL("**/crm/beautymatch/customer");
  await page.locator(".bm-native-session").first().waitFor();
  await proveHost(page, marker);
  assert(
    (
      await page.locator(".bm-native-history-product").first().innerText()
    ).includes("Không quan tâm"),
  );
  await snapshot(page, `${identity}-history`);
  await page
    .getByRole("link", { name: "Phản hồi khách hàng", exact: true })
    .click();
  await page.locator(".bm-native-session").first().waitFor();
  await proveHost(page, marker);
  await snapshot(page, `${identity}-feedback`);
  await page.getByRole("link", { name: "Báo cáo tư vấn", exact: true }).click();
  await page.locator('[data-metric="total_sessions"] strong').waitFor();
  const dashboard = await api(
    page,
    "beautymatch.api.dashboard.get_dashboard_data",
    {},
    "GET",
  );
  assert.equal(
    await page.locator('[data-metric="total_sessions"] strong').innerText(),
    new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
      dashboard.kpis.total_sessions,
    ),
  );
  assert.equal(await page.locator(".bm-native-charts > section").count(), 2);
  await proveHost(page, marker);
  await snapshot(page, `${identity}-dashboard`);
  report.checks.push(
    `${identity}: Not Interested with required reason persisted; native Lead history/feedback and four-KPI/two-chart report use real APIs`,
  );

  for (const section of [
    "",
    "consultation",
    "customer",
    "feedback",
    "dashboard",
    "result",
  ]) {
    await page.goto(`/crm/beautymatch${section ? "/" + section : ""}`, {
      waitUntil: "domcontentloaded",
    });
    await page.locator('[data-testid="beautymatch-native"]').waitFor();
    await page
      .locator('.bm-native-state[aria-busy="true"]')
      .waitFor({ state: "hidden" });
    assert.equal(await nativeLink(page).count(), 1);
    assert.equal(await page.locator("[data-bm-sidebar-entry]").count(), 0);
  }
  await page.locator(".bm-native-product").first().waitFor();
  const history = await api(page, "beautymatch.api.frontend.read", {
    operation: "get_customer_history",
    parameters: { crm_lead: lead.name, limit: 20, start: 0 },
  });
  assert.equal(history.total, 1);
  assert.equal(history.sessions[0].session_id, result.session_id);
  report.checks.push(
    `${identity}: all six native URLs reload correctly; saved result survives reload without another session`,
  );
  const axe = await new AxeBuilder({ page })
    .include(".bm-native")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  report[`${identity}_accessibility`] = axe.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.length,
    targets: v.nodes.slice(0, 4).map((n) => n.target),
  }));
  assert.equal(
    axe.violations.length,
    0,
    `${identity} native content accessibility violations`,
  );
  return { lead: lead.name, session: result.session_id };
}

async function coreRegression(page, marker) {
  for (const route of [
    "leads",
    "contacts",
    "deals",
    "organizations",
    "notes",
    "tasks",
    "call-logs",
    "dashboard",
  ]) {
    await page
      .locator(`[data-slot="sidebar"] nav a[href^="/crm/${route}"]`)
      .first()
      .click();
    await page.waitForURL((url) => url.pathname.startsWith(`/crm/${route}`));
    await page.waitForTimeout(route === "dashboard" ? 1600 : 450);
    assert.equal(await nativeLink(page).count(), 1);
    assert.equal(
      await page.evaluate(() => window.__nativeBeautyMatchTest),
      marker,
    );
    if (route === "leads") {
      const filter = page
        .getByPlaceholder("Full Name", { exact: true })
        .first();
      await filter.waitFor();
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/method/crm.api.doc.get_data") &&
          r.request().postData()?.includes("BeautyMatch Native CRM QA"),
      );
      await filter.fill("BeautyMatch Native CRM QA");
      assert(Array.isArray((await (await response).json()).message?.data));
      const cleared = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/method/crm.api.doc.get_data") &&
          !r.request().postData()?.includes("BeautyMatch Native CRM QA"),
      );
      await filter.fill("");
      await cleared;
    }
  }
  await nativeLink(page).click();
  await page.locator(".bm-native-toolbar").waitFor();
  await proveHost(page, marker);
  report.checks.push(
    "All eight original CRM navigation modules remain functional in the same document; native Lead quick filter and clear use real APIs",
  );
  const tasks = await api(page, "frappe.client.get_list", {
    doctype: "CRM Task",
    fields: ["name"],
    limit_page_length: 1,
  });
  if (tasks.length) {
    await page.evaluate(
      (task) =>
        document.dispatchEvent(
          new CustomEvent("beautymatch:task", {
            detail: { task: String(task) },
          }),
        ),
      tasks[0].name,
    );
    await page.waitForURL((url) => url.pathname.startsWith("/crm/tasks"));
    const modal = page.getByRole("dialog");
    await modal.waitFor();
    await page.waitForTimeout(400);
    assert(await modal.locator("input,textarea,button").count());
    await modal.locator(".mb-5").first().getByRole("button").last().click();
    await modal.waitFor({ state: "hidden" });
    report.checks.push(
      "BeautyMatch task bridge opens an existing permitted real Task through native Tasks route and DoctypeModal; no Task was edited",
    );
  }
}

async function responsiveChecks(adminPwd, session) {
  const mobile = await contextFor("mobile", "Administrator", adminPwd, true);
  if (session)
    await mobile.addInitScript((value) => {
      if (
        !["localhost", "127.0.0.1", "crm.localhost"].includes(location.hostname)
      )
        return;
      sessionStorage.setItem(
        "beautymatch_customer_v1",
        JSON.stringify({ crm_lead: value.lead }),
      );
      sessionStorage.setItem(
        "beautymatch_open_session_v1",
        JSON.stringify({ crm_lead: value.lead, session_id: value.session }),
      );
    }, session);
  const page = await mobile.newPage();
  await page.goto(session ? "/crm/beautymatch/result" : "/crm/beautymatch");
  await page
    .locator(session ? ".bm-native-product" : ".bm-native-toolbar")
    .first()
    .waitFor();
  await page.evaluate(() => (window.__nativeBeautyMatchTest = "mobile-host"));
  await snapshot(page, "native-mobile-content", !session);
  const headerButton = page.getByRole("button", {
    name: "Mở CRM Lead",
    exact: true,
  });
  if (session) {
    const box = await headerButton.boundingBox();
    assert(box && box.x + box.width <= 391, "Mobile header action clipped");
  }
  await page
    .locator("#app-header")
    .locator("xpath=preceding-sibling::div[1]")
    .getByRole("button")
    .click();
  await nativeLink(page).waitFor();
  assert.equal(await nativeLink(page).count(), 1);
  assert.equal(await page.locator("[data-bm-sidebar-entry]").count(), 0);
  const file = `${output}/native-mobile-sidebar.png`;
  await page.locator('[data-slot="sidebar"]').screenshot({ path: file });
  report.screenshots.push(file);
  await nativeLink(page).click();
  await page.locator(".bm-native-toolbar").waitFor();
  assert.equal(
    await page.evaluate(() => window.__nativeBeautyMatchTest),
    "mobile-host",
  );
  await page.getByRole("link", { name: "Báo cáo tư vấn", exact: true }).click();
  await page.locator('[data-metric="total_sessions"]').waitFor();
  await snapshot(page, "native-mobile-dashboard");
  report.checks.push(
    "Native mobile drawer, content, header action and analytics render without horizontal overflow; sidebar click keeps the host document",
  );

  const dark = await contextFor("dark", "Administrator", adminPwd);
  const desktop = await dark.newPage();
  await desktop.goto("/crm/beautymatch/dashboard");
  await desktop.evaluate(() => localStorage.setItem("theme", "dark"));
  await desktop.reload();
  await desktop.locator('[data-metric="total_sessions"]').waitFor();
  assert.equal(
    await desktop.locator("html").getAttribute("data-theme"),
    "dark",
  );
  await snapshot(desktop, "native-dark-dashboard");
  const axe = await new AxeBuilder({ page: desktop })
    .include(".bm-native")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  report.dark_accessibility = axe.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.length,
  }));
  assert.equal(axe.violations.length, 0, "Dark native dashboard accessibility");
  report.checks.push(
    "Native dark dashboard uses shared CRM tokens and passes the scoped Axe scan",
  );
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 20 && !ready; attempt++) {
    ready = await fetch(`${baseURL}/api/method/ping`)
      .then((r) => r.ok)
      .catch(() => false);
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(ready, "Local Frappe site did not become ready");
  const init = await readFile(
    new URL("../../init.sh", import.meta.url),
    "utf8",
  );
  const adminPwd =
    process.env.BM_TEST_PASSWORD ||
    init.match(/--admin-password\s+([^\s\\]+)/)?.[1];
  const admin = await contextFor("administrator", "Administrator", adminPwd);
  const page = await admin.newPage();
  const marker = await openNative(page);
  await proveHost(page, marker);
  report.checks.push(
    "Real /crm sidebar uses native RouterLink below Dashboard; /crm/beautymatch retains document, layout and sidebar without injected rows or iframe",
  );
  await coreRegression(page, marker);
  let administratorSession;
  if (exercise) {
    const runtime = bench("beautymatch.scripts.frontend_audit.inspect_runtime");
    assert(
      runtime.positive_profile,
      "No real catalog profile available for matching acceptance test",
    );
    administratorSession = await flow(
      admin,
      "administrator",
      "Administrator",
      runtime.positive_profile,
    );
    sales = bench("beautymatch.scripts.sidebar_audit.prepare_sales_user");
    const employee = await contextFor("sales-user", sales.user, sales.password);
    sales.password = undefined;
    await flow(employee, "sales-user", sales.user, runtime.positive_profile);
    report.transactional_task_checks = bench(
      "beautymatch.scripts.frontend_audit.verify_transactional_feedback",
    );
  } else await snapshot(page, "native-overview", true);
  await responsiveChecks(adminPwd, administratorSession);
} catch (error) {
  report.failures.push(
    String(error.message).replace(/[\w.+-]+@[\w.-]+/g, "[email]"),
  );
} finally {
  for (const context of contexts) {
    await context.request.get("/api/method/logout").catch(() => {});
    await context.close();
  }
  await browser.close();
  if (sales?.user) {
    try {
      report.test_user_cleanup = bench(
        "beautymatch.scripts.sidebar_audit.disable_sales_user",
        { user: sales.user },
      );
    } catch {
      report.failures.push("Cannot disable the owned test employee");
    }
  }
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
        leads_created: report.leads_created,
        sessions: report.sessions.length,
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
