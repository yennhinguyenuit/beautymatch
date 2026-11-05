export const escape = (value = "") =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (value) =>
  Number.isFinite(Number(value))
    ? new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0,
      }).format(Number(value))
    : "Chưa có giá";
export const number = (value) =>
  new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value);
export const concerns = {
  concern_oil_control: "Kiểm soát dầu",
  concern_acne: "Mụn",
  concern_post_acne: "Thâm sau mụn",
  concern_dehydration: "Thiếu nước",
  concern_barrier: "Hàng rào bảo vệ da",
  concern_dullness: "Da xỉn màu",
  concern_aging: "Dấu hiệu lão hóa",
};
export const categories = {
  CLEANSER: "Sữa rửa mặt",
  TONER: "Toner",
  SERUM: "Serum",
  MOISTURIZER: "Kem dưỡng ẩm",
  SUNSCREEN: "Kem chống nắng",
};
export const skins = {
  OILY: "Da dầu",
  DRY: "Da khô",
  COMBINATION: "Da hỗn hợp",
  NORMAL: "Da thường",
};
const paths = {
  leaf: "M20 4C10 4 4 7 4 14a6 6 0 0 0 6 6c7 0 10-6 10-16ZM4 22 15 11",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  heart:
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  users:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7.9a4 4 0 0 1 0 7.8",
  spark: "m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z",
  shield: "M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6",
  clock: "M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  refresh: "M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3",
  external:
    "M15 3h6v6m0-6-11 11m1-11H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6",
  info: "M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  download: "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5",
  close: "m6 6 12 12M6 18 18 6",
};
export const icon = (name, cls = "") =>
  `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.leaf}"/></svg>`;
