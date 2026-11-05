// Explicit local acceptance test: creates six labeled synthetic consultations for one Lead.
// Credentials stay in memory. No existing customer/catalog/settings records are changed.
import { chromium } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import AxeBuilder from "@axe-core/playwright";

const baseURL = process.env.BM_LIVE_BASE_URL || "http://localhost:8000";
assert(
  ["localhost", "127.0.0.1", "crm.localhost"].includes(
    new URL(baseURL).hostname,
  ),
  "Live verification is restricted to the local development site.",
);
const user = process.env.BM_TEST_USER || "Administrator";
let password = process.env.BM_TEST_PASSWORD;
if (!password) {
  // The existing local Compose initializer documents the development password.
  const init = await readFile(
    new URL("../../init.sh", import.meta.url),
    "utf8",
  ).catch(() => "");
  password = init.match(/--admin-password\s+([^\s\\]+)/)?.[1];
}
if (!password)
  throw new Error(
    "Set BM_TEST_USER and BM_TEST_PASSWORD for a dedicated local CRM test account.",
  );
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1100 },
});
const checks = [];
const errors = [];
const urls = [];
const runId = randomUUID().slice(0, 8);
await mkdir("test-results", { recursive: true });
try {
  const login = await context.request.post("/api/method/login", {
    form: { usr: user, pwd: password },
  });
  if (!login.ok())
    throw new Error(
      `Local CRM login failed (${login.status()}); supply BM_TEST_USER and BM_TEST_PASSWORD.`,
    );
  password = undefined;
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  context.on("request", (request) => urls.push(request.url()));
  let generations = 0;
  async function accessible(target, label) {
    const result = await new AxeBuilder({ page: target })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    assert.deepEqual(
      result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => n.target),
      })),
      [],
      `${label}: accessibility`,
    );
    assert(
      await target.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `${label}: overflow`,
    );
  }
  context.on("request", (request) => {
    if (request.url().includes(".generate_recommendations")) generations++;
  });
  async function submitConsultation(
    label,
    category,
    reuse = false,
    retryOnce = false,
  ) {
    if (!reuse) {
      await page.goto("/beautymatch");
      await page.getByRole("button", { name: "Tư vấn khách hàng mới" }).click();
    } else {
      await page.goto("/beautymatch/consultation");
      await page.waitForFunction(
        () =>
          window.beautymatchSelectedLead &&
          !document.getElementById("bm-submit").disabled,
      );
    }
    if (!reuse) {
      await page
        .locator("#bm-full-name")
        .fill(`BeautyMatch Integration Test ${runId} ${label}`);
      await page
        .locator("#bm-email")
        .fill(`beautymatch-test-${runId}-${label}@example.invalid`);
    }
    await page.locator("#bm-skin").selectOption("OILY");
    await page.locator("#bm-sensitivity").selectOption("Sensitive");
    await page.locator('[name="concern_barrier"]').check();
    await page.locator('[name="concern_aging"]').check();
    await page.locator("#bm-category").selectOption(category);
    await page.locator("#bm-budget").fill("2000000");
    await page.locator("#bm-brand").fill("La Roche-Posay");
    await page.locator("#bm-consent").check();
    if (retryOnce) {
      const endpoint =
        "**/api/method/beautymatch.api.frontend.save_consultation";
      await page.route(endpoint, (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: "{}",
        }),
      );
      await page.locator("#bm-submit").click();
      await page.locator("#bm-form-error:not([hidden])").waitFor();
      const before = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("beautymatch_intake_retry_v1")),
      );
      await page.unroute(endpoint);
      await page.reload();
      await page.waitForFunction(
        () =>
          window.beautymatchSelectedLead &&
          !document.getElementById("bm-submit").disabled,
      );
      assert.equal(await page.locator("#bm-category").inputValue(), category);
      assert.equal(await page.locator("#bm-budget").inputValue(), "2000000");
      const after = await page.evaluate(() =>
        JSON.parse(sessionStorage.getItem("beautymatch_intake_retry_v1")),
      );
      assert.deepEqual(after, before);
      checks.push(
        "intake failure + reload preserves the exact payload and request_id",
      );
    }
    const generated = page.waitForResponse(
      (response) => response.url().includes(".generate_recommendations"),
      { timeout: 30000 },
    );
    await page.locator("#bm-submit").click();
    const response = await generated;
    const body = await response.json();
    assert(
      response.ok(),
      `Generate failed (${response.status()}): ${JSON.stringify(body._server_messages || body.exc_type || "")}`,
    );
    await page.waitForURL("**/beautymatch/result");
    await page.locator('#content[aria-busy="false"]').waitFor();
    const handoff = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("beautymatch_pending_v1")),
    );
    assert(
      handoff.crm_lead &&
        handoff.beauty_profile &&
        handoff.request_id &&
        handoff.profile_version,
    );
    assert.equal(body.message.request_id, handoff.request_id);
    assert(body.message.session_id && Array.isArray(body.message.results));
    return { session: body.message, handoff };
  }
  const { session, handoff } = await submitConsultation("positive", "TONER");
  assert(
    session.results.length >= 1 && session.results.length <= 3,
    "Current catalog must yield at least one positive recommendation; run frontend_audit.inspect_runtime first.",
  );
  assert.equal(
    await page.locator(".product-card").count(),
    session.results.length,
  );
  assert(
    !(await page.locator(".inline-alert").count()),
    "Result context must load from the real server.",
  );
  const image = session.results[0].image_url;
  if (image)
    assert.equal(
      await page
        .locator(".product-photo img")
        .first()
        .getAttribute("data-source-url"),
      image,
    );
  checks.push(
    "consultation save + handoff + generation + real product snapshot",
  );
  await page.evaluate(
    (value) =>
      sessionStorage.setItem(
        "beautymatch_result_v1",
        JSON.stringify({
          request_id: value.request_id,
          recommendation_session: value.session_id,
        }),
      ),
    session,
  );
  await page.reload();
  await page.locator('#content[aria-busy="false"]').waitFor();
  assert.equal(generations, 1);
  assert.equal(
    await page.locator(".product-card").count(),
    session.results.length,
  );
  checks.push("legacy session cache + reload without regeneration");
  const feedbackResponse = page.waitForResponse((response) =>
    response.url().includes(".submit_feedback"),
  );
  await page.locator('[data-action="interested"]').first().click();
  const interested = (await (await feedbackResponse).json()).message;
  assert.equal(interested.customer_feedback, "Interested");
  assert(["CREATED", "PENDING"].includes(interested.follow_up_status));
  await page
    .locator(".feedback-status")
    .first()
    .getByText(new RegExp(interested.follow_up_status))
    .waitFor();
  if (interested.follow_up_status === "CREATED")
    assert(
      (await page.locator(".feedback-status").first().textContent()).includes(
        interested.follow_up_task,
      ),
    );
  if (interested.follow_up_status === "PENDING")
    assert(!interested.follow_up_task);
  checks.push(`real Interested feedback: ${interested.follow_up_status}`);

  const dashboard = await context.newPage();
  dashboard.on("pageerror", (error) => errors.push(error.message));
  const reportResponse = dashboard.waitForResponse((response) =>
    response.url().includes("beautymatch.api.dashboard.get_dashboard_data"),
  );
  await dashboard.goto("/beautymatch/dashboard");
  const report = (await (await reportResponse).json()).message;
  await dashboard.locator('#content[aria-busy="false"]').waitFor();
  assert.equal(await dashboard.locator(".kpi").count(), 4);
  assert.equal(await dashboard.locator(".chart-panel").count(), 2);
  assert.equal(await dashboard.locator('input[type="date"]').count(), 0);
  for (const key of [
    "total_sessions",
    "leads_with_profile",
    "interest_rate",
    "average_top1_score",
  ])
    assert.equal(typeof report.kpis[key], "number");
  assert(
    report.charts.top_skin_concerns.length > 0 &&
      report.charts.top_interested_products.length > 0,
  );
  assert(
    (await dashboard.locator(".kpi-value").first().innerText()).includes(
      new Intl.NumberFormat("vi-VN").format(report.kpis.total_sessions),
    ),
  );
  await dashboard.screenshot({
    path: "test-results/live-dashboard-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  checks.push(
    "real dashboard: 4 KPIs + both nonempty charts + explicit all-time scope",
  );

  await page.locator('[data-action="reject"]').first().click();
  let rejectedCalls = 0;
  page.on("request", (request) => {
    if (request.url().includes(".submit_feedback")) rejectedCalls++;
  });
  await page.getByRole("button", { name: "Gửi phản hồi" }).click();
  assert.equal(
    await page
      .locator("#rejection-reason")
      .evaluate((el) => el.validity.valueMissing),
    true,
  );
  assert.equal(rejectedCalls, 0);
  await page.selectOption("#rejection-reason", "Khác");
  const rejectionResponse = page.waitForResponse((response) =>
    response.url().includes(".submit_feedback"),
  );
  await page.getByRole("button", { name: "Gửi phản hồi" }).click();
  const rejected = (await (await rejectionResponse).json()).message;
  assert.equal(rejected.customer_feedback, "Not Interested");
  assert.equal(rejected.follow_up_status, "NOT_APPLICABLE");
  await page.locator("dialog").waitFor({ state: "hidden" });
  checks.push("required rejection reason + real Not Interested persistence");
  await page.locator('[data-action="history"]').click();
  await page.locator(".history-item").first().waitFor();
  await page.locator(".history-item").first().click();
  await page.locator('#content[aria-busy="false"]').waitFor();
  await page.reload();
  await page.locator('#content[aria-busy="false"]').waitFor();
  assert(
    (await page.locator(".feedback-status").first().innerText()).includes(
      "không quan tâm",
    ),
  );
  checks.push("real history + saved feedback after reload");
  const crm = await context.newPage();
  await crm.goto(`/crm/leads/${encodeURIComponent(handoff.crm_lead)}`);
  await crm
    .getByRole("button", { name: "Tư vấn với BeautyMatch", exact: true })
    .waitFor({ timeout: 45000 });
  await crm.getByRole("button", { name: "BeautyMatch", exact: true }).click();
  await crm
    .getByRole("menuitem", { name: "Hồ sơ & lịch sử", exact: true })
    .click();
  await crm.waitForURL("**/beautymatch/customer");
  await crm.locator(".session-card").first().waitFor();
  await accessible(crm, "customer desktop");
  await crm.screenshot({
    path: "test-results/live-customer-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  assert(
    (await crm.locator(".dashboard-heading").innerText()).includes(
      `BeautyMatch Integration Test ${runId}`,
    ),
  );
  await crm.locator('[data-work="consult"]').click();
  await crm.waitForFunction(
    () =>
      window.beautymatchSelectedLead &&
      !document.getElementById("bm-submit").disabled,
  );
  assert.equal(await crm.locator("#bm-email").getAttribute("readonly"), "");
  await accessible(crm, "consultation desktop");
  await crm.setViewportSize({ width: 390, height: 844 });
  await accessible(crm, "consultation mobile");
  await crm.screenshot({
    path: "test-results/live-consultation-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  checks.push(
    "native CRM Lead actions → authorized summary/history → prefilled consultation",
  );
  await crm.close();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.screenshot({
    path: "test-results/live-result-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await dashboard.setViewportSize({ width: 390, height: 844 });
  assert(
    await dashboard.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await dashboard.screenshot({
    path: "test-results/live-dashboard-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  checks.push("real results + dashboard mobile layout");
  await page.goto("/beautymatch/customer");
  await page.locator(".session-card").first().waitFor();
  await accessible(page, "customer mobile");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator('[data-work="session"]').first().click();
  await page.waitForURL("**/beautymatch/result");
  await page.locator('#content[aria-busy="false"]').waitFor();
  checks.push(
    "complete customer history → safely reopened session without a new generation",
  );
  const empty = await submitConsultation("empty", "SUNSCREEN", true, true);
  assert.equal(empty.handoff.crm_lead, handoff.crm_lead);
  assert.equal(empty.session.number_of_recommendations, 0);
  assert.deepEqual(empty.session.results, []);
  await page
    .getByRole("heading", { name: "Chưa tìm thấy sự phù hợp" })
    .waitFor();
  checks.push("real zero-product recommendation is a valid empty state");
  const counts = [];
  for (const count of [3, 2, 1, 0]) {
    await page.goto("/beautymatch");
    if (count === 3) {
      await page.locator("#lead-search").fill(runId);
      await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
      await page.locator(".customer-card").first().waitFor();
      await accessible(page, "workspace mobile");
      await page.screenshot({
        path: "test-results/live-workspace-mobile.png",
        fullPage: true,
        animations: "disabled",
      });
      await page.setViewportSize({ width: 1440, height: 1100 });
      await accessible(page, "workspace desktop");
      await page.screenshot({
        path: "test-results/live-workspace-desktop.png",
        fullPage: true,
        animations: "disabled",
      });
      await page.setViewportSize({ width: 390, height: 844 });
      checks.push(
        "workspace + customer history + consultation: mobile/desktop accessibility and layout",
      );
    }
    await page.locator(`[data-work="sample"][data-count="${count}"]`).click();
    await page.waitForURL("**/beautymatch/consultation");
    await page
      .locator("#bm-full-name")
      .fill(`BeautyMatch Integration Test ${runId} positive`);
    await page
      .locator("#bm-email")
      .fill(`beautymatch-test-${runId}-positive@example.invalid`);
    await page.locator("#bm-consent").check();
    const generated = page.waitForResponse((response) =>
      response.url().includes(".generate_recommendations"),
    );
    await page.locator("#bm-submit").click();
    const result = (await (await generated).json()).message;
    assert.equal(result.results.length, count);
    assert.equal(result.crm_lead, handoff.crm_lead);
    await page.waitForURL("**/beautymatch/result");
    await page.locator('#content[aria-busy="false"]').waitFor();
    assert.equal(await page.locator(".product-card").count(), count);
    counts.push(count);
    if (count === 3)
      await page.screenshot({
        path: "test-results/live-three-products-mobile.png",
        fullPage: true,
        animations: "disabled",
      });
  }
  checks.push(
    "real Frappe catalog scenarios: 3, 2, 1, 0 products; existing Lead reused in every case",
  );
  assert(
    !urls
      .filter(
        (url) =>
          url.includes("/beautymatch") ||
          url.includes("/api/method/beautymatch."),
      )
      .some(
        (url) =>
          url.includes(handoff.crm_lead) ||
          url.includes(handoff.beauty_profile) ||
          url.includes(session.session_id) ||
          url.includes(runId),
      ),
    "Customer identifiers must stay out of URLs.",
  );
  assert.deepEqual(errors, []);
  checks.push("no page errors + no customer identifiers in URLs");
  console.log(
    JSON.stringify(
      {
        passed: checks,
        real_product_count: session.results.length,
        synthetic_consultations_created: 6,
        real_result_counts_verified: counts,
        synthetic_leads_created: 1,
        existing_records_deleted: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await context.request.get("/api/method/logout").catch(() => {});
  await context.close();
  await browser.close();
}
