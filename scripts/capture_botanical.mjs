// Read-only local visual verification. Uses an existing synthetic Lead/session only.
// No customer, consultation, feedback, product, Task or settings records are written.
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";

const baseURL = process.env.BM_LIVE_BASE_URL || "http://localhost:8000";
assert(
  ["localhost", "127.0.0.1", "crm.localhost"].includes(
    new URL(baseURL).hostname,
  ),
  "Visual verification is restricted to the local development site.",
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
if (!password)
  throw new Error(
    "Set BM_TEST_USER and BM_TEST_PASSWORD for a local CRM account.",
  );

const output = "test-results/botanical";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1100 },
});
const report = {
  mode: "real-frappe-read-only",
  business_records_created: 0,
  business_records_updated: 0,
  screenshots: [],
  issues: [],
  page_errors: 0,
  identifier_url_leaks: 0,
  unexpected_api_requests: 0,
};
const privateValues = new Set();
const allowed = new Set([
  "beautymatch.api.frontend.get_workspace",
  "beautymatch.api.frontend.get_customer_context",
  "beautymatch.api.frontend.get_customer_view",
  "beautymatch.api.frontend.read",
  "beautymatch.api.dashboard.get_dashboard_data",
  "beautymatch.scripts.local_demo.get_scenarios",
]);
await context.route("**/api/method/beautymatch.**", async (route) => {
  const request = route.request();
  const method = new URL(request.url()).pathname.split("/api/method/")[1];
  let safe = allowed.has(method);
  if (method === "beautymatch.api.frontend.read") {
    const body = request.postDataJSON();
    safe = [
      "get_recommendation_result",
      "get_result_context",
      "get_customer_history",
      "get_lead_summary",
    ].includes(body?.operation);
  }
  if (!safe) {
    report.unexpected_api_requests++;
    await route.abort();
  } else await route.continue();
});
context.on("page", (page) => page.on("pageerror", () => report.page_errors++));
context.on("request", (request) => {
  const url = request.url();
  if (!url.startsWith(baseURL)) return;
  if (
    [...privateValues].some(
      (value) => url.includes(encodeURIComponent(value)) || url.includes(value),
    )
  )
    report.identifier_url_leaks++;
});

