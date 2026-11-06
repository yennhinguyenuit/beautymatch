// Real local regression acceptance. No fabricated API responses or route mocks.
// CDP blocks only completion traffic to exercise an actual network failure.
import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const baseURL = "http://localhost:8000",
  output = "test-results/request-consistency";
await mkdir(output, { recursive: true });
const credentials = JSON.parse(
  await readFile(".local/seminar-credentials.json", "utf8"),
);
const seeded = JSON.parse(await readFile(".local/seminar-data.json", "utf8"));
const report = {
  started_at: new Date().toISOString(),
  checks: [],
  errors: [],
  screenshots: [],
  failures: [],
  fault_injection:
    "Chrome Network.setBlockedURLs for complete_request only; no response mocks",
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const contexts = [];
async function login(role, width = 1440) {
  const context = await browser.newContext({
    baseURL,
    viewport: { width, height: 1000 },
    isMobile: width < 600,
    hasTouch: width < 600,
  });
  contexts.push(context);
  await context.addInitScript(() => {
    if (location.hostname === "localhost")
      localStorage.setItem("crm_persona_captured", "1");
  });
  const entry = credentials[role];
  assert(
    (
      await context.request.post("/api/method/login", {
        form: { usr: entry.username, pwd: entry.password },
      })
    ).ok(),
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(
    role === "customer" ? "/beautymatch/portal" : "/crm/beautymatch/requests",
  );
  await page
    .locator(
      role === "customer" ? "#portal-form:not([hidden])" : ".bm-native-toolbar",
    )
    .waitFor();
  if (role !== "customer") {
    const help = page.locator(".fixed.z-50.right-0");
    await help.waitFor({ state: "visible", timeout: 1500 }).catch(() => {});
    if (await help.isVisible()) {
      await help.locator(":scope > div:first-child button").last().click();
      await help.waitFor({ state: "hidden" });
    }
  }
  return { context, page, role };
}
async function call(page, operation, args = {}, namespace = "portal") {
  return page.evaluate(
    async ({ operation, args, namespace }) => {
      const response = await fetch(
        `/api/method/beautymatch.api.${namespace}.${operation}`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Frappe-CSRF-Token":
              window.csrf_token ||
              document.querySelector('meta[name="csrf-token"]')?.content ||
              "",
          },
          body: JSON.stringify(args),
        },
      );
      const body = await response.json();
      return {
        status: response.status,
        data: body.message,
        exc_type: body.exc_type,
      };
    },
    { operation, args, namespace },
  );
}
async function rpc(page, operation, args, namespace) {
  const reply = await call(page, operation, args, namespace);
  assert.equal(
    reply.status,
    200,
    `${operation}: ${reply.status} ${reply.exc_type || ""}`,
  );
  return reply.data;
}
async function filterStatus(page, label) {
  await page.getByLabel("Trạng thái yêu cầu", { exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
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
    `Overflow ${name}`,
  );
  const path = `${output}/${name}.png`;
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  report.screenshots.push(path);
}
try {
  const customer = await login("customer"),
    staff = await login("staff"),
    manager = await login("manager");
  const profile = await rpc(customer.page, "get_my_profile");
  const payload = {
    ...profile.profile,
    full_name: profile.full_name,
    email: profile.email,
    phone: profile.phone,
    consent: 1,
    max_budget: 325000,
    request_id: randomUUID(),
  };
  const a = await rpc(customer.page, "submit_profile", { payload });
  await rpc(staff.page, "accept_request", { request_id: a.request_id });
  const before = await rpc(staff.page, "get_request", {
    request_id: a.request_id,
  });
  const dataB = { ...payload, max_budget: 324997, request_id: randomUUID() };
  const duplicates = await Promise.all([
    rpc(customer.page, "submit_profile", { payload: dataB }),
    rpc(customer.page, "submit_profile", { payload: dataB }),
  ]);
  assert.equal(duplicates[0].request_id, duplicates[1].request_id);
  const b = duplicates[0];
  report.requests = { a: a.request_id, b: b.request_id };
  const stale = await rpc(staff.page, "get_request", {
    request_id: a.request_id,
  });
  assert.equal(stale.status, "Superseded");
  assert.equal(stale.superseded_by, b.request_id);
  assert.deepEqual(stale.snapshot, before.snapshot);
  assert(
    (
      await call(staff.page, "generate_for_request", {
        request_id: a.request_id,
        payload: { ...dataB, request_id: randomUUID() },
      })
    ).status >= 400,
  );
  assert(
    (
      await call(staff.page, "complete_request", {
        request_id: a.request_id,
        session_id: seeded.customers.A.session_id,
      })
    ).status >= 400,
  );
  report.checks.push(
    "Real concurrent customer retry returns one request; accepted A is superseded by B and cannot generate/complete with B or an unrelated session",
  );

  const claims = await Promise.all([
    call(staff.page, "accept_request", { request_id: b.request_id }),
    call(manager.page, "accept_request", { request_id: b.request_id }),
  ]);
  assert.equal(claims.filter((r) => r.status === 200).length, 1);
  assert.equal(claims.filter((r) => r.status >= 400).length, 1);
  let winner = claims[0].status === 200 ? staff : manager;
  const winnerRole = winner.role,
    otherRole = winnerRole === "staff" ? "manager" : "staff";
  const confirmed = { ...dataB, max_budget: 325002, request_id: randomUUID() };
  const generated = await rpc(winner.page, "generate_for_request", {
    request_id: b.request_id,
    payload: confirmed,
  });
  report.session_id = generated.result.session_id;
  assert.equal(generated.result.results.length, 3);
  const duplicate = await rpc(winner.page, "generate_for_request", {
    request_id: b.request_id,
    payload: confirmed,
  });
  assert.equal(duplicate.result.session_id, generated.result.session_id);
  await winner.context.close();
  winner = await login(winnerRole);
  const client = await winner.context.newCDPSession(winner.page);
  await client.send("Network.enable");
  await client.send("Network.setBlockedURLs", {
    urls: ["*beautymatch.api.portal.complete_request*"],
  });
  await filterStatus(winner.page, "Đang tư vấn");
  const row = winner.page.locator(`[data-request="${b.request_id}"]`);
  await row
    .getByRole("button", { name: "Tiếp tục tư vấn", exact: true })
    .click();
  await winner.page.waitForURL("**/crm/beautymatch/result");
  await winner.page.locator(".bm-native-product").first().waitFor();
  await winner.page.getByTestId("completion-warning").waitFor();
  assert(
    (await winner.page.getByTestId("completion-warning").innerText()).includes(
      "Đã tạo kết quả tư vấn nhưng chưa cập nhật được trạng thái yêu cầu.",
    ),
  );
  assert.equal(
    (await rpc(winner.page, "get_request", { request_id: b.request_id }))
      .status,
    "In Progress",
  );
  await screenshot(winner.page, "saved-result-completion-failed");
  await winner.page.reload();
  await winner.page.getByTestId("completion-warning").waitFor();
  assert.equal(await winner.page.locator(".bm-native-product").count(), 3);
  let generations = 0;
  winner.page.on("request", (req) => {
    if (/generate_for_request|generate_recommendations/.test(req.url()))
      generations++;
  });
  await client.send("Network.setBlockedURLs", { urls: [] });
  await winner.page
    .getByRole("button", {
      name: "Thử cập nhật trạng thái yêu cầu",
      exact: true,
    })
    .click();
  await winner.page
    .getByText("Đã xử lý yêu cầu · Backend xác nhận hoàn tất.", { exact: true })
    .waitFor();
  assert.equal(generations, 0);
  const completed = await rpc(winner.page, "get_request", {
    request_id: b.request_id,
  });
  assert.equal(completed.status, "Completed");
  assert.equal(completed.session_id, generated.result.session_id);
  assert.equal(completed.snapshot.max_budget, 324997);
  await screenshot(winner.page, "completion-retried-no-new-session");
  report.checks.push(
    "Two staff claim concurrently: exactly one succeeds; fresh browser login resumes from server, preserves edited consultation and immutable submitted snapshot",
  );
  report.checks.push(
    "Actual Chrome network failure on complete_request leaves saved results visible, survives reload; retry completes the same session with zero generation requests",
  );

  await winner.page.goto("/crm/beautymatch/requests");
  await winner.page.locator(".bm-native-toolbar").waitFor();
  await winner.context.setOffline(true);
  await filterStatus(winner.page, "Đã tư vấn");
  await winner.page
    .locator(".bm-native-state")
    .filter({ hasText: /Chưa|Failed|fetch|kết nối/ })
    .waitFor();
  assert.equal(await winner.page.locator("[data-request]").count(), 0);
  await winner.context.setOffline(false);
  await winner.page
    .getByRole("button", { name: "Thử lại", exact: true })
    .click();
  await winner.page.locator(`[data-request="${b.request_id}"]`).waitFor();
  await winner.page
    .getByLabel("Tìm yêu cầu", { exact: true })
    .fill(b.request_id);
  const searched = winner.page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith("/api/method/beautymatch.api.portal.list_requests") &&
      response.request().postData()?.includes(b.request_id),
  );
  await winner.page
    .getByRole("button", { name: "Xem yêu cầu", exact: true })
    .click();
  const searchReply = (await (await searched).json()).message;
  assert.equal(searchReply.total, 1);
  assert.equal(searchReply.requests[0].name, b.request_id);
  const nameSearch = await rpc(winner.page, "list_requests", {
    status: "Completed",
    search: payload.full_name,
  });
  assert(nameSearch.requests.some((entry) => entry.name === b.request_id));
  assert.equal(
    (
      await rpc(winner.page, "list_requests", {
        status: "Completed",
        search: "no-such-request-" + randomUUID(),
      })
    ).total,
    0,
  );
  await winner.page.getByLabel("Tìm yêu cầu", { exact: true }).fill("");
  await filterStatus(winner.page, "Chờ tiếp nhận");
  await filterStatus(winner.page, "Đã có yêu cầu mới");
  await winner.page.locator(`[data-request="${a.request_id}"]`).waitFor();
  assert.equal(
    await winner.page
      .locator("[data-request]")
      .filter({ hasText: "Chờ tiếp nhận" })
      .count(),
    0,
  );
  await screenshot(winner.page, "superseded-requests-correct-filter");
  report.checks.push(
    "Real offline list failure clears rows; retry and rapid filter changes display only the latest selected status",
  );
  report.checks.push(
    "Request search by exact code in UI, submitted customer name in API, and unmatched empty results use real scoped data and accurate totals",
  );

  // Same tab and storage survive logout/login: new account must not inherit selection.
  const oldKeys = await winner.page.evaluate(() =>
    Object.keys(sessionStorage).filter((k) =>
      k.startsWith("beautymatch_native_v2:"),
    ),
  );
  assert(oldKeys.length);
  await winner.page.evaluate(async () => {
    await fetch("/api/method/logout", {
      method: "POST",
      headers: { "X-Frappe-CSRF-Token": window.csrf_token },
    });
  });
  const other = credentials[otherRole];
  assert(
    (
      await winner.context.request.post("/api/method/login", {
        form: { usr: other.username, pwd: other.password },
      })
    ).ok(),
  );
  await winner.page.goto("/crm/beautymatch/customer");
  await winner.page
    .getByRole("heading", { name: "Chọn khách hàng để tiếp tục", exact: true })
    .waitFor();
  assert.equal(
    await winner.page
      .getByRole("button", { name: "Mở CRM Lead", exact: true })
      .count(),
    0,
  );
  report.checks.push(
    "Same browser account switch discards previous staff Lead/session; direct customer route prompts a new selection",
  );

  const concurrent = await Promise.all(
    [325003, 325004].map((max_budget) =>
      rpc(customer.page, "submit_profile", {
        payload: { ...payload, max_budget, request_id: randomUUID() },
      }),
    ),
  );
  const currentProfile = await rpc(customer.page, "get_my_profile");
  const pendingRequests = currentProfile.requests.filter(
    (entry) =>
      concurrent.some(
        (submitted) => submitted.request_id === entry.request_id,
      ) && entry.status === "Pending",
  );
  assert.equal(pendingRequests.length, 1);
  const actual = await rpc(winner.page, "get_request", {
    request_id: pendingRequests[0].request_id,
  });
  assert.equal(actual.snapshot.max_budget, currentProfile.profile.max_budget);
  assert.equal(
    currentProfile.requests.filter(
      (entry) =>
        concurrent.some(
          (submitted) => submitted.request_id === entry.request_id,
        ) && entry.status === "Superseded",
    ).length,
    1,
  );
  report.checks.push(
    "Two different simultaneous customer updates retain one current profile and one actionable Pending request; the final profile matches that request snapshot",
  );

  for (const width of [390, 320]) {
    const mobile = await login("customer", width);
    await mobile.page.locator('[name="full_name"]').fill("");
    await mobile.page
      .getByRole("button", { name: "Gửi yêu cầu tư vấn", exact: true })
      .click();
    await mobile.page
      .locator('[name="full_name"][aria-invalid="true"]')
      .waitFor();
    assert(
      await mobile.page
        .locator('[name="full_name"]')
        .evaluate((el) => el === document.activeElement),
    );
    assert.equal(
      await mobile.page.locator('[name="consent"]').isChecked(),
      false,
    );
    await screenshot(mobile.page, `portal-${width}-inline-validation`);
  }
  await customer.page.reload();
  await customer.page.locator("#portal-confirmation:not([hidden])").waitFor();
  await screenshot(customer.page, "portal-confirmation-real-status");
  const mobileStaff = await login("staff", 390);
  await mobileStaff.page.goto("/crm/beautymatch");
  await mobileStaff.page
    .locator(".bm-native-queue-preview, .bm-native-panel h2")
    .first()
    .waitFor();
  await screenshot(mobileStaff.page, "native-overview-mobile");
  await mobileStaff.page.evaluate(
    () => (document.documentElement.dataset.theme = "dark"),
  );
  await screenshot(mobileStaff.page, "native-overview-dark");
  report.checks.push(
    "Portal 390/320 and native mobile/dark render without overflow; inline errors focus first field; consent remains unchecked and confirmation reflects server status",
  );
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failures.push(error.stack);
  process.exitCode = 1;
} finally {
  report.finished_at = new Date().toISOString();
  for (const context of contexts) await context.close().catch(() => {});
  await browser.close();
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
