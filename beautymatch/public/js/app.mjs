import {
  ApiError,
  createLiveApi,
  readConsultation,
  feedbackMessage,
} from "./api.mjs";
import { createDemoApi } from "./demo-api.mjs";
import {
  escape,
  money,
  number,
  icon,
  safeUrl,
  statePanel,
  skeleton,
  profileCard,
  productCard,
  photoMarkup,
  barChart,
  concerns,
  categories,
} from "./components.mjs";

const root = document.getElementById("app");
const page =
  document.body.dataset.page === "dashboard" ? "dashboard" : "result";
const demo = new URLSearchParams(location.search).get("demo") === "1";
const api = demo
  ? createDemoApi()
  : createLiveApi({
      csrf: document.querySelector('meta[name="csrf-token"]')?.content || "",
    });
let currentSession = null;
let currentContext = null;
let consultation = null;
let dashboardData = null;
let loading = false;
let activeDialog = null;
const feedbackInFlight = new Set();
const savedFeedback = new Map();
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Ho_Chi_Minh",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const dateParts = today.split("-").map(Number);
const startDate = new Date(
  Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2] - 29),
)
  .toISOString()
  .slice(0, 10);
const modeLink = (path) => `${path}${demo ? "?demo=1" : ""}`;

document.body.classList.toggle("demo-mode", demo);
document.title = `${page === "dashboard" ? "Tổng quan CRM" : "Gợi ý dành cho bạn"} | BeautyMatch`;
root.innerHTML = `
  <header class="topbar"><div class="container header-inner"><a class="brand" href="${modeLink("/beautymatch/result")}" aria-label="BeautyMatch · Trang kết quả"><img src="/assets/beautymatch/images/leaf.svg" alt=""><span>Beauty<span>Match</span></span></a><nav class="nav" aria-label="Điều hướng chính"><a href="/beautymatch/consultation">Tư vấn làn da</a><a href="${modeLink("/beautymatch/result")}" class="${page === "result" ? "active" : ""}" ${page === "result" ? 'aria-current="page"' : ""}>Gợi ý sản phẩm</a><a href="${modeLink("/beautymatch/dashboard")}" class="${page === "dashboard" ? "active" : ""}" ${page === "dashboard" ? 'aria-current="page"' : ""}>Tổng quan CRM</a></nav><span class="staff-chip"><i></i> Không gian tư vấn</span></div></header>
  <aside class="modebar" aria-label="Chế độ dữ liệu"><div class="container mode-inner"><span class="mode-label">${icon(demo ? "info" : "shield")}${demo ? "CHẾ ĐỘ MINH HỌA · Hồ sơ, điểm số, phản hồi và báo cáo giả lập. Không ghi vào CRM." : "Dữ liệu Frappe CRM · Dành cho nhân viên được cấp quyền"}</span><button data-action="toggle-mode">${demo ? "Dùng dữ liệu thật" : "Xem bản minh họa"}</button></div></aside>
  <main id="main" class="container ${page === "dashboard" ? "dashboard-main" : ""}" tabindex="-1">${page === "result" ? resultHeader() : dashboardHeader()}${demo ? demoControls() : ""}<div id="content" aria-busy="true">${skeleton()}</div></main>
  <footer class="site-footer"><div class="container footer-inner"><span class="footer-brand">BeautyMatch <span class="muted">/ Chăm sóc đúng, tự tin hơn.</span></span><span>Hiểu làn da. Tìm sự phù hợp.</span><div class="footer-links"><a href="${modeLink("/beautymatch/dashboard")}">Tổng quan CRM ${icon("arrow")}</a><button class="text-button" data-action="privacy">Quyền riêng tư</button></div></div></footer>
  <dialog class="dialog" id="dialog" aria-labelledby="dialog-title"></dialog><div id="toast" role="status" class="toast" hidden></div>`;
const content = document.getElementById("content");
const dialog = document.getElementById("dialog");