async function api(page, method, args) {
  return page.evaluate(
    async ({ method, args }) => {
      const response = await fetch(`/api/method/${method}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": document.querySelector(
            'meta[name="csrf-token"]',
          ).content,
        },
        credentials: "same-origin",
        body: JSON.stringify(args),
      });
      if (!response.ok)
        throw new Error(`Read-only API returned HTTP ${response.status}`);
      const body = await response.json();
      if (!body.message || body.exc || body.exc_type)
        throw new Error("Read-only API did not return valid data.");
      return body.message;
    },
    { method, args },
  );
}

async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.race([
      Promise.allSettled([...document.images].map((image) => image.decode())),
      new Promise((resolve) => setTimeout(resolve, 12000)),
    ]);
  });
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  const step = Math.max(250, Math.floor(page.viewportSize().height * 0.8));
  for (let y = 0; y < height; y += step) {
    await page.evaluate((top) => scrollTo(0, top), y);
    await page.waitForTimeout(70);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
}

async function capture(page, name) {
  for (const [device, viewport] of Object.entries({
    desktop: { width: 1440, height: 1100 },
    tablet: { width: 768, height: 1024 },
    mobile: { width: 390, height: 844 },
  })) {
    await page.setViewportSize(viewport);
    await settled(page);
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      width: innerWidth,
      document_width: document.documentElement.scrollWidth,
      serif_loaded: document.fonts.check(
        '400 32px "Cormorant Garamond"',
        "Hiểu làn da. Chạm đến vẻ đẹp riêng.",
      ),
      broken_images: [...document.images].filter(
        (img) => img.complete && !img.naturalWidth,
      ).length,
      pending_images: [...document.images].filter((img) => !img.complete)
        .length,
      loaded_product_images: [
        ...document.querySelectorAll(".product-photo img"),
      ].filter((img) => img.complete && img.naturalWidth > 0).length,
      visible_photo_placeholders: [
        ...document.querySelectorAll(".photo-placeholder"),
      ].filter((node) =>
        node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }),
      ).length,
    }));
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const violations = axe.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.length,
      targets: violation.nodes
        .slice(0, 8)
        .map((node) =>
          node.target.map((selector) =>
            typeof selector === "string"
              ? selector.replace(/\[[^\]]*=[^\]]*\]/g, "[attribute]")
              : "nested-frame",
          ),
        ),
    }));
    const path = `${output}/${name}-${device}.png`;
    await page.screenshot({ path, fullPage: true, animations: "disabled" });
    report.screenshots.push({
      page: name,
      device,
      file: path,
      ...metrics,
      accessibility_violations: violations,
    });
    if (metrics.overflow || violations.length)
      report.issues.push({
        page: name,
        device,
        overflow: metrics.overflow,
        violations,
      });
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
}

try {
  const login = await context.request.post("/api/method/login", {
    form: { usr: user, pwd: password },
  });
  password = undefined;
  if (!login.ok())
    throw new Error(`Local CRM login failed (${login.status()}).`);
  const page = await context.newPage();
  await page.goto("/beautymatch", { waitUntil: "domcontentloaded" });
  await page.locator("#lead-search").waitFor();
  const workspace = await api(page, "beautymatch.api.frontend.get_workspace", {
    search: "BeautyMatch Integration Test",
    start: 0,
  });
  let lead, session;
  for (const candidate of workspace.leads) {
    if (
      ![candidate.first_name, candidate.last_name]
        .filter(Boolean)
        .join(" ")
        .startsWith("BeautyMatch Integration Test")
    )
      continue;
    const view = await api(page, "beautymatch.api.frontend.get_customer_view", {
      crm_lead: candidate.name,
      start: 0,
    });
    let sessions = view.history.sessions;
    for (
      let start = 10;
      !sessions.some((row) => row.results.length === 3) &&
      start < view.history.total;
      start += 10
    ) {
      const next = await api(
        page,
        "beautymatch.api.frontend.get_customer_view",
        { crm_lead: candidate.name, start },
      );
      sessions = sessions.concat(next.history.sessions);
    }
    session = sessions.find((row) => row.results.length === 3);
    if (session) {
      lead = candidate;
      break;
    }
  }
  assert(
    lead && session,
    "No existing synthetic Lead with a three-product session is available; complete the authorized live test first.",
  );
  privateValues.add(lead.name);
  privateValues.add(session.session_id);

  await page.locator("#lead-search").fill(lead.name);
  const filtered = page.waitForResponse(
    (response) =>
      response.url().endsWith("beautymatch.api.frontend.get_workspace") &&
      response.request().postDataJSON()?.search === lead.name,
  );
  await page.locator('#customer-search button[type="submit"]').click();
  await filtered;
  await page.locator(".customer-card").first().waitFor();
  assert.equal(
    await page.locator(".customer-card").count(),
    1,
    "Overview screenshots must contain only the selected synthetic Lead.",
  );
  assert.equal(
    await page.locator('[data-work="select"]').getAttribute("data-lead"),
    lead.name,
  );
  await capture(page, "overview");

  await page.locator('[data-work="select"]').click();
  await page.waitForURL("**/beautymatch/customer");
  await page.locator(".session-card").first().waitFor();
  await capture(page, "customer");

  await page.evaluate(
    ({ lead, session }) => {
      sessionStorage.removeItem("beautymatch_pending_v1");
      sessionStorage.removeItem("beautymatch_result_v1");
      sessionStorage.setItem(
        "beautymatch_customer_v1",
        JSON.stringify({ crm_lead: lead }),
      );
      sessionStorage.setItem(
        "beautymatch_open_session_v1",
        JSON.stringify({ session_id: session, crm_lead: lead }),
      );
    },
    { lead: lead.name, session: session.session_id },
  );
  await page.goto("/beautymatch/result", { waitUntil: "domcontentloaded" });
  await page.locator('#content[aria-busy="false"]').waitFor();
  assert.equal(await page.locator(".product-card").count(), 3);
  await capture(page, "result");

  await page.goto("/beautymatch/dashboard", { waitUntil: "domcontentloaded" });
  await page.locator('#content[aria-busy="false"]').waitFor();
  assert.equal(await page.locator(".kpi").count(), 4);
  assert.equal(await page.locator(".chart-panel").count(), 2);
  await capture(page, "dashboard");

  await page.goto("/beautymatch/consultation", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(
    () =>
      window.beautymatchSelectedLead &&
      !document.getElementById("bm-submit").disabled,
  );
  assert(
    (await page.locator("#bm-full-name").inputValue()).startsWith(
      "BeautyMatch Integration Test",
    ),
  );
  await capture(page, "consultation");
} catch (error) {
  report.issues.push({
    fatal: true,
    type: error.name,
    message: String(error.message)
      .replace(/CRM-LEAD-[\w-]+/g, "[synthetic-lead]")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]+/g, "[email]"),
  });
} finally {
  await context.request.get("/api/method/logout").catch(() => {});
  await context.close();
  await browser.close();
  report.passed =
    !report.issues.length &&
    !report.page_errors &&
    !report.identifier_url_leaks &&
    !report.unexpected_api_requests &&
    report.screenshots.length === 15;
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
