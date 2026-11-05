import {
  ApiError,
  createLiveApi,
  readConsultation,
  feedbackMessage,
  normalizeRecommendation,
} from "./api.mjs?v=botanical-20261105-v2";
import { createDemoApi } from "./demo-api.mjs?v=botanical-20261105-v2";
import { renderDashboardView } from "./dashboard-view.mjs?v=botanical-20261105-v2";
import { enhanceProductPhotos } from "./product-photos.mjs?v=botanical-20261105-v2";
import {
  navigation,
  customerSelection,
  selectCustomer,
  leadUrl,
} from "./navigation.mjs?v=botanical-20261105-v2";
import {
  escape,
  money,
  number,
  dateTime,
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
} from "./components.mjs?v=botanical-20261105-v2";

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
root.querySelector(".topbar").outerHTML = navigation(page);

function resultHeader() {
  return `<div class="breadcrumbs"><a href="/beautymatch/consultation">Tư vấn làn da</a><span>/</span><span>Kết quả dành cho bạn</span></div><section class="hero results-hero"><div data-reveal><span class="eyebrow">GỢI Ý DÀNH RIÊNG CHO BẠN</span><h1>Sản phẩm phù hợp<br><em>với làn da của bạn.</em></h1><p>Dựa trên làn da và nhu cầu của bạn, chúng tôi đã chọn những gợi ý chăm sóc có cơ sở. Một lựa chọn nhỏ, dành cho vẻ đẹp riêng.</p></div><div id="result-profile" class="hero-profile" data-reveal></div></section>`;
}
function dashboardHeader() {
  if (!demo)
    return `<section class="dashboard-heading editorial-dashboard" data-reveal><div><span class="eyebrow">KHÔNG GIAN CHĂM SÓC KHÁCH HÀNG</span><h1>Tổng quan<br><em>BeautyMatch CRM.</em></h1><p>Mỗi lượt tư vấn để lại một câu chuyện. Cùng thấu hiểu nhu cầu và tiếp nối những sự quan tâm.</p></div><button class="button primary" data-action="export">${icon("download")} Xuất báo cáo CSV</button></section><div class="report-controls"><span class="muted">Toàn bộ thời gian · Báo cáo hiện chưa hỗ trợ lọc theo ngày.</span><button class="button secondary" type="button" data-action="retry">${icon("refresh")} Làm mới</button><span class="updated" id="updated">Dữ liệu thực từ CRM</span></div>`;
  return `<section class="dashboard-heading editorial-dashboard" data-reveal><div><span class="eyebrow">KHÔNG GIAN CHĂM SÓC KHÁCH HÀNG</span><h1>Tổng quan<br><em>BeautyMatch CRM.</em></h1><p>Mỗi lượt tư vấn để lại một câu chuyện. Cùng thấu hiểu nhu cầu và tiếp nối những sự quan tâm.</p></div><button class="button primary" data-action="export">${icon("download")} Xuất báo cáo CSV</button></section><form id="report-form" class="report-controls"><label class="field" for="start-date">Từ ngày<input type="date" id="start-date" value="${startDate}" required></label><label class="field" for="end-date">Đến ngày<input type="date" id="end-date" value="${today}" required></label><button class="button primary" type="submit">Xem báo cáo ${icon("arrow")}</button><button class="button secondary" type="button" data-action="retry">${icon("refresh")} Làm mới</button><span class="updated" id="updated">Khoảng thời gian tính cả ngày bắt đầu và kết thúc.</span></form>`;
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
        session_id: value,
      }),
    );
  try {
    const saved = JSON.parse(store.getItem("beautymatch_result_v1") || "null");
    const id = saved?.session_id || saved?.recommendation_session;
    return saved?.request_id === pending.request_id && typeof id === "string"
      ? id
      : null;
  } catch {
    return null;
  }
}
function renderResults(session, context, contextError) {
  const items = session.results.slice(0, 3);
  const assets = new Map((context?.products || []).map((p) => [p.name, p]));
  document.getElementById("result-profile").innerHTML = profileCard(
    context?.profile,
    session,
  );
  content.innerHTML = `${contextError ? `<div class="inline-alert" role="status">Kết quả đã sẵn sàng. Chưa tải được hồ sơ bổ sung. <button class="text-button" data-action="retry">Thử tải lại</button></div>` : ""}<div class="section-heading"><div><h2>Được chọn cho làn da bạn</h2><p>${items.length ? "Mỗi gợi ý đều có lý do. Bạn là người đưa ra lựa chọn." : "Sự phù hợp luôn là ưu tiên của chúng tôi."}</p></div><span class="small-pill">${items.length} gợi ý phù hợp</span></div>${items.length ? `<div class="product-grid count-${items.length}">${items.map((item) => productCard(item, assets.get(item.product), session.status === "Closed")).join("")}</div>` : statePanel({ title: "Chưa tìm thấy sự phù hợp", text: session.result_message || "Hãy thử điều chỉnh ngân sách hoặc nhu cầu ở một lượt tư vấn mới.", consultation: true })}<aside class="advice">${icon("shield")}<p><strong>Lựa chọn có cơ sở, chăm sóc có lắng nghe.</strong><br>Gợi ý dựa trên thông tin bạn cung cấp và dữ liệu sản phẩm. Sản phẩm có thể chỉ đáp ứng một phần nhu cầu; hãy xem giải thích và cảnh báo của từng gợi ý.</p></aside><div class="results-footer"><p>Thông tin mang tính tham khảo chăm sóc da.</p><div class="button-row"><button class="text-button" data-action="history">${icon("clock")} Lịch sử tư vấn</button><a class="button secondary" href="/beautymatch/consultation">Điều chỉnh nhu cầu ${icon("arrow")}</a></div></div>`;
  enhanceProductPhotos(content);
  for (const [id, response] of savedFeedback) showFeedback(id, response);
}
async function loadResult(selectedSession = null) {
  if (loading || feedbackInFlight.size) return;
  loading = true;
  content.setAttribute("aria-busy", "true");
  content.innerHTML = skeleton();
  document.getElementById("result-profile").innerHTML = "";
  try {
    let reopen = null;
    try {
      reopen = JSON.parse(
        storage().getItem("beautymatch_open_session_v1") || "null",
      );
    } catch {
      /* invalid stored context is ignored */
    }
    consultation = demo
      ? { crm_lead: "DEMO-LEAD" }
      : reopen?.session_id || selectedSession
        ? null
        : readConsultation(storage());
    if (!demo && !consultation && !selectedSession && !reopen?.session_id) {
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
      const existing =
        selectedSession || reopen?.session_id || sessionCache(consultation);
      session = existing
        ? await api.result(existing)
        : await api.generate(consultation);
      // Cache only the generated request's own session; history navigation cannot replace it.
      if (!selectedSession && !reopen && consultation && session.session_id)
        sessionCache(consultation, session.session_id);
    }
    session = normalizeRecommendation(session);
    if (!demo) {
      consultation = { ...consultation, crm_lead: session.crm_lead };
      selectCustomer(session.crm_lead);
      sessionStorage.setItem(
        "beautymatch_open_session_v1",
        JSON.stringify({
          session_id: session.session_id,
          crm_lead: session.crm_lead,
        }),
      );
    }
    currentSession = session;
    let contextError = false;
    try {
      currentContext = await api.context(session.session_id);
    } catch {
      currentContext = null;
      contextError = true;
    }
    renderResults(session, currentContext, contextError);
    if (!demo && currentContext?.customer) {
      const customer = currentContext.customer;
      content.insertAdjacentHTML(
        "afterbegin",
        `<section class="customer-session-bar"><div><strong>${escape(customer.display_name)}</strong><p class="muted">Phiên ${escape(session.session_id)} · ${escape(dateTime(currentContext.created_at))}</p></div><div class="button-row"><a class="button secondary" href="/beautymatch/customer">Hồ sơ & lịch sử</a><a class="button secondary" href="${escape(leadUrl(customer.crm_lead))}">Trở lại CRM Lead</a></div></section>`,
      );
      for (const item of currentContext.items || [])
        if (
          item.follow_up_status === "CREATED" ||
          item.follow_up_status === "PENDING"
        )
          showFeedback(item.item_id, {
            ...item,
            customer_feedback: "Interested",
            follow_up_task: item.task?.name,
          });
    }
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
async function loadDashboard() {
  if (loading) return;
  let dates;
  try {
    dates = demo ? reportDates() : {};
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
    content.innerHTML = renderDashboardView(data, { demo });
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
  enhanceProductPhotos(dialog);
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
  return currentSession?.results.find((item) => item.item_id === id);
}
function showFeedback(id, response) {
  const target = [...document.querySelectorAll("[data-feedback]")].find(
    (el) => el.dataset.feedback === id,
  );
  if (!target) return;
  const message = feedbackMessage(response);
  const task = (currentContext?.items || []).find(
    (item) => item.item_id === id,
  )?.task;
  target.innerHTML = `<div class="feedback-notice ${message.kind}" role="status"><strong>${escape(message.title)}</strong>${escape(message.text)}${task ? `<a class="text-button" href="${escape(task.url)}">Mở CRM Task ${escape(task.name)} · ${escape(task.status)}</a>` : ""}</div>`;
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
      previous.follow_up_status === "CREATED")
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
      session_id: currentSession.session_id,
      item_id: id,
      customer_feedback: choice,
    };
    if (choice === "Not Interested" && reason)
      payload.rejection_reason = reason;
    if (choice === "Not Interested" && !reason)
      throw new ApiError("Vui lòng chọn lý do không quan tâm.");
    const response = await api.feedback(payload);
    if (
      response.item_id !== id ||
      response.session_id !== currentSession.session_id ||
      response.customer_feedback !== choice
    )
      throw new ApiError("Máy chủ chưa xác nhận đúng phản hồi đã gửi.");
    feedbackMessage(response); // Validate before presenting confirmation.
    item.customer_feedback = response.customer_feedback;
    const confirmed = { ...response, rejection_reason: reason || "" };
    if (!demo) {
      try {
        currentContext = await api.context(currentSession.session_id);
      } catch {
        /* confirmation still uses the successful feedback response */
      }
    }
    savedFeedback.set(id, confirmed);
    showFeedback(id, confirmed);
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
    `<p>Bạn chưa quan tâm đến ${escape(item.product_name)}? Vui lòng chọn lý do để chúng tôi hiểu hơn.</p><form id="reject-form" data-id="${escape(id)}"><label class="field" for="rejection-reason">Lý do không quan tâm (bắt buộc)<select id="rejection-reason" required><option value="">Chọn lý do</option>${["Không thích thương hiệu", "Không phù hợp sở thích cá nhân", "Đã từng sử dụng", "Muốn tìm lựa chọn khác", "Khác"].map((value) => `<option>${value}</option>`).join("")}</select></label><div class="dialog-status muted" aria-live="polite"></div><div class="button-row"><button type="button" class="button secondary" data-action="close-dialog">Quay lại</button><button type="submit" class="button primary">Gửi phản hồi ${icon("arrow")}</button></div></form>`,
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
            `<button class="history-item" data-action="open-session" data-session="${escape(session.session_id)}"><div>${escape(categories[session.requested_category] || session.requested_category)} · ${money(session.max_budget)}<span>${Number(session.number_of_recommendations) || 0} gợi ý · ${escape({ Generated: "Đã tạo gợi ý", "Follow-up Created": "Đã tạo lịch theo dõi", "Feedback Received": "Đã nhận phản hồi", Closed: "Đã đóng" }[session.status] || session.status)}</span></div>${icon("arrow")}</button>`,
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
  const image = safeUrl(item.image_url ?? asset.image_url);
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
    ...(demo
      ? [
          ["Từ ngày", data.start_date],
          ["Đến ngày", data.end_date],
        ]
      : [["Phạm vi", "Toàn bộ thời gian"]]),
    [],
    ["Chỉ số", "Giá trị"],
    ...Object.entries(data.kpis),
    [],
    ["Mối quan tâm", "Lượt"],
    ...(data.charts.top_skin_concerns || []).map((row) => [
      row.skin_concern || concerns[row.concern] || row.concern,
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
  a.download = demo
    ? `beautymatch-demo-${data.start_date}-${data.end_date}.csv`
    : "beautymatch-toan-bo-thoi-gian.csv";
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
      ? loadResult(currentSession?.session_id)
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