function resultHeader() {
  return `<div class="breadcrumbs"><a href="/beautymatch/consultation">Tư vấn làn da</a><span>/</span><span>Kết quả dành cho bạn</span></div><section class="hero"><div><span class="eyebrow">MỖI LÀN DA, MỘT CÁCH CHĂM SÓC</span><h1>Một chút thấu hiểu.<br><em>Một lựa chọn phù hợp hơn.</em></h1><p>Những gợi ý được chọn dựa trên làn da, mối quan tâm và ngân sách của bạn. Khám phá điều phù hợp với riêng mình.</p></div><div class="hero-seal" aria-hidden="true"><span>CHỌN LỌC</span>${icon("leaf")}<span>CHO RIÊNG BẠN</span></div></section>`;
}
function dashboardHeader() {
  return `<section class="dashboard-heading"><div><span class="eyebrow">BEAUTYMATCH / CRM ANALYTICS</span><h1>Thấu hiểu từ mỗi lượt tư vấn</h1><p>Theo dõi nhu cầu làn da và những sản phẩm được khách hàng quan tâm.</p></div><button class="button secondary" data-action="export">${icon("download")} Xuất báo cáo CSV</button></section><form id="report-form" class="report-controls"><label class="field" for="start-date">Từ ngày<input type="date" id="start-date" value="${startDate}" required></label><label class="field" for="end-date">Đến ngày<input type="date" id="end-date" value="${today}" required></label><button class="button primary" type="submit">Xem báo cáo ${icon("arrow")}</button><button class="button secondary" type="button" data-action="retry">${icon("refresh")} Làm mới</button><span class="updated" id="updated">Khoảng thời gian tính cả ngày bắt đầu và kết thúc.</span></form>`;
}
function demoControls() {
  return `<div class="demo-scenarios"><label class="field">Trạng thái minh họa<select id="demo-scenario"><option value="three">${page === "result" ? "3 sản phẩm" : "Có dữ liệu"}</option>${page === "result" ? '<option value="one">1 sản phẩm</option><option value="two">2 sản phẩm</option>' : ""}<option value="empty">Không có kết quả</option><option value="error">Lỗi kết nối</option></select></label>${page === "result" ? '<label class="field">Kết quả gửi phản hồi<select id="demo-feedback"><option value="CREATED">CREATED · Thành công</option><option value="PENDING">PENDING · Chờ xử lý</option><option value="ERROR">Lỗi gửi phản hồi</option></select></label>' : ""}</div>`;
}
function notify(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => {
    toast.hidden = true;
  }, 4500);
}
function storage() {
  try {
    return window.sessionStorage;
  } catch {
    throw new ApiError(
      "Trình duyệt chặn sessionStorage. Vui lòng bật lưu trữ cho site để mở kết quả.",
    );
  }
}
function sessionCache(pending, value) {
  const store = storage();
  if (value)
    store.setItem(
      "beautymatch_result_v1",
      JSON.stringify({
        request_id: pending.request_id,
        recommendation_session: value,
      }),
    );
  try {
    const saved = JSON.parse(store.getItem("beautymatch_result_v1") || "null");
    return saved?.request_id === pending.request_id &&
      typeof saved.recommendation_session === "string"
      ? saved.recommendation_session
      : null;
  } catch {
    return null;
  }
}
function renderResults(session, context, contextError) {
  const items = session.results.slice(0, 3);
  const assets = new Map((context?.products || []).map((p) => [p.name, p]));
  content.innerHTML = `${contextError ? `<div class="inline-alert" role="status">Kết quả đã sẵn sàng. Chưa tải được hồ sơ hoặc ảnh sản phẩm. <button class="text-button" data-action="retry">Thử tải lại</button></div>` : ""}${profileCard(context?.profile, session)}<div class="section-heading"><div><h2>Được chọn cho làn da bạn</h2><p>${items.length ? "Mỗi gợi ý đều có lý do. Bạn là người đưa ra lựa chọn." : "Sự phù hợp luôn là ưu tiên của chúng tôi."}</p></div><span class="small-pill">${items.length} gợi ý phù hợp</span></div>${items.length ? `<div class="product-grid">${items.map((item) => productCard(item, assets.get(item.product), session.status === "Closed")).join("")}</div>` : statePanel({ title: "Chưa tìm thấy sự phù hợp", text: session.result_message || "Hãy thử điều chỉnh ngân sách hoặc nhu cầu ở một lượt tư vấn mới.", consultation: true })}<aside class="advice">${icon("shield")}<p><strong>Lựa chọn có cơ sở, chăm sóc có lắng nghe.</strong><br>Gợi ý dựa trên thông tin bạn cung cấp và dữ liệu sản phẩm. Sản phẩm có thể chỉ đáp ứng một phần nhu cầu; hãy xem giải thích và cảnh báo của từng gợi ý.</p></aside><div class="results-footer"><p>Thông tin mang tính tham khảo chăm sóc da.</p><div class="button-row"><button class="text-button" data-action="history">${icon("clock")} Lịch sử tư vấn</button><a class="button secondary" href="/beautymatch/consultation">Điều chỉnh nhu cầu ${icon("arrow")}</a></div></div>`;
  content.querySelectorAll("img").forEach((img) =>
    img.addEventListener(
      "error",
      () => {
        const placeholder = document.createElement("div");
        placeholder.className = "photo-placeholder";
        placeholder.innerHTML = `${icon("leaf")}<span>Chưa có ảnh sản phẩm</span>`;
        img.replaceWith(placeholder);
      },
      { once: true },
    ),
  );
  for (const [id, response] of savedFeedback) showFeedback(id, response);
}
async function loadResult(selectedSession = null) {
  if (loading || feedbackInFlight.size) return;
  loading = true;
  content.setAttribute("aria-busy", "true");
  content.innerHTML = skeleton();
  try {
    consultation = demo
      ? { crm_lead: "DEMO-LEAD" }
      : readConsultation(storage());
    if (!demo && !consultation) {
      content.innerHTML = statePanel({
        title: "Bắt đầu từ làn da của bạn",
        text: "Chưa có phiên tư vấn trong tab này. Hoàn thành trang tư vấn để nhận những gợi ý dành riêng cho bạn.",
        consultation: true,
      });
      return;
    }
    let session;
    if (demo) session = await api.result();
    else {
      const existing = selectedSession || sessionCache(consultation);
      session = existing
        ? await api.result(existing)
        : await api.generate(consultation);
      // Cache only the generated request's own session; history navigation cannot replace it.
      if (!selectedSession && session.recommendation_session)
        sessionCache(consultation, session.recommendation_session);
    }
    if (!session.recommendation_session || !Array.isArray(session.results))
      throw new ApiError(
        "Kết quả API thiếu phiên tư vấn hoặc danh sách sản phẩm.",
      );
    currentSession = session;
    let contextError = false;
    try {
      currentContext = await api.context(session.recommendation_session);
    } catch {
      currentContext = null;
      contextError = true;
    }
    renderResults(session, currentContext, contextError);
  } catch (error) {
    currentSession = null;
    content.innerHTML = statePanel({
      title: "Chưa thể tải gợi ý",
      text: error.message,
      error: true,
      retry: true,
      consultation: true,
    });
  } finally {
    loading = false;
    content.setAttribute("aria-busy", "false");
  }
}
function reportDates() {
  const start = document.getElementById("start-date").value;
  const end = document.getElementById("end-date").value;
  if (
    !start ||
    !end ||
    start > end ||
    (Date.parse(end) - Date.parse(start)) / 86400000 > 366
  )
    throw new ApiError(
      "Chọn ngày bắt đầu trước ngày kết thúc, trong khoảng tối đa 366 ngày.",
    );
  return { start_date: start, end_date: end };
}
function metric(label, value, glyph, note, unit = "") {
  return `<article class="kpi"><div class="kpi-head"><span>${label}</span><span>${icon(glyph)}</span></div><div class="kpi-value">${value == null ? "—" : number(value)}<small>${value == null ? "" : unit}</small></div><p>${note}</p></article>`;
}
function chart(title, subtitle, rows, key, vertical = false) {
  return `<section class="chart-panel"><div class="chart-title"><h2>${title}</h2>${icon(vertical ? "heart" : "leaf")}</div><p class="chart-subtitle">${subtitle}</p>${barChart(rows, key, { vertical })}<details><summary>Xem bảng dữ liệu</summary><table class="data-table"><caption class="sr-only">${title}</caption><thead><tr><th scope="col">${vertical ? "Sản phẩm" : "Mối quan tâm"}</th><th scope="col">Lượt</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escape(row[key])}</td><td>${number(row.count)}</td></tr>`).join("") || '<tr><td colspan="2">Chưa có dữ liệu</td></tr>'}</tbody></table></details><p class="chart-note">${vertical ? "Số phản hồi Quan tâm theo sản phẩm trong kỳ." : "Một phiên có thể có nhiều mối quan tâm về da."}</p></section>`;
}
async function loadDashboard() {
  if (loading) return;
  let dates;
  try {
    dates = reportDates();
  } catch (error) {
    notify(error.message);
    return;
  }
  loading = true;
  dashboardData = null;
  content.setAttribute("aria-busy", "true");
  content.innerHTML = skeleton();
  const controls = document.querySelectorAll(
    "#report-form button, #report-form input",
  );
  controls.forEach((el) => {
    el.disabled = true;
  });
  try {
    const data = await api.dashboard(dates);
    if (
      !data.kpis ||
      !data.charts ||
      !Array.isArray(data.charts.top_skin_concerns) ||
      !Array.isArray(data.charts.top_interested_products)
    )
      throw new ApiError("Báo cáo API chưa đúng cấu trúc.");
    dashboardData = data;
    const k = data.kpis;
    const skinRows = (data.charts.top_skin_concerns || []).map((row) => ({
      ...row,
      label: concerns[row.concern] || row.concern,
    }));
    const products = data.charts.top_interested_products || [];
    const missing = [
      "leads_with_profile",
      "interest_rate",
      "average_top1_score",
    ].filter((key) => !(key in k));
    content.innerHTML = `${missing.length ? '<div class="inline-alert">Một số chỉ số chưa được API cung cấp. Các ô tương ứng hiển thị dấu —.</div>' : ""}<div class="kpi-grid">${metric("Lượt tư vấn", k.total_sessions, "users", "Tổng phiên trong khoảng đã chọn")}${metric("Khách có hồ sơ", k.leads_with_profile, "leaf", "Lead có hồ sơ Active, đồng ý lưu trữ")}${metric("Tỷ lệ quan tâm", k.interest_rate, "heart", "Trên các sản phẩm đã có phản hồi", "%")}${metric("Độ phù hợp Top 1", k.average_top1_score, "spark", "Điểm trung bình gợi ý đầu tiên", "%")}</div><div class="chart-grid">${chart("Làn da đang cần điều gì?", "Các mối quan tâm phổ biến trong phiên tư vấn", skinRows, "label")}${chart("Những lựa chọn được yêu thích", "Sản phẩm nhận nhiều sự quan tâm nhất", products, "product_name", true)}</div><div class="report-note">${icon("shield")}<p>Dữ liệu chỉ gồm CRM Lead bạn có quyền truy cập. Điểm Top 1 bỏ qua phiên không có gợi ý. Khách có hồ sơ được tính theo Lead duy nhất có phiên tư vấn trong kỳ.</p></div>${!demo && !k.total_sessions ? '<div class="dashboard-secondary">' + statePanel({ title: "Khởi đầu một hành trình thấu hiểu", text: "Chưa có lượt tư vấn trong khoảng thời gian này. Thử chọn khoảng thời gian khác hoặc tạo lượt tư vấn đầu tiên.", consultation: true }) + "</div>" : ""}`;
    document.getElementById("updated").textContent =
      `Cập nhật ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())} · ${demo ? "Dữ liệu minh họa" : "Frappe CRM"}`;
  } catch (error) {
    content.innerHTML = statePanel({
      title: "Chưa thể tải báo cáo",
      text: error.message,
      error: true,
      retry: true,
    });
  } finally {
    loading = false;
    content.setAttribute("aria-busy", "false");
    controls.forEach((el) => {
      el.disabled = false;
    });
  }
}
function openDialog(title, body, onClose) {
  const wasOpen = dialog.open;
  if (!wasOpen) activeDialog = { trigger: document.activeElement, onClose };
  dialog.innerHTML = `<div class="dialog-inner"><div class="dialog-head"><h2 id="dialog-title">${escape(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="Đóng">${icon("close")}</button></div>${body}</div>`;
  if (!wasOpen) dialog.showModal();
}
dialog.addEventListener("close", () => {
  const previous = activeDialog;
  activeDialog = null;
  previous?.trigger?.focus();
  previous?.onClose?.();
});
dialog.addEventListener("click", (event) => {
  if (event.target === dialog && !dialog.querySelector('[aria-busy="true"]'))
    dialog.close();
});
dialog.addEventListener("cancel", (event) => {
  if (dialog.querySelector('[aria-busy="true"]')) event.preventDefault();
});
function findItem(id) {
  return currentSession?.results.find(
    (item) => item.recommendation_item === id,
  );
}
function showFeedback(id, response) {
  const target = [...document.querySelectorAll("[data-feedback]")].find(
    (el) => el.dataset.feedback === id,
  );
  if (!target) return;
  const message = feedbackMessage(response);
  target.innerHTML = `<div class="feedback-notice ${message.kind}" role="status"><strong>${escape(message.title)}</strong>${escape(message.text)}</div>`;
}
async function sendFeedback(id, choice, reason) {
  const item = findItem(id);
  if (!item || !currentSession || feedbackInFlight.has(id) || loading)
    return false;
  const previous = savedFeedback.get(id);
  if (
    previous?.customer_feedback === choice &&
    (previous.rejection_reason || "") === (reason || "") &&
    (choice !== "Interested" ||
      previous.follow_up_task ||
      previous.status === "CREATED")
  ) {
    showFeedback(id, previous);
    return true;
  }
  const card = [...document.querySelectorAll(".product-card")].find(
    (el) => el.dataset.item === id,
  );
  const buttons = card?.querySelectorAll(".feedback-actions button") || [];
  const clicked = [...buttons].find(
    (el) =>
      el.dataset.action === (choice === "Interested" ? "interested" : "reject"),
  );
  const oldText = clicked?.innerHTML;
  feedbackInFlight.add(id);
  buttons.forEach((button) => {
    button.disabled = true;
  });
  if (clicked) clicked.textContent = "Đang gửi…";
  try {
    const payload = {
      recommendation_session: currentSession.recommendation_session,
      recommendation_item: id,
      feedback: choice,
    };
    if (choice === "Not Interested" && reason)
      payload.rejection_reason = reason;
    const response = await api.feedback(payload);
    if (
      response.recommendation_item !== id ||
      response.recommendation_session !==
        currentSession.recommendation_session ||
      response.customer_feedback !== choice
    )
      throw new ApiError("Máy chủ chưa xác nhận đúng phản hồi đã gửi.");
    feedbackMessage(response); // Validate before presenting confirmation.
    item.customer_feedback = response.customer_feedback;
    savedFeedback.set(id, response);
    showFeedback(id, response);
    return true;
  } catch (error) {
    const target = card?.querySelector(".feedback-status");
    if (target) {
      const errorDiv = document.createElement("div");
      errorDiv.className = "feedback-notice error";
      errorDiv.setAttribute("role", "alert");
      errorDiv.textContent = error.message;
      target.replaceChildren(errorDiv);
    }
    const dialogStatus = dialog.querySelector(".dialog-status");
    if (dialogStatus) {
      dialogStatus.textContent = error.message;
      dialogStatus.setAttribute("role", "alert");
    }
    return false;
  } finally {
    feedbackInFlight.delete(id);
    buttons.forEach((button) => {
      button.disabled = false;
    });
    if (clicked) clicked.innerHTML = oldText;
  }
}
function rejectDialog(id) {
  const item = findItem(id);
  if (!item) return;
  openDialog(
    "Cảm ơn bạn đã chia sẻ",
    `<p>Bạn chưa quan tâm đến ${escape(item.product_name)}? Bạn có thể chọn lý do để chúng tôi hiểu hơn. Đây là thông tin không bắt buộc.</p><form id="reject-form" data-id="${escape(id)}"><label class="field" for="rejection-reason">Lý do (không bắt buộc)<select id="rejection-reason"><option value="">Không chọn lý do</option>${["Không thích thương hiệu", "Không phù hợp sở thích cá nhân", "Đã từng sử dụng", "Muốn tìm lựa chọn khác", "Khác"].map((value) => `<option>${value}</option>`).join("")}</select></label><div class="dialog-status muted" aria-live="polite"></div><div class="button-row"><button type="button" class="button secondary" data-action="close-dialog">Quay lại</button><button type="submit" class="button primary">Gửi phản hồi ${icon("arrow")}</button></div></form>`,
  );
}
async function historyDialog(start = 0, append = false) {
  if (!consultation) return;
  if (!append)
    openDialog(
      "Lịch sử tư vấn",
      `<div class="dialog-history">${skeleton()}</div><div class="dialog-status" aria-live="polite"></div>`,
    );
  const list = dialog.querySelector(".dialog-history");
  if (!list) return;
  try {
    const data = await api.history(consultation.crm_lead, start);
    if (!Array.isArray(data.sessions))
      throw new ApiError("Lịch sử API không hợp lệ.");
    const rows =
      data.sessions
        .map(
          (session) =>
            `<button class="history-item" data-action="open-session" data-session="${escape(session.recommendation_session)}"><div>${escape(categories[session.requested_category] || session.requested_category)} · ${money(session.max_budget)}<span>${Number(session.number_of_recommendations) || 0} gợi ý · ${escape({ Generated: "Đã tạo gợi ý", "Follow-up Created": "Đã tạo lịch theo dõi", "Feedback Received": "Đã nhận phản hồi", Closed: "Đã đóng" }[session.status] || session.status)}</span></div>${icon("arrow")}</button>`,
        )
        .join("") || "<p>Chưa có lịch sử tư vấn.</p>";
    if (append) {
      dialog.querySelector('[data-action="more-history"]')?.remove();
      list.insertAdjacentHTML("beforeend", rows);
    } else list.innerHTML = rows;
    if (data.start + data.sessions.length < data.total)
      list.insertAdjacentHTML(
        "beforeend",
        `<button class="button secondary" data-action="more-history" data-start="${data.start + data.sessions.length}">Xem thêm</button>`,
      );
  } catch (error) {
    list.textContent = error.message;
    list.insertAdjacentHTML(
      "beforeend",
      '<button class="button secondary" data-action="history">Thử lại</button>',
    );
  }
}
function productDialog(id) {
  const item = findItem(id);
  if (!item) return;
  const asset =
    currentContext?.products?.find(
      (product) => product.name === item.product,
    ) || {};
  const image = safeUrl(asset.image_url);
  openDialog(
    "Thông tin sản phẩm",
    `${image ? `<div class="product-photo detail-photo">${photoMarkup(image, item.product_name, asset.photo_crop)}</div>` : ""}<span class="eyebrow">${escape(item.brand)}</span><h3>${escape(item.product_name)}</h3><p class="product-price">${money(item.price)}</p><p>${escape(item.why_recommended)}</p>${asset.key_ingredients ? `<h4>Thành phần nổi bật</h4><p>${escape(asset.key_ingredients)}</p>` : ""}<p>Chưa có đường dẫn sản phẩm trong catalog.${asset.data_as_of ? ` Dữ liệu catalog: ${escape(asset.data_as_of)}.` : ""}</p><button class="button primary" data-action="close-dialog">Đã hiểu</button>`,
  );
}
function exportReport() {
  if (!dashboardData) {
    notify("Tải báo cáo thành công trước khi xuất dữ liệu.");
    return;
  }
  const data = dashboardData;
  const rows = [
    ["BeautyMatch", demo ? "DEMO — Dữ liệu giả lập" : "Frappe CRM"],
    ["Từ ngày", data.start_date],
    ["Đến ngày", data.end_date],
    [],
    ["Chỉ số", "Giá trị"],
    ...Object.entries(data.kpis),
    [],
    ["Mối quan tâm", "Lượt"],
    ...(data.charts.top_skin_concerns || []).map((row) => [
      concerns[row.concern] || row.concern,
      row.count,
    ]),
    [],
    ["Sản phẩm được quan tâm", "Lượt"],
    ...(data.charts.top_interested_products || []).map((row) => [
      row.product_name,
      row.count,
    ]),
  ];
  const cell = (value) =>
    `"${String(value ?? "")
      .replace(/^[=+@\-\t\r]/, "'$&")
      .replace(/"/g, '""')}"`;
  const csv =
    "\ufeff" + rows.map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = `beautymatch-${demo ? "demo-" : ""}${data.start_date}-${data.end_date}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify("Đã xuất báo cáo CSV.");
}
document.addEventListener("click", async (event) => {
  const control = event.target.closest("[data-action]");
  if (!control || control.disabled) return;
  const action = control.dataset.action;
  if (action === "toggle-mode") {
    const target = new URL(location.href);
    target.search = "";
    target.hash = "";
    if (!demo) target.searchParams.set("demo", "1");
    location.assign(target.pathname + target.search);
  }
  if (action === "retry")
    page === "result"
      ? loadResult(currentSession?.recommendation_session)
      : loadDashboard();
  if (action === "interested")
    await sendFeedback(control.dataset.id, "Interested");
  if (action === "reject") rejectDialog(control.dataset.id);
  if (action === "detail") productDialog(control.dataset.id);
  if (action === "close-dialog" && !dialog.querySelector('[aria-busy="true"]'))
    dialog.close();
  if (action === "history") await historyDialog();
  if (action === "more-history") {
    control.disabled = true;
    await historyDialog(Number(control.dataset.start), true);
    control.disabled = false;
  }
  if (action === "open-session") {
    const session = control.dataset.session;
    dialog.close();
    await loadResult(session);
  }
  if (action === "export") exportReport();
  if (action === "privacy")
    openDialog(
      "Thông tin của bạn",
      '<p>Thông tin định danh của phiên tư vấn được chuyển trong sessionStorage của tab hiện tại và trong nội dung yêu cầu API. BeautyMatch không đưa thông tin khách hàng vào URL.</p><p>Chỉ nhân viên có quyền truy cập CRM Lead mới được xem kết quả và gửi phản hồi. Chế độ minh họa sử dụng bộ dữ liệu riêng, không ghi vào CRM.</p><button class="button primary" data-action="close-dialog">Đã hiểu</button>',
    );
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "report-form") {
    event.preventDefault();
    await loadDashboard();
  }
  if (event.target.id === "reject-form") {
    event.preventDefault();
    const form = event.target;
    if (form.getAttribute("aria-busy") === "true") return;
    form.setAttribute("aria-busy", "true");
    const buttons = dialog.querySelectorAll("button");
    buttons.forEach((button) => {
      button.disabled = true;
    });
    const success = await sendFeedback(
      form.dataset.id,
      "Not Interested",
      document.getElementById("rejection-reason").value,
    );
    form.removeAttribute("aria-busy");
    buttons.forEach((button) => {
      button.disabled = false;
    });
    if (success) dialog.close();
  }
});
document
  .getElementById("demo-scenario")
  ?.addEventListener("change", async (event) => {
    // Do not let scenario changes race an outstanding feedback submission.
    if (loading || feedbackInFlight.size) {
      event.target.value = event.target.dataset.previous || "three";
      notify("Vui lòng chờ yêu cầu hiện tại hoàn tất.");
      return;
    }
    event.target.dataset.previous = event.target.value;
    api.setScenario(event.target.value);
    savedFeedback.clear();
    page === "result" ? await loadResult() : await loadDashboard();
  });
document
  .getElementById("demo-feedback")
  ?.addEventListener("change", (event) =>
    api.setFeedbackState(event.target.value),
  );
if (page === "result") await loadResult();
else await loadDashboard();