export function safeUrl(value) {
  if (!value || typeof value !== "string") return "";
  if (/^\/(?!\/)/.test(value) && !value.includes("\\")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function statePanel({
  title,
  text,
  error = false,
  retry = false,
  consultation = false,
}) {
  return `<section class="state-panel" ${error ? 'role="alert"' : 'role="status"'}><div class="state-symbol">${icon(error ? "info" : "leaf")}</div><h2>${escape(title)}</h2><p>${escape(text)}</p><div class="button-row">${retry ? `<button class="button primary" data-action="retry">${icon("refresh")} Thử lại</button>` : ""}${consultation ? '<a class="button primary" href="/beautymatch/consultation">Trở lại tư vấn →</a>' : ""}${error ? '<a class="button secondary" href="/login?redirect-to=%2Fbeautymatch%2Fresult">Đăng nhập CRM</a>' : ""}</div></section>`;
}
export function skeleton() {
  return `<div class="skeleton-grid" role="status" aria-label="Đang tải dữ liệu">${[1, 2, 3].map(() => '<div class="skeleton-card"><div class="shimmer photo-skeleton"></div><div class="shimmer line"></div><div class="shimmer line short"></div><div class="shimmer line"></div></div>').join("")}<span class="sr-only">Đang tải dữ liệu…</span></div>`;
}
export function profileCard(profile, session) {
  const labels = Object.entries(concerns)
    .filter(([key]) => [1, true, "1"].includes(profile?.[key]))
    .map(([, label]) => label);
  const available = profile?.sensitivity;
  return `<section class="profile-panel" aria-labelledby="profile-heading"><div class="profile-intro"><span class="profile-icon">${icon("leaf")}</span><div><span class="eyebrow">HIỂU LÀN DA CỦA BẠN</span><h2 id="profile-heading">Hồ sơ làn da</h2></div></div><div class="profile-facts"><div><span>Loại da</span><strong>${escape(skins[profile?.skin_type] || "Chưa có dữ liệu")}</strong></div><div><span>Mối quan tâm</span><strong>${escape(labels.join(" · ") || "Chưa có dữ liệu")}</strong></div><div><span>Ngân sách tối đa</span><strong>${money(session.max_budget)}</strong></div><div><span>Sản phẩm tìm kiếm</span><strong>${escape(categories[session.requested_category] || session.requested_category || "Chưa có dữ liệu")}</strong></div></div>${available ? `<div class="profile-foot">${icon("shield")} ${profile.sensitivity === "Sensitive" ? "Da nhạy cảm" : "Không đặc biệt nhạy cảm"}${profile.avoid_fragrance ? " · Tránh hương liệu" : ""}${profile.avoid_alcohol_denat ? " · Tránh Alcohol Denat." : ""}${profile.avoid_essential_oil ? " · Tránh tinh dầu" : ""}</div>` : ""}</section>`;
}
export function productCard(item, asset = {}, closed = false) {
  const image = safeUrl(asset.image_url);
  const link = safeUrl(asset.product_url);
  const score = Math.max(0, Math.min(100, Number(item.final_match_score) || 0));
  return `<article class="product-card" data-item="${escape(item.recommendation_item)}"><div class="product-photo shade-${item.rank}"><span class="rank-badge">${Number(item.rank) === 1 ? `${icon("spark")} Phù hợp nhất` : `Lựa chọn 0${Number(item.rank) || 2}`}</span>${photoMarkup(image, item.product_name, asset.photo_crop)}</div><div class="product-body"><div class="product-brand">${escape(item.brand)}</div><h3>${escape(item.product_name)}</h3><div class="product-price">${money(item.price)}</div><div class="match"><div><span>Độ phù hợp với bạn</span><strong>${number(score)}<small>%</small></strong></div><progress max="100" value="${score}" aria-label="Độ phù hợp ${number(score)} phần trăm">${score}%</progress></div><div class="explanation"><h4>${icon("spark")} Vì sao dành cho bạn?</h4><p>${escape(item.why_recommended || "Máy chủ chưa cung cấp giải thích.")}</p></div>${item.warning_partial_match ? `<div class="partial-warning">${icon("info")}<p>${escape(item.warning_partial_match)}</p></div>` : ""}${link ? `<a class="detail-link" href="${escape(link)}" target="_blank" rel="noopener noreferrer">Chi tiết sản phẩm ${icon("external")}</a>` : `<button class="detail-link" data-action="detail" data-id="${escape(item.recommendation_item)}">Xem thông tin sản phẩm ${icon("arrow")}</button>`}<div class="card-bottom"><div class="feedback-status" data-feedback="${escape(item.recommendation_item)}" aria-live="polite">${item.customer_feedback && item.customer_feedback !== "None" ? `<span class="saved-feedback">${icon("check")} ${item.customer_feedback === "Interested" ? "Đã quan tâm" : "Đã ghi nhận: không quan tâm"}</span>` : ""}</div><div class="feedback-actions"><button class="button primary" data-action="interested" data-id="${escape(item.recommendation_item)}" ${closed ? "disabled" : ""}>${icon("heart")} Quan tâm</button><button class="button secondary" data-action="reject" data-id="${escape(item.recommendation_item)}" ${closed ? "disabled" : ""}>Không quan tâm</button></div>${closed ? '<p class="muted">Phiên tư vấn đã đóng.</p>' : ""}</div></div></article>`;
}
export function photoMarkup(image, alt, crop) {
  if (!image)
    return `<div class="photo-placeholder">${icon("leaf")}<span>Chưa có ảnh sản phẩm</span></div>`;
  const img = `<img src="${escape(image)}" alt="${escape(alt)}" loading="eager" referrerpolicy="no-referrer">`;
  // Display the product region of catalog banners without modifying the source asset.
  if (
    crop &&
    ["x", "y", "width", "height"].every((key) => Number.isFinite(crop[key])) &&
    crop.width > 0 &&
    crop.height > 0
  ) {
    return `<div class="photo-crop" style="aspect-ratio:${crop.width}/${crop.height};--photo-width:${(1200 / crop.width) * 100}%;--photo-height:${(630 / crop.height) * 100}%;--photo-x:${(-crop.x / crop.width) * 100}%;--photo-y:${(-crop.y / crop.height) * 100}%">${img}</div>`;
  }
  return img;
}
export function barChart(
  rows,
  labelKey,
  { vertical = false, valueLabel = "Lượt" } = {},
) {
  if (!Array.isArray(rows) || !rows.length)
    return '<div class="chart-empty">Chưa có dữ liệu trong khoảng thời gian này.</div>';
  const max = Math.max(...rows.map((row) => Number(row.count) || 0), 1);
  return `<div class="bar-chart ${vertical ? "vertical" : ""}" role="img" aria-label="${escape(rows.map((row) => `${row[labelKey]}: ${row.count}`).join("; "))}">${rows.map((row, i) => `<div class="bar-row" style="--bar:${(Math.max(0, Number(row.count) || 0) / max) * 100}%;--order:${i}"><div class="bar-label" title="${escape(row[labelKey])}">${escape(row[labelKey])}</div><div class="bar-track"><div class="bar-fill"></div></div><span class="bar-value">${number(Number(row.count) || 0)} <span class="sr-only">${valueLabel}</span></span></div>`).join("")}</div>`;
}
