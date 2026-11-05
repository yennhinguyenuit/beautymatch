// Real local CRM visual audit. Read-only unless --exercise-crud is explicitly set.
// That flag creates one synthetic Lead and updates only that newly created Lead.
// Customer table values are masked in screenshots; only an existing synthetic Lead is opened.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const phase = process.argv.includes("--phase")
  ? process.argv[process.argv.indexOf("--phase") + 1]
  : "after";
assert(["before", "after"].includes(phase), "Use --phase before or after.");
const exerciseCrud = process.argv.includes("--exercise-crud");
assert(
  !exerciseCrud || phase === "after",
  "CRUD verification is available only in the after phase.",
);
const baseURL = process.env.BM_LIVE_BASE_URL || "http://localhost:8000";
assert(
  ["localhost", "127.0.0.1", "crm.localhost"].includes(
    new URL(baseURL).hostname,
  ),
  "This audit is restricted to the local development site.",
);
const user = process.env.BM_TEST_USER || "Administrator";
let password = process.env.BM_TEST_PASSWORD;
if (!password) {
  const init = await readFile(
    new URL("../../init.sh", import.meta.url),
    "utf8",
  ).catch(() => "");
  password = init.match(/--admin-password\s+([^\s\\]+)/)?.[1];
}
assert(
  password,
  "Set BM_TEST_USER and BM_TEST_PASSWORD for the local account.",
);
const output = `test-results/crm-botanical/${phase}`;
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1000 },
});
await context.addInitScript(() => {
  // Init scripts also run in opaque embedded documents; only touch our real origin.
  if (!["localhost", "127.0.0.1", "crm.localhost"].includes(location.hostname))
    return;
  localStorage.setItem("crm_persona_captured", "1");
});
const report = {
  phase,
  mode: exerciseCrud
    ? "real-frappe-crm-synthetic-lead-create-update"
    : "real-frappe-crm-read-only",
  business_records_created: 0,
  business_records_updated: 0,
  screenshot_privacy:
    "Native customer table cells are masked; Lead detail uses an existing synthetic test Lead only.",
  screenshots: [],
  checks: [],
  errors: [],
  failed_requests: [],
  native_api_results: [],
  interrupted_reads: [],
  route_failures: [],
};
let activeRoute = "login";
let activeDevice = "desktop";
const responseChecks = [];
function safe(value) {
  return String(value)
    .replace(/CRM-LEAD-[\w-]+/g, "[synthetic-lead]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]+/g, "[email]");
}
context.on("page", (page) => {
  page.on("pageerror", (error) =>
    report.errors.push({ route: activeRoute, message: safe(error.message) }),
  );
  page.on("requestfailed", (request) => {
    if (
      request.url().startsWith(baseURL) &&
      !request.failure()?.errorText.includes("ERR_ABORTED")
    )
      report.failed_requests.push({
        route: activeRoute,
        path: new URL(request.url()).pathname,
        failure: request.failure()?.errorText,
      });
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith("/api/method/crm.")) return;
    if (
      ![
        "/api/method/crm.api.doc.get_data",
        "/api/method/crm.api.dashboard.get_dashboard",
      ].includes(path)
    )
      return;
    const route = activeRoute;
    const device = activeDevice;
    responseChecks.push(
      (async () => {
        const body = await response.json();
        const args = response.request().postDataJSON();
        const message = body.message;
        const entry = {
          route,
          device,
          method: path.slice("/api/method/".length),
          status: response.status(),
          doctype: args?.doctype || null,
          rows: Array.isArray(message?.data) ? message.data.length : null,
          total_count: message?.total_count ?? null,
          valid: response.ok() && !body.exc_type && !!message,
        };
        report.native_api_results.push(entry);
        if (!entry.valid)
          report.route_failures.push({
            route,
            device,
            reason: "Native CRM data API failed",
            method: entry.method,
            status: entry.status,
          });
      })().catch((error) => {
        // Chrome can discard a body's resource handle during a hard preference
        // reload. Record this test interruption separately from API failures.
        if (
          /No resource with given identifier found|Request content was evicted|net::ERR_ABORTED/.test(
            String(error.message),
          )
        )
          report.interrupted_reads.push({
            route,
            device,
            reason: "Browser navigation canceled the response-body audit",
          });
        else
          report.route_failures.push({
            route,
            device,
            reason: "Could not validate native CRM JSON response",
          });
      }),
    );
  });
});

