// Local Docker + actual Portal/CRM UI. Only external image CDN requests are blocked.
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const output = "test-results/demo-photos";
await mkdir(output, { recursive: true });
const credentials = JSON.parse(
  await readFile(".local/seminar-credentials.json", "utf8"),
);
const report = {
  checks: [],
  screenshots: [],
  errors: [],
  failures: [],
  products: [],
};
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
const rows = (doctype, filters = {}) =>
  bench("frappe.get_all", {
    doctype,
    filters,
    fields: ["*"],
    order_by: "name asc",
    limit_page_length: 0,
  });
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts = [];
async function login(role) {
  const ctx = await browser.newContext({
    baseURL: "http://localhost:8000",
    viewport: { width: 1440, height: 1000 },
  });
  contexts.push(ctx);
  await ctx.route(/https:\/\/media\.(?:hcdn|hasaki)\.vn\//, (route) =>
    route.abort(),
  );
  await ctx.addInitScript(() =>
    localStorage.setItem("crm_persona_captured", "1"),
  );
  const p = await ctx.newPage();
  p.on("pageerror", (error) =>
    report.errors.push({ role, message: error.message }),
  );
  const customer = role === "customer";
  await p.goto(
    customer ? "/beautymatch/portal/" : "/login?redirect-to=/crm/beautymatch",
  );
  await p
    .locator(customer ? "[name=usr]" : "#login_email")
    .fill(credentials[role].login);
  await p
    .locator(customer ? "[name=pwd]" : "#login_password")
    .fill(credentials[role].password);
  await p
    .locator(customer ? "#portal-login button[type=submit]" : ".btn-login")
    .click();
  await p
    .locator(customer ? "#portal-form:not([hidden])" : ".bm-native-tabs")
    .waitFor();
  if (!customer) await closeHelp(p);
  return p;
}
async function closeHelp(page) {
  const panel = page.locator(".fixed.z-50.right-0");
  if (await panel.isVisible()) {
    await panel.locator(":scope > div:first-child button").last().click();
    await panel.waitFor({ state: "hidden" });
  }
}
async function photos(page, selector) {
  const cards = page.locator(selector);
  await expect(cards).toHaveCount(3);
  const actual = [];
  for (const card of await cards.all()) {
    const img = card.locator("img");
    await img.scrollIntoViewIfNeeded();
    await expect(img).toBeVisible();
    await expect
      .poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0))
      .toBe(true);
    const src = await img.getAttribute("src");
    assert(src.startsWith("/assets/beautymatch/images/catalog/"), src);
    actual.push(src);
  }
  assert.equal(new Set(actual).size, 3);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  return actual;
}
async function shot(page, name, selector, viewport = false) {
  await closeHelp(page);
  const file = `${output}/${name}.png`;
  if (viewport) {
    // CRM scrolls inside its shell; a tall element clip includes unpainted
    // offscreen content. Capture the visible viewport after scrolling instead.
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: file, animations: "disabled" });
  } else {
    await page
      .locator(selector)
      .screenshot({ path: file, animations: "disabled" });
  }
  report.screenshots.push(file);
}
try {
  const catalogBefore = hash(
    rows("Product Profile", { product_code: ["not like", "BM-DEMO-%"] }),
  );
  const oldSessions = rows("Recommendation Session");
  const oldItems = rows("Recommendation Item");
  const before = bench(
    "beautymatch.scripts.self_service_audit.snapshot",
  ).counts;
  const ready = bench("beautymatch.scripts.seed_demo.prepare_self_service");
  assert.equal(
    bench("beautymatch.scripts.seed_demo.prepare_self_service").session_id,
    ready.session_id,
  );
  report.checks.push(
    "Preparing the image-complete demo twice reuses the session",
  );

  const p = await login("customer");
  assert.equal(
    await p.locator("[name=full_name]").inputValue(),
    "Nguyễn Minh Anh",
  );
  assert.equal(await p.locator("[name=skin_type]").inputValue(), "COMBINATION");
  assert.equal(await p.locator("[name=max_budget]").inputValue(), "325000");
  await p.locator("#portal-form [name=consent]").check();
  const generated = p.waitForResponse((r) =>
    r.url().endsWith("/api/method/beautymatch.api.self_service.recommend"),
  );
  await p
    .getByRole("button", { name: "Xem sản phẩm phù hợp", exact: true })
    .click();
  const result = (await (await generated).json()).message;
  report.session = result.session_id;
  await expect(p.locator("#portal-discovery")).toHaveAttribute(
    "data-session-id",
    result.session_id,
  );
  assert.deepEqual(
    result.results.map((r) => r.brand),
    ["Garnier", "Cocoon", "Caryophy"],
  );
  assert.deepEqual(
    result.results.map((r) => r.final_match_score),
    [82.46, 80.35, 74.04],
  );
  report.products = result.results.map((r) => ({
    code: r.product_code,
    name: r.product_name,
    score: r.final_match_score,
    image: r.image_url,
  }));
  const desktop = await photos(p, "[data-portal-item]");
  await shot(p, "portal-desktop", ".portal-product-grid");
  report.checks.push(
    "Customer khach submits real saved profile; Top 3 retains matching scores and all three distinct photos load from local assets with external CDN blocked",
  );
  await p.reload();
  await expect(p.locator("#portal-discovery")).toHaveAttribute(
    "data-session-id",
    result.session_id,
  );
  assert.deepEqual(await photos(p, "[data-portal-item]"), desktop);
  for (const width of [390, 320]) {
    await p.setViewportSize({ width, height: 844 });
    await photos(p, "[data-portal-item]");
    await shot(p, `portal-mobile-${width}`, ".portal-product-grid");
  }
  report.checks.push(
    "Portal reload, 390px and 320px retain all three actual photos without horizontal overflow",
  );

  const staff = await login("staff");
  const search = staff.getByLabel("Tìm khách hàng", { exact: true });
  await search.fill("CRM-LEAD-2026-00030");
  await staff.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
  const row = staff
    .locator("tbody tr")
    .filter({ hasText: "CRM-LEAD-2026-00030" });
  await row
    .getByRole("button", { name: "Hồ sơ & lịch sử", exact: true })
    .click();
  const session = staff
    .locator(".bm-native-session")
    .filter({ hasText: result.session_id });
  await session
    .getByRole("button", { name: "Mở kết quả", exact: true })
    .click();
  assert.deepEqual(await photos(staff, ".bm-native-product"), desktop);
  await shot(staff, "crm-desktop", ".bm-native-products");
  await staff.reload();
  await photos(staff, ".bm-native-product");
  // CRM chooses its mobile shell on initial mount. Open a real mobile
  // context with the authenticated session and the actual chosen history.
  const mobileContext = await browser.newContext({
    baseURL: "http://localhost:8000",
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    storageState: await staff.context().storageState(),
  });
  contexts.push(mobileContext);
  await mobileContext.route(/https:\/\/media\.(?:hcdn|hasaki)\.vn\//, (route) =>
    route.abort(),
  );
  const stored = await staff.evaluate(() =>
    Object.fromEntries(Object.entries(sessionStorage)),
  );
  await mobileContext.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries))
      sessionStorage.setItem(key, value);
    localStorage.setItem("crm_persona_captured", "1");
  }, stored);
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", (error) =>
    report.errors.push({ role: "staff-mobile", message: error.message }),
  );
  await mobile.goto("/crm/beautymatch/result");
  await photos(mobile, ".bm-native-product");
  assert(
    (await mobile.locator(".bm-native-products").boundingBox()).width >= 280,
    "Mobile product cards must retain a readable width",
  );
  await shot(mobile, "crm-mobile", ".bm-native-product-image", true);
  report.checks.push(
    "Sales User tuvan opens the actual customer history/session through UI; CRM desktop, reload and mobile show the same three cached catalog photos",
  );

  const after = bench("beautymatch.scripts.self_service_audit.snapshot").counts;
  for (const kind of [
    "CRM Lead",
    "CRM Task",
    "CRM Notification",
    "BeautyMatch Contact Request",
  ])
    assert.equal(after[kind], before[kind], kind);
  assert.equal(
    after["Recommendation Session"],
    before["Recommendation Session"] + (ready.changed ? 2 : 1),
  );
  assert.equal(
    hash(rows("Product Profile", { product_code: ["not like", "BM-DEMO-%"] })),
    catalogBefore,
  );
  const priorIds = new Set(oldSessions.map((r) => r.name));
  assert.deepEqual(
    rows("Recommendation Session").filter((r) => priorIds.has(r.name)),
    oldSessions,
  );
  const priorItemIds = new Set(oldItems.map((r) => r.name));
  assert.deepEqual(
    rows("Recommendation Item").filter((r) => priorItemIds.has(r.name)),
    oldItems,
  );
  const repeat = bench("beautymatch.scripts.seed_demo.prepare_self_service");
  assert.equal(repeat.changed, false);
  assert.equal(repeat.session_id, result.session_id);
  assert.deepEqual(
    bench("beautymatch.scripts.local_demo.prepare").demo_images_updated,
    [],
  );
  report.checks.push(
    "Research catalog and all previous session/item snapshots remain unchanged; no duplicate Lead, Task or notification; repeated preparation does not add a session or rewrite the photo",
  );
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failures.push(error.stack);
  process.exitCode = 1;
} finally {
  for (const ctx of contexts) await ctx.close();
  await browser.close();
  report.finished_at = new Date().toISOString();
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
}
