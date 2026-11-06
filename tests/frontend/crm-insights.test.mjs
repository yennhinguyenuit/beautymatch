import test from "node:test";
import assert from "node:assert/strict";
import { renderCRMInsights } from "../../beautymatch/public/js/crm-insights.mjs";

const data = {
  customer: {
    crm_lead: "PRIVATE-LEAD",
    profile: {
      skin_type: "OILY",
      concern_acne: 1,
      sensitivity: "Sensitive",
      requested_category: "SERUM",
    },
  },
  summary: {
    total_sessions: 1,
    interested_products: [
      { product_name: '<img src=x onerror="alert(1)">', final_match_score: 91 },
    ],
  },
  history: {
    sessions: [
      {
        session_id: "PRIVATE-SESSION",
        requested_category: "SERUM",
        results: [
          {
            product_name: "Sản phẩm thật",
            final_match_score: 91,
            customer_feedback: "Interested",
          },
        ],
        follow_ups: [
          {
            follow_up_status: "CREATED",
            task: { name: "42", status: "Todo", url: "/app/crm-task/42" },
          },
        ],
      },
    ],
  },
};
test("native CRM summary displays API data, scoped navigation and actual follow-up task", () => {
  const html = renderCRMInsights(data);
  assert(
    html.includes("Da dầu") &&
      html.includes("Mụn") &&
      html.includes("Sản phẩm thật"),
  );
  assert(html.includes('href="/crm/tasks/view/list?open=42"'));
  assert(html.includes('data-bm-session="PRIVATE-SESSION"'));
  assert(!/href="[^"]*PRIVATE/.test(html));
  assert(!html.includes("<img src=x"));
  assert(html.includes("&lt;img"));
  const pending = structuredClone(data);
  pending.history.sessions[0].follow_ups = [
    { follow_up_status: "PENDING", task: null },
  ];
  const pendingHtml = renderCRMInsights(pending);
  assert(pendingHtml.includes("Chờ phân công chăm sóc"));
  assert(!pendingHtml.includes('href="/crm/tasks/view/list?open=42"'));
});
test("native CRM summary rejects malformed responses and unsafe task URLs", () => {
  assert.throws(() => renderCRMInsights({}), /chưa đúng cấu trúc/);
  const unsafe = structuredClone(data);
  unsafe.history.sessions[0].follow_ups[0].task.url = "javascript:alert(1)";
  assert(!renderCRMInsights(unsafe).includes('href="javascript:'));
});
