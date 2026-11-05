import {
  escape,
  icon,
  number,
  concerns,
} from "./components.mjs?v=botanical-20261105-v2";

const concernLabels = {
  "Oil Control": "Kiểm soát dầu",
  Acne: "Mụn",
  "Post-acne": "Thâm sau mụn",
  Dehydration: "Thiếu nước",
  "Skin Barrier": "Hàng rào bảo vệ da",
  Dullness: "Da xỉn màu",
  "Anti-aging": "Dấu hiệu lão hóa",
};
const palette = [
  "#163f35",
  "#527456",
  "#8a9e67",
  "#b6c98b",
  "#d6e5b0",
  "#97b5a3",
  "#746f4e",
  "#c6b79a",
  "#6b9290",
  "#d8d5bf",
];

function finite(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const count = (value) => Math.max(0, finite(value) ?? 0);
const readable = (value, suffix = "") =>
  finite(value) == null ? "—" : `${number(Number(value))}${suffix}`;

/** The donut denominator is concern mentions, never consultation sessions. */
export function buildConcernSegments(rows = []) {
  const items = (Array.isArray(rows) ? rows : []).map((row, index) => ({
    label:
      concernLabels[row.skin_concern] ||
      concerns[row.concern] ||
      row.skin_concern ||
      row.concern ||
      "Mối quan tâm chưa đặt tên",
    count: count(row.count),
    color: palette[index % palette.length],
  }));
  const total = items.reduce((sum, row) => sum + row.count, 0);
  let offset = 0;
  return {
    total,
    items: items.map((row) => {
      const share = total ? (row.count / total) * 100 : 0;
      const item = { ...row, share, offset };
      offset += share;
      return item;
    }),
  };
}

function progressRing(value) {
  const progress = Math.min(100, Math.max(0, finite(value) ?? 0));
  return `<svg class="metric-ring" viewBox="0 0 72 72" aria-hidden="true"><circle class="metric-ring-track" cx="36" cy="36" r="29"/><circle class="metric-ring-fill" cx="36" cy="36" r="29" pathLength="100" stroke-dasharray="${progress} 100"/></svg>`;
}

function metric({
  label,
  value,
  glyph,
  note,
  percentage = false,
  featured = false,
}) {
  return `<article class="kpi botanical-kpi${featured ? " botanical-kpi-featured" : ""}"><div class="kpi-head"><span>${label}</span><span class="metric-symbol">${icon(glyph)}</span></div><div class="metric-body"><div class="kpi-value">${readable(value)}${percentage && finite(value) != null ? '<small aria-label="phần trăm">%</small>' : ""}</div>${percentage ? progressRing(value) : '<span class="metric-flourish" aria-hidden="true"></span>'}</div><p>${note}</p></article>`;
}

function dataTable(rows, label, title) {
  return `<details class="chart-data"><summary>Xem bảng dữ liệu ${icon("arrow")}</summary><div class="data-table-wrap"><table class="data-table"><caption class="sr-only">${title}</caption><thead><tr><th scope="col">${label}</th><th scope="col">Số lượt</th></tr></thead><tbody>${rows.map((row) => `<tr><th scope="row">${escape(row.label)}</th><td>${number(row.count)}</td></tr>`).join("") || '<tr><td colspan="2">Chưa có dữ liệu</td></tr>'}</tbody></table></div></details>`;
}

function concernChart(rows) {
  const { total, items } = buildConcernSegments(rows);
  const title = "Làn da đang cần điều gì?";
  const visual = total
    ? `<div class="concern-visual"><div class="concern-donut" role="img" aria-label="Tổng ${number(total)} lượt ghi nhận mối quan tâm. Tỷ trọng được tính trên tổng lượt ghi nhận."><svg viewBox="0 0 160 160" aria-hidden="true"><circle class="concern-donut-track" cx="80" cy="80" r="62"/>${items
        .filter((row) => row.count > 0)
        .map(
          (row) =>
            `<circle cx="80" cy="80" r="62" fill="none" stroke="${row.color}" stroke-width="20" pathLength="100" stroke-dasharray="${row.share} ${100 - row.share}" stroke-dashoffset="${-row.offset}" transform="rotate(-90 80 80)"/>`,
        )
        .join(
          "",
        )}</svg><div class="donut-center" aria-hidden="true"><strong>${number(total)}</strong><span>lượt ghi nhận</span></div></div><ul class="concern-legend">${items.map((row, index) => `<li class="concern-legend-item" tabindex="0" aria-describedby="concern-tip-${index}"><span class="legend-dot" style="--segment-color:${row.color}" aria-hidden="true"></span><span class="legend-label">${escape(row.label)}</span><strong>${number(row.share)}<small>%</small></strong><span class="chart-tooltip" role="tooltip" id="concern-tip-${index}">${escape(row.label)} · ${number(row.count)} lượt ghi nhận</span></li>`).join("")}</ul></div>`
    : '<div class="chart-empty"><span class="chart-empty-symbol" aria-hidden="true">' +
      icon("leaf") +
      "</span><p>Chưa có mối quan tâm được ghi nhận.</p><span>Dữ liệu sẽ xuất hiện sau những lượt tư vấn đầu tiên.</span></div>";
  return `<section class="chart-panel botanical-chart concern-panel" aria-labelledby="concern-chart-title"><div class="chart-title"><div><span class="chart-eyebrow">THẤU HIỂU LÀN DA</span><h2 id="concern-chart-title">${title}</h2></div><span class="chart-heading-symbol">${icon("leaf")}</span></div><p class="chart-subtitle">Những nhu cầu chăm sóc được ghi nhận khi tư vấn.</p>${visual}${dataTable(items, "Mối quan tâm", title)}<p class="chart-note">Một phiên có thể có nhiều mối quan tâm. Tỷ trọng tính trên tổng lượt ghi nhận mối quan tâm.</p></section>`;
}

function productsChart(rows) {
  const items = (Array.isArray(rows) ? rows : []).map((row) => ({
    label: row.product_name || "Sản phẩm chưa đặt tên",
    count: count(row.count),
  }));
  const max = Math.max(1, ...items.map((row) => row.count));
  const title = "Những lựa chọn được yêu thích";
  const visual = items.some((row) => row.count > 0)
    ? `<ol class="bar-chart botanical-bars" aria-label="Số phản hồi Quan tâm theo sản phẩm">${items.map((row, index) => `<li class="bar-row" tabindex="0" style="--bar:${(row.count / max) * 100}%;--order:${index}" aria-describedby="product-tip-${index}"><span class="product-bar-rank" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span><span class="bar-label">${escape(row.label)}</span><strong class="bar-value">${number(row.count)}<span class="sr-only"> lượt Quan tâm</span></strong><span class="bar-track" aria-hidden="true"><span class="bar-fill"></span></span><span class="chart-tooltip" role="tooltip" id="product-tip-${index}">${escape(row.label)} · ${number(row.count)} lượt Quan tâm</span></li>`).join("")}</ol>`
    : '<div class="chart-empty"><span class="chart-empty-symbol" aria-hidden="true">' +
      icon("heart") +
      "</span><p>Chưa có sản phẩm được quan tâm.</p><span>Phản hồi của khách hàng sẽ làm nên câu chuyện ở đây.</span></div>";
  return `<section class="chart-panel botanical-chart products-panel" aria-labelledby="products-chart-title"><div class="chart-title"><div><span class="chart-eyebrow">TỪ GỢI Ý ĐẾN QUAN TÂM</span><h2 id="products-chart-title">${title}</h2></div><span class="chart-heading-symbol">${icon("heart")}</span></div><p class="chart-subtitle">Sản phẩm nhận nhiều phản hồi Quan tâm từ khách hàng.</p>${visual}${dataTable(items, "Sản phẩm", title)}<p class="chart-note">Số phản hồi Quan tâm được nhóm theo tên sản phẩm trong các phiên tư vấn.</p></section>`;
}

/** Render only the four supported KPIs and two native TASK 4 chart datasets. */
export function renderDashboardView(data, { demo = false } = {}) {
  const kpis = data?.kpis || {};
  const charts = data?.charts || {};
  const missing = [
    "total_sessions",
    "leads_with_profile",
    "interest_rate",
    "average_top1_score",
  ].filter((key) => finite(kpis[key]) == null);
  const metrics = [
    {
      label: "Lượt tư vấn",
      value: kpis.total_sessions,
      glyph: "leaf",
      note: "Mỗi lượt tư vấn, một cơ hội thấu hiểu.",
      featured: true,
    },
    {
      label: "Khách có hồ sơ",
      value: kpis.leads_with_profile,
      glyph: "users",
      note: "Số khách hàng CRM có hồ sơ làn da.",
    },
    {
      label: "Tỷ lệ quan tâm",
      value: kpis.interest_rate,
      glyph: "heart",
      note: demo
        ? "Tỷ lệ minh họa trên sản phẩm đã có phản hồi."
        : "Tỷ lệ phiên có ít nhất một phản hồi Quan tâm.",
      percentage: true,
    },
    {
      label: "Độ phù hợp Top 1",
      value: kpis.average_top1_score,
      glyph: "spark",
      note: "Điểm trung bình của gợi ý xếp hạng đầu tiên.",
      percentage: true,
    },
  ];
  return `<div class="botanical-analytics">${missing.length ? '<div class="inline-alert" role="status">Một số chỉ số chưa được API cung cấp. Các ô tương ứng hiển thị dấu —.</div>' : ""}<div class="kpi-grid botanical-kpis">${metrics.map(metric).join("")}</div><div class="chart-grid botanical-chart-grid">${concernChart(charts.top_skin_concerns)}${productsChart(charts.top_interested_products)}</div><aside class="report-note botanical-report-note" aria-label="Phạm vi báo cáo">${icon("shield")}<p>${demo ? "Báo cáo minh họa sử dụng dữ liệu giả lập, tách biệt với CRM." : "Báo cáo toàn bộ thời gian, chỉ gồm CRM Lead bạn có quyền truy cập. Điểm Top 1 bỏ qua phiên không có gợi ý."}</p></aside>${!demo && finite(kpis.total_sessions) === 0 ? '<aside class="analytics-start"><div><span class="eyebrow">MỘT KHỞI ĐẦU MỚI</span><h2>Hành trình thấu hiểu bắt đầu từ đây.</h2><p>Tạo lượt tư vấn đầu tiên để ghi nhận nhu cầu và chăm sóc khách hàng.</p></div><a class="button primary" href="/beautymatch/consultation">Bắt đầu tư vấn ' + icon("arrow") + "</a></aside>" : ""}</div>`;
}
