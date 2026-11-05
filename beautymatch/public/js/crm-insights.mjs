// Native CRM HTML Control content. Data is supplied by the existing permission-checked API.
const escape = (value = "") =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const number = (value) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
    Number(value) || 0,
  );
const categories = {
  CLEANSER: "Sữa rửa mặt",
  TONER: "Toner",
  SERUM: "Serum",
  MOISTURIZER: "Kem dưỡng",
  SUNSCREEN: "Kem chống nắng",
};
const skins = {
  OILY: "Da dầu",
  DRY: "Da khô",
  COMBINATION: "Da hỗn hợp",
  NORMAL: "Da thường",
};
const concerns = {
  concern_oil_control: "Kiểm soát dầu",
  concern_acne: "Mụn",
  concern_post_acne: "Thâm sau mụn",
  concern_dehydration: "Thiếu nước",
  concern_barrier: "Hàng rào bảo vệ da",
  concern_dullness: "Da xỉn màu",
  concern_aging: "Dấu hiệu lão hóa",
};
const states = {
  Todo: "Chờ thực hiện",
  Done: "Hoàn thành",
  Canceled: "Đã hủy",
  "In Progress": "Đang thực hiện",
};
const empty = (text) => `<p class="bm-crm-empty">${escape(text)}</p>`;
const action = (lead, type, label, primary = false) =>
  `<a class="bm-crm-button${primary ? " bm-crm-button--primary" : ""}" data-bm-action="${type}" data-bm-lead="${escape(lead)}" href="/beautymatch/${type === "consultation" ? "consultation" : "customer"}">${label}</a>`;
export function renderCRMInsights(data) {
  if (
    !data?.customer?.crm_lead ||
    !Array.isArray(data.history?.sessions) ||
    !Array.isArray(data.summary?.interested_products)
  )
    throw new Error("Dữ liệu hồ sơ BeautyMatch chưa đúng cấu trúc.");
  const { customer, summary, history } = data;
  const lead = customer.crm_lead;
  const profile = customer.profile || {};
  const concernNames = Object.entries(concerns)
    .filter(([key]) => [1, true, "1"].includes(profile[key]))
    .map(([, label]) => label);
  const sessions = history.sessions.slice(0, 3);
  const tasks = [
    ...new Map(
      history.sessions.flatMap((s) =>
        (s.follow_ups || [])
          .filter((f) => f.task)
          .map((f) => [String(f.task.name), f.task]),
      ),
    ).values(),
  ];
  const taskLink = (task) =>
    /^\/app\/crm-task\/[^/?#]+$/.test(task.url || "")
      ? `<a href="${escape(task.url)}">CRM Task ${escape(task.name)}</a>`
      : `CRM Task ${escape(task.name)}`;
  return `<section class="bm-crm-insights" aria-label="Hồ sơ BeautyMatch"><header class="bm-crm-insights__header"><span class="bm-crm-insights__eyebrow">CHĂM SÓC CÁ NHÂN HÓA</span><h3 class="bm-crm-insights__title">Hiểu làn da.<br>Tiếp nối sự quan tâm.</h3><p class="bm-crm-insights__copy">Hồ sơ và hành trình tư vấn từ BeautyMatch.</p></header><div class="bm-crm-insights__actions">${action(lead, "consultation", "Tư vấn với BeautyMatch", true)}${action(lead, "history", "Hồ sơ & lịch sử")}</div><div class="bm-crm-stats"><div class="bm-crm-stat"><strong>${number(summary.total_sessions)}</strong><span>Phiên tư vấn</span></div><div class="bm-crm-stat"><strong>${number(summary.interested_products.length)}</strong><span>Lượt quan tâm</span></div></div>
  <section class="bm-crm-section"><h4 class="bm-crm-section__heading">Hồ sơ làn da</h4>${profile.skin_type ? `<dl class="bm-crm-profile"><dt>Loại da</dt><dd>${escape(skins[profile.skin_type] || profile.skin_type)}</dd><dt>Nhu cầu</dt><dd>${escape(concernNames.join(" · ") || "Chưa có thông tin")}</dd><dt>Độ nhạy cảm</dt><dd>${profile.sensitivity === "Sensitive" ? "Da nhạy cảm" : "Không đặc biệt nhạy cảm"}</dd><dt>Danh mục</dt><dd>${escape(categories[profile.requested_category] || profile.requested_category)}</dd></dl>` : empty("Chưa có hồ sơ làn da. Bắt đầu tư vấn để bổ sung.")}</section>
  <section class="bm-crm-section"><h4 class="bm-crm-section__heading">Phiên tư vấn gần đây</h4><div class="bm-crm-timeline">${
    sessions
      .map(
        (s) =>
          `<article class="bm-crm-session"><header><strong>${escape(categories[s.requested_category] || s.requested_category)}</strong><span>${number(s.results.length)} gợi ý</span></header><p>${escape(s.session_id)}</p>${s.results
            .slice(0, 3)
            .map(
              (item) =>
                `<div class="bm-crm-product"><strong>${escape(item.product_name)}</strong><span>${number(item.final_match_score)}% phù hợp · ${item.customer_feedback === "Interested" ? "Quan tâm" : item.customer_feedback === "Not Interested" ? "Không quan tâm" : "Chưa phản hồi"}</span></div>`,
            )
            .join(
              "",
            )}${(s.follow_ups || []).some((f) => f.follow_up_status === "PENDING") ? '<span class="bm-crm-status" data-status="pending">Chờ phân công chăm sóc</span>' : ""}<a class="bm-crm-button" href="/beautymatch/result" data-bm-action="result" data-bm-lead="${escape(lead)}" data-bm-session="${escape(s.session_id)}">Mở kết quả</a></article>`,
      )
      .join("") || empty("Chưa có phiên tư vấn.")
  }</div></section>
  <section class="bm-crm-section"><h4 class="bm-crm-section__heading">Sản phẩm đã quan tâm</h4><div class="bm-crm-products">${
    summary.interested_products
      .slice(0, 5)
      .map(
        (item) =>
          `<div class="bm-crm-product"><strong>${escape(item.product_name)}</strong><span>${number(item.final_match_score)}% phù hợp</span></div>`,
      )
      .join("") || empty("Chưa có sản phẩm được đánh dấu quan tâm.")
  }</div></section>
  <section class="bm-crm-section"><h4 class="bm-crm-section__heading">Công việc chăm sóc</h4><ul class="bm-crm-tasks">${tasks
    .slice(0, 5)
    .map(
      (task) =>
        `<li class="bm-crm-task">${taskLink(task)} <span class="bm-crm-status" data-status="${task.status === "Canceled" ? "canceled" : "created"}">${escape(states[task.status] || task.status)}</span></li>`,
    )
    .join(
      "",
    )}</ul>${!tasks.length ? empty("Chưa có CRM Task được liên kết trong các phiên gần đây.") : ""}</section></section>`;
}
