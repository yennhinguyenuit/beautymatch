import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Transport fixtures exercise the real routes, templates and modules. No test
// writes to Frappe or substitutes a static page for the application.
const customer = {
  crm_lead: "UI-TEST-LEAD-A",
  full_name: "Khách hàng kiểm thử A",
  email: "cinema-ui@example.invalid",
  phone: "",
  profile: {
    skin_type: "OILY",
    sensitivity: "Not specifically sensitive",
    requested_category: "SERUM",
    max_budget: 350000,
    concern_acne: 1,
    concern_oil_control: 0,
    concern_post_acne: 0,
    concern_dehydration: 0,
    concern_barrier: 0,
    concern_dullness: 0,
    concern_aging: 0,
    avoid_fragrance: 1,
    avoid_alcohol_denat: 0,
    avoid_essential_oil: 0,
    preferred_brand: "",
  },
};

async function workspaceFixture(page) {
  const calls = [];
  await page.route("**/api/method/**", async (route) => {
    const request = route.request();
    const method = new URL(request.url()).pathname.split(".").at(-1);
    const body = request.postData() ? request.postDataJSON() : {};
    calls.push({ method, body, verb: request.method(), url: request.url() });
    let message;
    if (method === "get_workspace") {
      message = {
        leads: [
          {
            name: customer.crm_lead,
            first_name: "Khách hàng",
            last_name: "kiểm thử A",
            status: "New",
          },
        ],
        has_more: false,
      };
    } else if (method === "get_scenarios") message = { scenarios: {} };
    else if (method === "get_customer_context") message = customer;
    else if (method === "get_customer_view") {
      message = {
        customer,
        summary: {
          total_sessions: 0,
          beauty_profiles: [],
          interested_products: [],
        },
        history: { sessions: [], total: 0, start: 0 },
      };
    } else {
      await route.fulfill({
        status: 500,
        json: { exc_type: "UnexpectedTestWrite" },
      });
      return;
    }
    await route.fulfill({ json: { message } });
  });
  return calls;
}

async function checkLayout(page) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("guided consultation preserves all fields, keyboard focus and real consent validation", async ({
  page,
}) => {
  const calls = await workspaceFixture(page);
  await page.goto("/beautymatch/consultation");
  await expect(page.locator("#bm-submit")).toBeEnabled();
  const form = page.locator("#bm-consultation-form");
  expect(
    await form
      .locator("[name]")
      .evaluateAll((fields) => fields.map((field) => field.name).sort()),
  ).toEqual(
    [
      "full_name",
      "email",
      "phone",
      "skin_type",
      "sensitivity",
      "requested_category",
      "max_budget",
      "preferred_brand",
      "consent",
      "concern_acne",
      "concern_oil_control",
      "concern_post_acne",
      "concern_dehydration",
      "concern_barrier",
      "concern_dullness",
      "concern_aging",
      "avoid_fragrance",
      "avoid_alcohol_denat",
      "avoid_essential_oil",
    ].sort(),
  );
  await expect(form.locator(".bm-section")).toHaveCount(4);
  for (const section of await form.locator(".bm-section").all())
    await expect(section).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  await page.locator(".bm-step[data-consult-step='2']").click();
  await expect(page.locator("#bm-heading-2")).toBeFocused();
  await page.locator("#bm-full-name").fill("Khách hàng kiểm thử");
  await page.locator("#bm-email").fill("cinema-ui@example.invalid");
  await page.locator("#bm-skin").selectOption("OILY");
  await page
    .locator("#bm-sensitivity")
    .selectOption("Not specifically sensitive");
  await page.locator("[name='concern_acne']").check();
  await page.locator("#bm-category").selectOption("SERUM");
  await page.locator("#bm-budget").fill("350000");
  await page.locator("#bm-consent").check();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "100",
  );
  await expect(page.locator("#bm-progress-text")).toHaveText(
    "4/4 mục đã hoàn tất",
  );
  await page.locator("#bm-consent").uncheck();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "75",
  );
  await page.locator("#bm-submit").click();
  await expect(page.locator("#bm-form-error")).toHaveText(
    "Vui lòng đồng ý lưu thông tin để tiếp tục.",
  );
  expect(calls).toEqual([]);
  await checkLayout(page);
});