async function settle(page) {
  await page.locator("#app").waitFor();
  await page.waitForTimeout(1400);
  const help = page
    .locator(".fixed.z-50.right-0")
    .filter({ hasText: "Getting started" });
  if (await help.isVisible()) {
    // Native close changes only Vue's local `show` ref; it does not skip onboarding.
    await help.locator(":scope > div:first-child button").last().click();
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.mouse.move(0, 0);
}

async function nativeApi(page, method, args) {
  return page.evaluate(
    async ({ method, args }) => {
      const response = await fetch(`/api/method/${method}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token":
            window.csrf_token ||
            document.querySelector('meta[name="csrf-token"]')?.content,
        },
        body: JSON.stringify(args),
      });
      if (!response.ok)
        throw new Error(`Native read API returned ${response.status}`);
      const body = await response.json();
      if (body.exc_type)
        throw new Error(`Native read API returned ${body.exc_type}`);
      return body.message;
    },
    { method, args },
  );
}

async function capture(page, name, device) {
  await settle(page);
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    width: innerWidth,
    document_width: document.documentElement.scrollWidth,
    mounted: !!document.querySelector("#app")?.children.length,
    dark:
      document.documentElement.dataset.theme === "dark" ||
      document.documentElement.classList.contains("dark"),
    theme_loaded:
      document.documentElement.classList.contains("bm-crm") &&
      !!document.querySelector("link#beautymatch-crm-theme"),
    forest_token: getComputedStyle(document.documentElement)
      .getPropertyValue("--bm-crm-forest")
      .trim()
      .toLowerCase(),
    surface_forest_token: getComputedStyle(document.documentElement)
      .getPropertyValue("--surface-gray-10")
      .trim()
      .toLowerCase(),
    style_markers: [...document.querySelectorAll('link[rel="stylesheet"]')]
      .map((node) => node.getAttribute("href"))
      .filter((href) => href?.includes("beautymatch")),
  }));
  if (phase === "after" && !metrics.theme_loaded)
    report.route_failures.push({
      route: name,
      device,
      reason: "BeautyMatch CRM stylesheet did not load in the native SPA",
    });
  if (
    phase === "after" &&
    (metrics.forest_token !== "#163f35" ||
      metrics.surface_forest_token !== (metrics.dark ? "#d9efb9" : "#163f35"))
  )
    report.route_failures.push({
      route: name,
      device,
      reason: "BeautyMatch forest tokens were not applied to the native SPA",
    });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  const violations = axe.violations.map((row) => ({
    id: row.id,
    impact: row.impact,
    nodes: row.nodes.length,
    targets: row.nodes
      .slice(0, 6)
      .map((node) =>
        node.target.map((target) =>
          typeof target === "string"
            ? target.replace(/\[[^\]]*=[^\]]*\]/g, "[attribute]")
            : "nested-frame",
        ),
      ),
  }));
  const file = `${output}/${name}-${device}.png`;
  // Native Frappe ListRow renders customer fields under .overflow-x-hidden.
  // Mask each data cell, preserving row spacing, borders and table header visuals.
  const rowCells = [
    "leads",
    "leads-dark",
    "contacts",
    "deals",
    "navigation",
    "lead-create",
  ].includes(name)
    ? page.locator(
        'a[href*="/crm/leads/"]:not([href*="/view/"]):not([data-slot="sidebar"] *) :is(.overflow-x-hidden,.truncate), a[href*="/crm/contacts/"]:not([href*="/view/"]):not([data-slot="sidebar"] *) :is(.overflow-x-hidden,.truncate), a[href*="/crm/deals/"]:not([href*="/view/"]):not([data-slot="sidebar"] *) :is(.overflow-x-hidden,.truncate)',
      )
    : page.locator("[data-no-such-mask]");
  const taskCells =
    name === "tasks"
      ? page.locator(
          "#app .h-full.overflow-y-auto button :is(.overflow-x-hidden,.truncate)",
        )
      : page.locator("[data-no-such-mask]");
  const contactText = page
    .getByText(/[\w.+-]+@[\w.-]+\.[A-Za-z]+|(?:\+?\d[\d ()-]{7,}\d)/)
    .filter({ hasNot: page.locator("button") });
  // Masking text locators can cover large ancestors. Only match leaf elements.
  const sensitiveLeaves = contactText.locator("xpath=self::*[not(*)]");
  await page.screenshot({
    path: file,
    fullPage: true,
    animations: "disabled",
    mask: [rowCells, taskCells, sensitiveLeaves],
    maskColor: "#d5ded1",
  });
  report.screenshots.push({
    page: name,
    device,
    file,
    ...metrics,
    accessibility_violations: violations,
  });
  if (!metrics.mounted || metrics.overflow)
    report.route_failures.push({
      route: name,
      device,
      reason: !metrics.mounted
        ? "SPA did not mount"
        : "Document has horizontal overflow",
    });
}

async function nativeBeautyMatchAction(page, label) {
  const direct = page.getByRole("button", { name: label, exact: true });
  if (await direct.isVisible()) return direct.click();
  await page.getByRole("button", { name: "BeautyMatch", exact: true }).click();
  await page
    .getByRole("menuitem", { name: label, exact: true })
    .or(page.getByRole("button", { name: label, exact: true }))
    .first()
    .click();
}

async function headerControlsVisible(page, lead, leadPath) {
  const native = await nativeApi(page, "frappe.client.get", {
    doctype: "CRM Lead",
    name: lead,
  });
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(leadPath, { waitUntil: "domcontentloaded" });
    await settle(page);
    const header = page.locator("#app-header");
    for (const name of [
      "Tư vấn với BeautyMatch",
      "BeautyMatch",
      "Convert to Deal",
      native.status,
    ]) {
      const control = header.getByRole("button", { name, exact: true });
      await control.waitFor();
      const box = await control.boundingBox();
      assert(
        box &&
          box.x >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y >= 0 &&
          box.y + box.height <= 1001,
        `Native Lead header control '${name}' is clipped at ${width}px`,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  report.checks.push(
    "Native Lead status and Convert controls, primary consultation and grouped BeautyMatch actions remain inside the viewport at 1440px and 1024px",
  );
}

async function checkBeautyMatch(page, lead) {
  activeRoute = "beautymatch-integration";
  activeDevice = "desktop";
  await page.setViewportSize({ width: 1440, height: 1000 });
  const leadPath = `/crm/leads/${encodeURIComponent(lead)}`;
  await page.goto(leadPath, { waitUntil: "domcontentloaded" });
  await settle(page);
  await headerControlsVisible(page, lead, leadPath);
  const insights = page.locator(".bm-crm-insights");
  await insights.waitFor({ timeout: 30000 });
  const view = await nativeApi(
    page,
    "beautymatch.api.frontend.get_customer_view",
    { crm_lead: lead, start: 0 },
  );
  assert.equal(
    await insights.locator(".bm-crm-stat strong").first().textContent(),
    new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
      view.summary.total_sessions,
    ),
  );
  assert.equal(
    await insights.locator(".bm-crm-stat strong").nth(1).textContent(),
    new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
      view.summary.interested_products.length,
    ),
  );
  for (const heading of [
    "Hồ sơ làn da",
    "Phiên tư vấn gần đây",
    "Sản phẩm đã quan tâm",
    "Công việc chăm sóc",
  ])
    assert.equal(
      await insights
        .getByRole("heading", { name: heading, exact: true })
        .count(),
      1,
    );
  for (const link of await insights.locator(".bm-crm-tasks a").all())
    assert.match(await link.getAttribute("href"), /^\/app\/crm-task\/[^/?#]+$/);
  const ownAxe = await new AxeBuilder({ page })
    .include(".bm-crm-insights")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  report.beautymatch_panel_accessibility = ownAxe.violations.map(
    (violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
    }),
  );
  assert.equal(
    report.beautymatch_panel_accessibility.length,
    0,
    "BeautyMatch's own native Lead panel has accessibility violations",
  );
  await insights.scrollIntoViewIfNeeded();
  await capture(page, "lead-insights", "desktop");
  report.checks.push(
    "Native Lead BeautyMatch panel matches permission-checked session and interest totals; profile, history, products and task sections render",
  );

  const sessionIndex = view.history.sessions
    .slice(0, 3)
    .findIndex((row) => row.results.length > 0);
  assert(
    sessionIndex >= 0,
    "The existing synthetic Lead needs a non-empty recent session to verify the real result link without generating new data",
  );
  const existingSession = view.history.sessions[sessionIndex];
  const resultLink = insights
    .locator('a[data-bm-action="result"]')
    .nth(sessionIndex);
  assert.equal(await resultLink.getAttribute("href"), "/beautymatch/result");
  assert.equal(
    await resultLink.getAttribute("data-bm-session"),
    existingSession.session_id,
    "Native HTML sanitizer removed the persisted session metadata",
  );
  const generationRequests = [];
  const onRequest = (request) => {
    if (request.url().includes("generate_recommendations"))
      generationRequests.push(true);
  };
  page.on("request", onRequest);
  await resultLink.click();
  await page.waitForURL("**/beautymatch/result");
  await page.locator('#content[aria-busy="false"]').waitFor();
  assert.equal(
    await page.locator(".product-card").count(),
    existingSession.results.length,
  );
  assert.deepEqual(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("beautymatch_open_session_v1")),
    ),
    { crm_lead: lead, session_id: existingSession.session_id },
  );
  assert.equal(new URL(page.url()).search, "");
  assert.equal(
    generationRequests.length,
    0,
    "Opening persisted CRM history unexpectedly generated a new recommendation",
  );
  page.off("request", onRequest);
  report.checks.push(
    "Own native HTML result link retains sanitized data attributes, restores the existing session through sessionStorage, loads real product cards and generates no new consultation",
  );

  await page.goto(leadPath, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator(".bm-crm-insights .bm-crm-stat").first().waitFor();

  const refreshed = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith("/api/method/beautymatch.api.frontend.get_customer_view") &&
      response.ok(),
  );
  await nativeBeautyMatchAction(page, "Làm mới BeautyMatch");
  await refreshed;
  await insights.waitFor();
  report.checks.push(
    "Native Lead BeautyMatch refresh action reads the real customer API",
  );

  await page
    .getByRole("button", { name: "Tư vấn với BeautyMatch", exact: true })
    .click();
  await page.waitForURL("**/beautymatch/consultation");
  await page.waitForFunction(() => !!window.beautymatchSelectedLead);
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("beautymatch_customer_v1"))?.crm_lead,
    ),
    lead,
  );
  assert.equal(new URL(page.url()).search, "");
  report.checks.push(
    "Native Lead consultation action opens the real prefilled consultation with Lead in sessionStorage and no customer identifiers in the URL",
  );

  await page.goto(leadPath, { waitUntil: "domcontentloaded" });
  await settle(page);
  await nativeBeautyMatchAction(page, "Hồ sơ & lịch sử");
  await page.waitForURL("**/beautymatch/customer");
  await page.locator(".session-card").first().waitFor();
  assert.equal(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("beautymatch_customer_v1"))?.crm_lead,
    ),
    lead,
  );
  assert.equal(new URL(page.url()).search, "");
  report.checks.push(
    "Native Lead history action opens the real BeautyMatch customer history for the same selected Lead",
  );

  await page.goto("/crm/leads/view/list", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.locator("button.h-12").first().click();
  const entry = page
    .getByRole("menuitem", { name: "BeautyMatch", exact: true })
    .or(page.getByRole("button", { name: "BeautyMatch", exact: true }));
  await entry.first().waitFor();
  await capture(page, "navigation", "desktop");
  const isWorkspace = (url) =>
    url.pathname.replace(/\/$/, "") === "/beautymatch";
  // The installed native dropdown calls window.open(route, ''), which Chrome
  // opens in a new tab. Also accept same-tab navigation if CRM corrects that later.
  const destinationPromise = Promise.race([
    page.waitForEvent("popup", { timeout: 15000 }).then(async (popup) => {
      await popup.waitForURL(isWorkspace, { waitUntil: "domcontentloaded" });
      return popup;
    }),
    page
      .waitForURL(isWorkspace, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      .then(() => page),
  ]);
  await entry.first().click();
  const destination = await destinationPromise;
  await destination.locator("#lead-search").waitFor();
  assert.equal(
    await destination.locator("html.bm-crm").count(),
    0,
    "Native CRM theme scope leaked into the BeautyMatch page",
  );
  assert.equal(
    await destination.locator("#beautymatch-crm-theme").count(),
    0,
    "Native CRM stylesheet leaked into the BeautyMatch page",
  );
  if (destination !== page) await destination.close();
  report.checks.push(
    "Supported native CRM brand dropdown BeautyMatch entry opens the real BeautyMatch workspace",
  );
  activeRoute = "mobile-beautymatch-panel";
  activeDevice = "mobile";
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(leadPath, { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("tab", { name: "Details", exact: true }).click();
  const mobileInsights = page.locator(".bm-crm-insights");
  await mobileInsights.waitFor();
  await mobileInsights.scrollIntoViewIfNeeded();
  const panelGeometry = await mobileInsights.evaluate((node) => {
    const control = node.closest(".html-control");
    const style = control && getComputedStyle(control);
    return {
      content_height: Math.round(node.getBoundingClientRect().height),
      control_height:
        control && Math.round(control.getBoundingClientRect().height),
      overflow: style?.overflowY,
      scroll_height: control?.scrollHeight,
      client_height: control?.clientHeight,
    };
  });
  assert(
    panelGeometry.control_height > 200,
    "The native mobile HTML field clips the BeautyMatch panel into an unusable short box",
  );
  assert(
    panelGeometry.overflow !== "hidden" ||
      panelGeometry.scroll_height <= panelGeometry.client_height + 1,
    "The native mobile BeautyMatch panel hides its history and task content",
  );
  report.mobile_panel_geometry = panelGeometry;
  await capture(page, "lead-insights", "mobile");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await mobileInsights
    .locator(".bm-crm-button")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        transition: getComputedStyle(node).transitionDuration,
        animation: getComputedStyle(node).animationName,
      })),
    );
  assert(
    motion.length > 0 &&
      motion.every(
        (row) => row.transition === "0s" && row.animation === "none",
      ),
    "BeautyMatch controls do not respect reduced motion",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  report.checks.push(
    "Native mobile Details tab exposes the real BeautyMatch panel without a clipped HTML field; own controls respect prefers-reduced-motion",
  );

  activeRoute = "dark-preference";
  activeDevice = "desktop";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/crm/leads/view/list", { waitUntil: "domcontentloaded" });
  await settle(page);
  const priorTheme = await page.evaluate(() => localStorage.getItem("theme"));
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await capture(page, "leads-dark", "desktop");
  await page.evaluate((value) => {
    if (value === null) localStorage.removeItem("theme");
    else localStorage.setItem("theme", value);
  }, priorTheme);
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  report.checks.push(
    "Native dark theme applies the intended accessible Botanical tokens; test restores the original browser preference",
  );
}

async function checkCreateUpdate(page) {
  activeRoute = "synthetic-lead-crud";
  activeDevice = "desktop";
  await page.goto("/crm/leads/view/list", { waitUntil: "domcontentloaded" });
  await settle(page);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("heading", { name: "Create Lead", exact: true })
    .waitFor();
  const marker = `BeautyMatch CRM Visual Test ${Date.now()}`;
  await dialog.getByPlaceholder(/^(?:Enter )?First Name$/).fill(marker);
  const email = dialog.getByPlaceholder(/^(?:Enter )?Email$/);
  if (await email.count())
    await email.fill(`bm-crm-visual-${Date.now()}@example.invalid`);
  await capture(page, "lead-create", "desktop");
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/method/frappe.client.insert") &&
      response.request().postData()?.includes(marker),
  );
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  const insertResponse = await createdResponse;
  const created = (await insertResponse.json()).message;
  assert(
    insertResponse.ok() && created?.doctype === "CRM Lead" && created.name,
    "Native Lead creation did not return the actual saved CRM Lead",
  );
  report.business_records_created++;
  report.synthetic_lead = { name: created.name, marker, retained: true };
  assert.equal(created.first_name, marker);
  await page.waitForURL(
    (url) => url.pathname === `/crm/leads/${encodeURIComponent(created.name)}`,
  );
  await settle(page);
  const jobTitle = page
    .getByPlaceholder(/^(?:Add |Enter )?Job Title(?:\.\.\.)?$/)
    .first();
  await jobTitle.waitFor();
  const title = "Kiểm thử giao diện Botanical Cinema";
  const saveResponse = page.waitForResponse(
    (response) =>
      [
        "/api/method/frappe.client.save",
        "/api/method/frappe.client.set_value",
      ].includes(new URL(response.url()).pathname) &&
      response.request().postData()?.includes(created.name),
  );
  await jobTitle.fill(title);
  await jobTitle.press("Tab");
  const response = await saveResponse;
  const saved = await response.json();
  assert(response.ok() && !saved.exc_type, "Native Lead field update failed");
  report.business_records_updated++;
  const persisted = await nativeApi(page, "frappe.client.get", {
    doctype: "CRM Lead",
    name: created.name,
  });
  assert.equal(
    persisted.first_name,
    marker,
    "The synthetic record marker changed unexpectedly",
  );
  assert.equal(
    persisted.job_title,
    title,
    "The native editable side-panel value did not persist through the real API",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page);
  assert.equal(
    await page
      .getByPlaceholder(/^(?:Add |Enter )?Job Title(?:\.\.\.)?$/)
      .first()
      .inputValue(),
    title,
  );
  report.checks.push(
    "Created one clearly labeled synthetic Lead through the native Create dialog; updated only that new Lead through the native editable side panel; real API and reload confirmed persistence",
  );
}

async function verifyPriorCrud(page) {
  const source = "test-results/crm-botanical/crud-report.json";
  const previous = await readFile(source, "utf8")
    .then(JSON.parse)
    .catch(() => null);
  if (
    !previous?.synthetic_lead ||
    previous.business_records_created !== 1 ||
    previous.business_records_updated !== 1
  )
    return;
  assert(
    previous.synthetic_lead.marker.startsWith("BeautyMatch CRM Visual Test "),
    "Prior CRUD evidence is not a synthetic BeautyMatch test Lead",
  );
  const persisted = await nativeApi(page, "frappe.client.get", {
    doctype: "CRM Lead",
    name: previous.synthetic_lead.name,
  });
  assert.equal(persisted.first_name, previous.synthetic_lead.marker);
  assert.equal(persisted.job_title, "Kiểm thử giao diện Botanical Cinema");
  report.prior_crud_verification = {
    source,
    original_run_passed: previous.passed,
    original_records_created: previous.business_records_created,
    original_records_updated: previous.business_records_updated,
    synthetic_lead: previous.synthetic_lead.name,
    persistence_verified: true,
    business_writes_in_this_run: 0,
  };
  report.checks.push(
    "Independent read-only API check confirms the prior native-UI-created synthetic Lead and native-UI-updated Job Title are still persisted; no records changed in this run",
  );
}

try {
  const login = await context.request.post("/api/method/login", {
    form: { usr: user, pwd: password },
  });
  password = undefined;
  assert(login.ok(), `Local CRM login failed (${login.status()}).`);
  const page = await context.newPage();
  await page.goto("/crm/leads", { waitUntil: "domcontentloaded" });
  await settle(page);
  assert(
    new URL(page.url()).pathname.startsWith("/crm/leads"),
    "Native CRM authentication/routing failed.",
  );
  report.checks.push("Authenticated real native CRM SPA loaded");
  const leads = await nativeApi(page, "frappe.client.get_list", {
    doctype: "CRM Lead",
    filters: [["first_name", "like", "BeautyMatch Integration Test%"]],
    fields: ["name"],
    order_by: "modified desc",
    limit_page_length: 1,
  });
  assert(
    leads?.length,
    "No existing synthetic test Lead is available; no records were created.",
  );
  const lead = leads[0].name;

  for (const device of ["desktop", "mobile"]) {
    activeDevice = device;
    await page.setViewportSize(
      device === "desktop"
        ? { width: 1440, height: 1000 }
        : { width: 390, height: 844 },
    );
    // MobileLayout and MobileLead are chosen at mount, so each device gets real navigation/reload.
    for (const [name, path] of [
      ["dashboard", "/crm/dashboard"],
      ["leads", "/crm/leads/view/list"],
      ["contacts", "/crm/contacts/view/list"],
      ["deals", "/crm/deals/view/list"],
      ["tasks", "/crm/tasks/view/list"],
      ["lead", `/crm/leads/${encodeURIComponent(lead)}`],
    ]) {
      activeRoute = name;
      try {
        const response = await page.goto(path, {
          waitUntil: "domcontentloaded",
        });
        assert(response?.ok(), `Route returned HTTP ${response?.status()}`);
        await settle(page);
        assert(
          !new URL(page.url()).pathname.includes("/login"),
          "Route redirected to login",
        );
        await capture(page, name, device);
        report.checks.push(`${name} ${device}: real native route rendered`);
      } catch (error) {
        report.route_failures.push({
          route: name,
          device,
          message: safe(error.message),
        });
      }
    }
  }
  // Exercise the native quick filter without saving any view or changing records.
  activeRoute = "lead-search";
  activeDevice = "desktop";
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/crm/leads/view/list", { waitUntil: "domcontentloaded" });
  await settle(page);
  const nameFilter = page
    .getByPlaceholder("Full Name", { exact: true })
    .first();
  await nameFilter.waitFor();
  const filtered = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/method/crm.api.doc.get_data") &&
      response.request().postData()?.includes("BeautyMatch Integration Test"),
  );
  await nameFilter.fill("BeautyMatch Integration Test");
  const filteredBody = await (await filtered).json();
  assert(
    Array.isArray(filteredBody.message?.data),
    "Native Lead name search did not return rows",
  );
  assert(
    filteredBody.message.data.length > 0,
    "Native Lead search did not find existing synthetic test data",
  );
  const cleared = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/method/crm.api.doc.get_data") &&
      !response.request().postData()?.includes("BeautyMatch Integration Test"),
  );
  await nameFilter.fill("");
  await cleared;
  report.checks.push(
    "Native Lead quick filter returned existing synthetic data and cleared successfully without saving a view",
  );
  if (phase === "after") await checkBeautyMatch(page, lead);
  if (phase === "after" && !exerciseCrud) await verifyPriorCrud(page);
  if (exerciseCrud) await checkCreateUpdate(page);
} catch (error) {
  report.route_failures.push({ fatal: true, message: safe(error.message) });
} finally {
  await Promise.allSettled(responseChecks);
  if (phase === "after")
    for (const device of ["desktop", "mobile"])
      for (const route of [
        "dashboard",
        "leads",
        "contacts",
        "deals",
        "tasks",
      ]) {
        if (
          !report.native_api_results.some(
            (row) => row.route === route && row.device === device && row.valid,
          )
        )
          report.route_failures.push({
            route,
            device,
            reason:
              "No successful real native CRM data response was observed for this view",
          });
      }
  await context.request.get("/api/method/logout").catch(() => {});
  await context.close();
  await browser.close();
  report.passed =
    !report.route_failures.length &&
    !report.errors.length &&
    !report.failed_requests.length &&
    report.screenshots.length ===
      (phase === "before" ? 12 : exerciseCrud ? 17 : 16);
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        phase,
        passed: report.passed,
        screenshots: report.screenshots.length,
        checks: report.checks.length,
        business_records_created: report.business_records_created,
        business_records_updated: report.business_records_updated,
        native_api_responses: report.native_api_results.length,
        page_errors: report.errors,
        failed_requests: report.failed_requests,
        interrupted_reads: report.interrupted_reads,
        failures: report.route_failures,
        report: `${output}/report.json`,
      },
      null,
      2,
    ),
  );
  if (!report.passed) process.exitCode = 1;
}
