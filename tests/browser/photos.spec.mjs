import { test, expect } from "@playwright/test";

test("catalog photo failure keeps an honest fallback and working feedback", async ({
  page,
}) => {
  await page.route("**/assets/beautymatch/images/HASAKI-CLN-005.png", (route) =>
    route.abort(),
  );
  await page.goto("/beautymatch/result?demo=1");
  const card = page.locator(".product-card").first();
  const photo = card.locator(".catalog-photo");
  await expect(photo).not.toHaveClass(/is-ready/);
  await expect(photo.locator("[data-photo-label]")).toHaveText(
    "Chưa tải được ảnh sản phẩm",
  );
  await expect(photo.locator(".photo-placeholder")).toBeVisible();
  await expect(photo.locator("img")).toHaveAttribute("aria-hidden", "true");
  await card.getByRole("button", { name: "Quan tâm", exact: true }).click();
  await expect(card.locator(".feedback-status")).toContainText("CREATED");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
