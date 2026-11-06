// Local native Task navigation probe. Only its own temporary QA Task is removed.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const baseURL = "http://localhost:8000";
const output = "test-results/crm-native-task";
await mkdir(output, { recursive: true });
const init = await readFile(new URL("../../init.sh", import.meta.url), "utf8");
const pwd =
  process.env.BM_TEST_PASSWORD ||
  init.match(/--admin-password\s+([^\s\\]+)/)?.[1];
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  baseURL,
  viewport: { width: 1440, height: 1000 },
});
const report = { errors: [], passed: false, task_cleanup: false };
let task;
let csrf = "";
const title = `BeautyMatch Native Task Navigation QA ${Date.now()}`;
async function call(method, args) {
  const response = await context.request.post(`/api/method/${method}`, {
    headers: { "X-Frappe-CSRF-Token": csrf },
    data: args,
  });
  const data = await response.json();
  if (!response.ok() || data.exc_type)
    throw new Error(`Task QA API: ${response.status()} ${data.exc_type || ""}`);
  return data.message;
}
const page = await context.newPage();
page.on("pageerror", (error) => report.errors.push(error.message));
try {
  assert(
    (
      await context.request.post("/api/method/login", {
        form: { usr: "Administrator", pwd },
      })
    ).ok(),
  );
  await page.addInitScript(() =>
    localStorage.setItem("crm_persona_captured", "1"),
  );
  await page.goto("/crm/beautymatch");
  await page.locator(".bm-native-toolbar").waitFor();
  csrf = await page.evaluate(() => window.csrf_token);
  task = await call("frappe.client.insert", {
    doc: { doctype: "CRM Task", title, status: "Todo", priority: "Low" },
  });
  await page.evaluate((name) => {
    window.__taskHostMarker = "same-document";
    document.dispatchEvent(
      new CustomEvent("beautymatch:task", { detail: { task: String(name) } }),
    );
  }, task.name);
  await page.waitForURL((url) => url.pathname.startsWith("/crm/tasks"));
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  // Assert the actual persisted Task was loaded, not an empty create dialog.
  await dialog.locator("input").filter({ visible: true }).first().waitFor();
  await page.waitForFunction(
    (value) =>
      [...document.querySelectorAll('[role="dialog"] input')].some(
        (input) => input.value === value,
      ),
    title,
  );
  assert.equal(
    await page.evaluate(() => window.__taskHostMarker),
    "same-document",
  );
  assert.equal(
    await page
      .locator('[data-slot="sidebar"] nav a[href="/crm/beautymatch"]')
      .count(),
    1,
  );
  report.screenshot = `${output}/native-task-modal.png`;
  await page.screenshot({ path: report.screenshot, animations: "disabled" });
  // CRM's custom modal body exposes its own close button.
  await dialog.locator(".mb-5").first().getByRole("button").last().click();
  await dialog.waitFor({ state: "hidden" });
  await page
    .locator('[data-slot="sidebar"] nav a[href="/crm/beautymatch"]')
    .click();
  await page.locator(".bm-native-toolbar").waitFor();
  assert.equal(
    await page.evaluate(() => window.__taskHostMarker),
    "same-document",
  );
  report.passed = !report.errors.length;
} catch (error) {
  report.failure = error.message;
} finally {
  // Close the test UI before deleting its fixture so cached host document
  // subscriptions cannot reload a Task that this cleanup just removed.
  await page.close();
  try {
    if (task?.name) {
      const owned = await call("frappe.client.get", {
        doctype: "CRM Task",
        name: task.name,
      });
      assert.equal(owned.title, title);
      await call("frappe.client.delete", {
        doctype: "CRM Task",
        name: task.name,
      });
      report.task_cleanup = true;
    }
  } catch (error) {
    report.cleanup_failure = error.message;
    report.passed = false;
  }
  await context.request.get("/api/method/logout").catch(() => {});
  await browser.close();
  report.passed =
    !report.failure &&
    !report.cleanup_failure &&
    report.task_cleanup &&
    !report.errors.length;
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
}
