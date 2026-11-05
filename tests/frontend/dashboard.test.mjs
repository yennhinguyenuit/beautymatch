import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConcernSegments,
  renderDashboardView,
} from "../../beautymatch/public/js/dashboard-view.mjs";

test("concern donut uses mentions rather than number of sessions and translates both API forms", () => {
  const chart = buildConcernSegments([
    { skin_concern: "Acne", count: 3 },
    { concern: "concern_barrier", count: 1 },
  ]);
  assert.equal(chart.total, 4);
  assert.deepEqual(
    chart.items.map(({ label, share, offset }) => ({ label, share, offset })),
    [
      { label: "Mụn", share: 75, offset: 0 },
      { label: "Hàng rào bảo vệ da", share: 25, offset: 75 },
    ],
  );
});

test("real dashboard retains missing metrics, never renders invalid geometry, and escapes catalog names", () => {
  const html = renderDashboardView({
    kpis: {
      total_sessions: 0,
      leads_with_profile: 0,
      interest_rate: null,
      average_top1_score: Infinity,
    },
    charts: {
      top_skin_concerns: [
        { skin_concern: '<img src=x onerror="alert(1)">', count: NaN },
      ],
      top_interested_products: [
        { product_name: "<script>alert(1)</script>", count: -1 },
      ],
    },
  });
  assert.equal((html.match(/class="kpi botanical-kpi/g) || []).length, 4);
  assert.equal((html.match(/class="chart-panel/g) || []).length, 2);
  assert.equal((html.match(/class="chart-empty"/g) || []).length, 2);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("NaN"));
  assert.ok(!html.includes("Infinity"));
  assert.ok(html.includes('class="kpi-value">—'));
  assert.ok(html.includes("Bắt đầu tư vấn"));
});
