import { escape, icon } from "./components.mjs?v=botanical-20261105-v2";
export function customerSelection() {
  try {
    return JSON.parse(
      sessionStorage.getItem("beautymatch_customer_v1") || "null",
    );
  } catch {
    return null;
  }
}
export function selectCustomer(lead) {
  sessionStorage.removeItem("beautymatch_intake_retry_v1");
  sessionStorage.removeItem("beautymatch_sample_profile_v1");
  sessionStorage.setItem(
    "beautymatch_customer_v1",
    JSON.stringify({ crm_lead: lead }),
  );
  sessionStorage.removeItem("beautymatch_open_session_v1");
}
export function openSession(session) {
  selectCustomer(session.crm_lead);
  sessionStorage.setItem(
    "beautymatch_open_session_v1",
    JSON.stringify({
      session_id: session.session_id,
      crm_lead: session.crm_lead,
    }),
  );
  location.assign("/beautymatch/result");
}
export function leadUrl(lead) {
  return `/crm/leads/${encodeURIComponent(lead)}`;
}
export function navigation(page) {
  return `<header class="topbar"><div class="container header-inner"><a class="brand" href="/beautymatch" aria-label="BeautyMatch · Trang chủ"><span class="brand-seal" aria-hidden="true">${icon("leaf")}</span><span>Beauty<span>Match</span></span></a><nav class="nav" aria-label="Điều hướng chính">${[
    ["overview", "/beautymatch", "Khám phá"],
    ["consultation", "/beautymatch/consultation", "Tư vấn làn da"],
    ["result", "/beautymatch/result", "Gợi ý sản phẩm"],
    ["customer", "/beautymatch/customer", "Hồ sơ & lịch sử"],
    ["dashboard", "/beautymatch/dashboard", "Tổng quan CRM"],
  ]
    .map(
      ([key, path, label]) =>
        `<a href="${path}" ${page === key ? 'class="active" aria-current="page"' : ""}>${label}</a>`,
    )
    .join(
      "",
    )}</nav><a class="staff-chip" href="/crm/leads">Mở CRM ${icon("external")}</a></div></header>`;
}
export function footer() {
  return `<footer class="site-footer"><div class="container footer-inner"><a class="footer-brand" href="/beautymatch">${icon("leaf")} BeautyMatch <span class="muted">Hiểu làn da. Chăm sóc bằng sự thấu hiểu.</span></a><div class="footer-links"><a href="/beautymatch#customers">Không gian khách hàng</a><a href="/crm/leads">Frappe CRM ${icon("external")}</a></div></div></footer>`;
}
export function customerActions(lead) {
  return `<div class="button-row"><button class="button primary" data-work="consult">Tư vấn mới ${icon("arrow")}</button><a class="button secondary" href="${escape(leadUrl(lead))}">Trở lại CRM Lead ${icon("external")}</a></div>`;
}