test("authorized customer prefill keeps contacts protected and requires fresh consent", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const calls = await workspaceFixture(page);
  await page.addInitScript(
    (lead) =>
      sessionStorage.setItem(
        "beautymatch_customer_v1",
        JSON.stringify({ crm_lead: lead }),
      ),
    customer.crm_lead,
  );
  await page.goto("/beautymatch/consultation");
  await expect(page.locator("#bm-full-name")).toHaveValue(customer.full_name);
  await expect(page.locator("#bm-email")).toHaveAttribute("readonly", "");
  await expect(page.locator("#bm-skin")).toHaveValue("OILY");
  await expect(page.locator("[name='concern_acne']")).toBeChecked();
  await expect(page.locator("#bm-consent")).not.toBeChecked();
  await expect(page.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "75",
  );
  expect(
    calls.filter((call) => call.method === "get_customer_context"),
  ).toEqual([
    {
      method: "get_customer_context",
      body: { crm_lead: customer.crm_lead },
      verb: "POST",
      url: "http://127.0.0.1:4173/api/method/beautymatch.api.frontend.get_customer_context",
    },
  ]);
  expect(page.url()).not.toContain(customer.crm_lead);
  expect(page.url()).not.toContain(customer.email);
  await expect
    .poll(() =>
      page
        .locator(".bm-botanical-story > img")
        .evaluate((image) => image.complete && image.naturalWidth > 0),
    )
    .toBe(true);
  await checkLayout(page);
  await page.screenshot({
    path: `test-results/cinematic-consultation-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(errors).toEqual([]);
});

test("editorial homepage links to real features and starts a clean consultation", async ({
  page,
}) => {
  await workspaceFixture(page);
  await page.goto("/beautymatch");
  await expect(page.locator("#home-heading")).toContainText("Hiểu làn da.");
  const navigation = page.getByRole("navigation", {
    name: "Điều hướng chính",
    exact: true,
  });
  expect(
    await navigation
      .locator("a")
      .evaluateAll((links) => links.map((link) => new URL(link.href).pathname)),
  ).toEqual([
    "/beautymatch",
    "/beautymatch/consultation",
    "/beautymatch/result",
    "/beautymatch/customer",
    "/beautymatch/dashboard",
  ]);
  await page
    .getByRole("link", { name: "Khám phá BeautyMatch", exact: true })
    .click();
  await expect(page).toHaveURL(/#discover$/);
  await expect(page.locator("#discover")).toBeInViewport();
  await page.evaluate(() => {
    sessionStorage.setItem(
      "beautymatch_customer_v1",
      JSON.stringify({ crm_lead: "PREVIOUS-LEAD" }),
    );
    sessionStorage.setItem(
      "beautymatch_intake_retry_v1",
      JSON.stringify({ crm_lead: "PREVIOUS-LEAD", payload: {} }),
    );
    sessionStorage.setItem(
      "beautymatch_sample_profile_v1",
      JSON.stringify({ skin_type: "DRY" }),
    );
  });
  await page
    .getByRole("button", { name: "Bắt đầu tư vấn", exact: true })
    .click();
  await expect(page).toHaveURL(/\/beautymatch\/consultation$/);
  await expect(page.locator("#bm-full-name")).toHaveValue("");
  expect(
    await page.evaluate(() =>
      [
        "beautymatch_customer_v1",
        "beautymatch_intake_retry_v1",
        "beautymatch_sample_profile_v1",
      ].map((key) => sessionStorage.getItem(key)),
    ),
  ).toEqual([null, null, null]);
  await checkLayout(page);
});

test("CRM search and customer selection stay functional with reduced motion and accessible layout", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const calls = await workspaceFixture(page);
  await page.goto("/beautymatch");
  await expect(page.locator(".customer-card")).toHaveCount(1);
  await page.locator("#lead-search").fill("kiểm thử");
  await page.getByRole("button", { name: "Tìm kiếm", exact: true }).click();
  await expect
    .poll(() => calls.filter((call) => call.method === "get_workspace").length)
    .toBe(2);
  expect(
    calls.filter((call) => call.method === "get_workspace").at(-1).body,
  ).toEqual({ search: "kiểm thử", start: 0 });
  await page.evaluate(() => scrollTo(0, 250));
  await expect
    .poll(() =>
      page
        .locator("[data-parallax]")
        .evaluate((element) => element.style.getPropertyValue("--parallax")),
    )
    .toBe("0px");
  expect(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.playState === "running" &&
              animation.effect?.getTiming().iterations === Infinity,
          ).length,
    ),
  ).toBe(0);
  await checkLayout(page);
  await page.screenshot({
    path: `test-results/cinematic-home-${test.info().project.name}.png`,
    fullPage: true,
    animations: "disabled",
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page
    .locator(".customer-card")
    .getByRole("button", { name: "Hồ sơ & tư vấn" })
    .click();
  await expect(page).toHaveURL(/\/beautymatch\/customer$/);
  await expect(
    page.getByRole("heading", { name: customer.full_name, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("beautymatch_customer_v1")),
    ),
  ).toEqual({ crm_lead: customer.crm_lead });
  expect(calls.every((call) => !call.url.includes(customer.crm_lead))).toBe(
    true,
  );
});
