import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile } from "node:fs/promises";

test("demo cards, photographs, 0/1/2/3 states, error and accessibility", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const live = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/")) live.push(request.url());
  });
  await page.goto("/beautymatch/result?demo=1");
  await expect(page.locator(".product-card")).toHaveCount(3);
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page
      .locator(".product-photo img")
      .evaluateAll((images) =>
        images.every((img) => img.complete && img.naturalWidth > 0),
      ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/result-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations).toEqual([]);
  for (const [value, count] of [
    ["one", 1],
    ["two", 2],
    ["empty", 0],
  ]) {
    await page.selectOption("#demo-scenario", value);
    await expect(page.locator("#content")).toHaveAttribute(
      "aria-busy",
      "false",
    );
    await expect(page.locator(".product-card")).toHaveCount(count);
  }
  await expect(
    page.getByRole("heading", { name: "Chưa tìm thấy sự phù hợp" }),
  ).toBeVisible();
  await page.selectOption("#demo-scenario", "error");
  await expect(
    page.getByRole("heading", { name: "Chưa thể tải gợi ý" }),
  ).toBeVisible();
  expect(live).toEqual([]);
  expect(errors).toEqual([]);
});
test("feedback confirms only on success, requires rejection reason and honors PENDING", async ({
  page,
}) => {
  await page.goto("/beautymatch/result?demo=1");
  const first = page.locator(".product-card").first();
  await first.getByRole("button", { name: "Quan tâm", exact: true }).click();
  await expect(first.locator(".feedback-status")).toContainText("CREATED");
  await page.selectOption("#demo-feedback", "PENDING");
  const second = page.locator(".product-card").nth(1);
  await second.getByRole("button", { name: "Quan tâm", exact: true }).click();
  await expect(second.locator(".feedback-status")).toContainText("PENDING");
  await first
    .getByRole("button", { name: "Không quan tâm", exact: true })
    .click();
  await page.getByRole("button", { name: "Gửi phản hồi" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page
      .locator("#rejection-reason")
      .evaluate((el) => el.validity.valueMissing),
  ).toBe(true);
  await page.selectOption("#rejection-reason", "Khác");
  await page.getByRole("button", { name: "Gửi phản hồi" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(first.locator(".feedback-status")).toContainText(
    "Đã ghi nhận phản hồi",
  );
  await page.selectOption("#demo-feedback", "ERROR");
  await first.getByRole("button", { name: "Quan tâm", exact: true }).click();
  await expect(first.locator(".feedback-status")).toContainText(
    "Chưa có phản hồi nào được lưu",
  );
  await first
    .getByRole("button", { name: "Không quan tâm", exact: true })
    .click();
  await page.selectOption("#rejection-reason", "Muốn tìm lựa chọn khác");
  await page.getByRole("button", { name: "Gửi phản hồi" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator(".dialog-status")).toContainText(
    "Lỗi gửi phản hồi",
  );
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await page.getByRole("button", { name: "Lịch sử tư vấn" }).click();
  await expect(page.locator(".history-item")).toHaveCount(1);
  await page.locator(".history-item").click();
  await expect(page.locator(".product-card")).toHaveCount(3);
});
test("dashboard filters, charts, accessible tables, export, empty and error", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/beautymatch/dashboard?demo=1");
  await expect(page.locator(".kpi")).toHaveCount(4);
  await expect(page.locator(".chart-panel")).toHaveCount(2);
  await page.getByText("Xem bảng dữ liệu", { exact: true }).first().click();
  await expect(page.locator(".data-table").first()).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất báo cáo CSV" }).click();
  expect((await download).suggestedFilename()).toContain("demo");
  await page.fill("#start-date", "2026-11-01");
  await page.fill("#end-date", "2026-11-05");
  await page.getByRole("button", { name: "Xem báo cáo" }).click();
  await expect(page.locator("#content")).toHaveAttribute("aria-busy", "false");
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/dashboard-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations).toEqual([]);
  await page.selectOption("#demo-scenario", "empty");
  await expect(page.locator(".chart-empty")).toHaveCount(2);
  await expect(page.locator(".kpi-value").first()).toHaveText("0");
  await page.selectOption("#demo-scenario", "error");
  await expect(
    page.getByRole("heading", { name: "Chưa thể tải báo cáo" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("live RPC retries retain request_id, avoid duplicate generation and keep identifiers out of URLs", async ({
  page,
}) => {
  const pending = {
    crm_lead: "PRIVATE-LEAD",
    beauty_profile: "PRIVATE-PROFILE",
    request_id: "0d853655-8f72-4ee7-a476-7ae238be46db",
    profile_version: "2026-11-05 10:00:00.123456",
  };
  const photos = JSON.parse(
    await readFile("beautymatch/public/demo/products.json", "utf8"),
  );
  const session = {
    session_id: "PRIVATE-SESSION",
    crm_lead: pending.crm_lead,
    request_id: pending.request_id,
    status: "Generated",
    requested_category: "CLEANSER",
    max_budget: 400000,
    results: photos.map((p, i) => ({
      ...p,
      product: p.name,
      item_id: `ITEM-${i}`,
      rank: i + 1,
      final_match_score: 90 - i,
      why_recommended: "Giải thích từ backend",
      customer_feedback: "None",
    })),
  };
  await page.addInitScript(
    (value) =>
      sessionStorage.setItem("beautymatch_pending_v1", JSON.stringify(value)),
    pending,
  );
  const generation = [];
  const urls = [];
  let fail = true;
  let feedbackCalls = 0;
  await page.route("**/api/method/**", async (route) => {
    const request = route.request();
    urls.push(request.url());
    const body = request.postDataJSON();
    if (request.url().includes("generate_recommendations")) {
      generation.push(body);
      if (fail) {
        fail = false;
        await route.fulfill({ status: 503, json: { exc_type: "Unavailable" } });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      await route.fulfill({ json: { message: session } });
      return;
    }
    if (request.url().endsWith(".read")) {
      expect(request.method()).toBe("POST");
      await route.fulfill({
        json: {
          message:
            body.operation === "get_result_context"
              ? { profile: { skin_type: "DRY" }, products: photos }
              : body.operation === "get_customer_history"
                ? { sessions: [session], start: 0, total: 1 }
                : session,
        },
      });
      return;
    }
    if (request.url().includes("submit_feedback")) {
      feedbackCalls++;
      await new Promise((resolve) => setTimeout(resolve, 150));
      await route.fulfill({
        json: {
          message: {
            ...body,
            customer_feedback: body.customer_feedback,
            follow_up_status: "CREATED",
            follow_up_task: "TASK",
          },
        },
      });
      return;
    }
    await route.abort();
  });
  await page.goto("/beautymatch/result");
  await expect(
    page.getByRole("heading", { name: "Chưa thể tải gợi ý" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Thử lại", exact: true }).click();
  await expect(page.locator(".product-card")).toHaveCount(3);
  expect(generation).toHaveLength(2);
  expect(generation[0]).toEqual(generation[1]);
  expect(generation[0]).toEqual(pending);
  const button = page
    .locator(".product-card")
    .first()
    .getByRole("button", { name: "Quan tâm", exact: true });
  await button.dblclick();
  await expect(page.locator(".feedback-status").first()).toContainText(
    "CREATED",
  );
  expect(feedbackCalls).toBe(1);
  await page.reload();
  await expect(page.locator(".product-card")).toHaveCount(3);
  expect(generation).toHaveLength(2);
  expect(urls.every((url) => !url.includes("PRIVATE"))).toBe(true);
  expect(page.url()).not.toContain("PRIVATE");
});
test("missing live consultation never generates and keyboard dialogs restore focus", async ({
  page,
}) => {
  let calls = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/")) calls++;
  });
  await page.goto("/beautymatch/result");
  await expect(
    page.getByRole("heading", { name: "Bắt đầu từ làn da của bạn" }),
  ).toBeVisible();
  expect(calls).toBe(0);
  const privacy = page.getByRole("button", { name: "Quyền riêng tư" });
  await privacy.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(privacy).toBeFocused();
});
