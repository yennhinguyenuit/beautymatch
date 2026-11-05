import { createLiveApi } from "./api.mjs?v=botanical-20261105-v2";
import { overviewMarkup } from "./home-view.mjs?v=botanical-20261105-v2";
import {
  escape,
  money,
  number,
  dateTime as date,
  icon,
  profileCard,
  skeleton,
  statePanel,
  categories,
  concerns,
} from "./components.mjs?v=botanical-20261105-v2";
import {
  navigation,
  footer,
  selectCustomer,
  customerSelection,
  openSession,
  customerActions,
} from "./navigation.mjs?v=botanical-20261105-v2";
const page = document.body.dataset.page;
const api = createLiveApi({
  csrf: document.querySelector('meta[name="csrf-token"]')?.content || "",
});
const root = document.getElementById("app");
let history = [],
  start = 0,
  busy = false;
if (page === "consultation") {
  root.insertAdjacentHTML("afterbegin", navigation(page));
  root.insertAdjacentHTML("beforeend", footer());
  const selected = customerSelection();
  const notice = document.createElement("aside");
  notice.setAttribute("aria-label", "Ngữ cảnh tư vấn");
  notice.className = "container consultation-context";
  root.querySelector(".bm-page").before(notice);
  notice.innerHTML =
    '<a class="text-button" href="/beautymatch">← Chọn khách hàng</a>';
  if (selected?.crm_lead) {
    window.beautymatchSelectedLead = selected.crm_lead;
    document.getElementById("bm-submit").disabled = true;
    try {
      const customer = await api.customerContext(selected.crm_lead);
      notice.innerHTML = `<div class="inline-alert">Đang tư vấn cho <strong>${escape(customer.full_name)}</strong> · <a href="/beautymatch/customer">Xem hồ sơ và lịch sử</a></div>`;
      let retry = null;
      try {
        retry = JSON.parse(
          sessionStorage.getItem("beautymatch_intake_retry_v1") || "null",
        );
      } catch {
        /* Invalid local retry state is ignored. */
      }
      // The form has already restored the exact retry payload. Do not replace it
      // with a newer profile while retaining the original request_id.
      const values =
        retry?.crm_lead === selected.crm_lead
          ? {}
          : {
              full_name: customer.full_name,
              email: customer.email,
              phone: customer.phone,
              ...customer.profile,
            };
      for (const [key, value] of Object.entries(values)) {
        const field = document.querySelector(
          `#bm-consultation-form [name="${key}"]`,
        );
        if (!field || value == null) continue;
        if (field.type === "checkbox")
          field.checked = [1, true, "1"].includes(value);
        else field.value = value;
      }
      for (const key of ["email", "phone"]) {
        const field = document.querySelector(`[name="${key}"]`);
        if (customer[key]) field.readOnly = true;
      }
      window.beautymatchSelectedLead = customer.crm_lead;
      document.getElementById("bm-submit").disabled = false;
    } catch (error) {
      notice.innerHTML = statePanel({
        title: "Không thể mở khách hàng",
        text: error.message,
        error: true,
      });
      document.getElementById("bm-submit").disabled = true;
    }
  }
  try {
    const preset = JSON.parse(
      sessionStorage.getItem("beautymatch_sample_profile_v1") || "null",
    );
    if (preset) {
      for (const [key, value] of Object.entries(preset)) {
        const field = document.querySelector(
          `#bm-consultation-form [name="${key}"]`,
        );
        if (!field) continue;
        if (field.type === "checkbox")
          field.checked = [1, true, "1"].includes(value);
        else field.value = value ?? "";
      }
      notice.insertAdjacentHTML(
        "beforeend",
        '<div class="inline-alert">Đang dùng thông số trình diễn. Bạn vẫn cần nhập thông tin khách hàng và xác nhận đồng ý. Kết quả sẽ được tạo bằng API và lưu vào CRM thật.</div>',
      );
    }
  } catch {
    /* Ignore an invalid optional input preset. */
  }
  document.dispatchEvent(new CustomEvent("beautymatch:consultation-ready"));
} else {
  root.innerHTML = `${navigation(page)}<main id="main" class="container workspace-main" tabindex="-1"><div class="breadcrumbs"><a href="/beautymatch">BeautyMatch</a><span>/</span><span>${page === "customer" ? "Hồ sơ & lịch sử" : "Không gian tư vấn"}</span></div><div id="workspace"></div></main>${footer()}`;
  const area = document.getElementById("workspace");
  async function loadOverview(offset = 0) {
    if (busy) return;
    busy = true;
    start = offset;
    if (!document.getElementById("customer-search"))
      area.innerHTML = overviewMarkup();
    const list = document.getElementById("lead-list");
    if (!document.getElementById("demo-recipes"))
      list.insertAdjacentHTML(
        "beforebegin",
        '<section id="demo-recipes" class="chart-panel demo-recipes" aria-label="Kịch bản trình diễn"></section>',
      );
    list.innerHTML = skeleton();
    try {
      const data = await api.workspace(
        document.getElementById("lead-search").value,
        offset,
      );
      list.innerHTML = data.leads.length
        ? `<div class="customer-grid">${data.leads.map((lead) => `<article class="customer-card"><span class="profile-icon">${icon("users")}</span><div><h2>${escape([lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.name)}</h2><p class="muted">${escape(lead.name)}</p></div><button class="button primary" data-work="select" data-lead="${escape(lead.name)}">Hồ sơ & tư vấn ${icon("arrow")}</button></article>`).join("")}</div><div class="results-footer"><button class="button secondary" data-work="prev" ${offset === 0 ? "disabled" : ""}>Trang trước</button><span class="muted">Trang ${offset / 20 + 1}</span><button class="button secondary" data-work="next" ${data.has_more ? "" : "disabled"}>Trang tiếp</button></div>`
        : statePanel({
            title: "Chưa có khách hàng phù hợp",
            text: "Thử tìm kiếm tên khác hoặc bắt đầu tư vấn khách hàng mới.",
          });
      try {
        const presets = await api.scenarios();
        window.beautymatchPresets = presets.scenarios;
        document.getElementById("demo-recipes").innerHTML =
          `<h2>Thử hành trình với dữ liệu thật</h2><p class="muted">Chọn thông số mẫu, bổ sung khách hàng rồi xem gợi ý từ catalog. Sản phẩm bổ sung phục vụ demo có nhãn “Mẫu trình diễn”.</p><div class="button-row">${[3, 2, 1, 0].map((count) => `<button class="button secondary" data-work="sample" data-count="${count}" ${presets.scenarios[String(count)] ? "" : "disabled"}>${count === 0 ? "Không có kết quả" : count + " sản phẩm"}</button>`).join("")}</div>`;
      } catch {
        document.getElementById("demo-recipes").hidden = true;
      }
    } catch (error) {
      list.innerHTML =
        statePanel({
          title: "Không thể tải khách hàng",
          text: error.message,
          error: true,
        }) +
        '<button class="button secondary" data-work="reload">Thử lại</button>';
    } finally {
      busy = false;
    }
  }
  async function loadCustomer(offset = 0) {
    if (busy) return;
    busy = true;
    area.innerHTML = skeleton();
    const selected = customerSelection();
    if (!selected?.crm_lead) {
      area.innerHTML =
        statePanel({
          title: "Chọn khách hàng để tiếp tục",
          text: "Mở từ CRM Lead hoặc chọn một khách hàng trong không gian BeautyMatch.",
        }) +
        '<a class="button primary" href="/beautymatch">Chọn khách hàng</a>';
      busy = false;
      return;
    }
    try {
      const data = await api.customerView(selected.crm_lead, offset);
      const c = data.customer,
        s = data.summary,
        h = data.history;
      history = h.sessions;
      area.innerHTML = `<section class="dashboard-heading"><div><span class="eyebrow">HỒ SƠ KHÁCH HÀNG</span><h1>${escape(c.full_name)}</h1><p>Thông tin tư vấn được liên kết với CRM Lead ${escape(c.crm_lead)}.</p></div>${customerActions(c.crm_lead)}</section><div class="kpi-grid">${[
        ["Lượt tư vấn", s.total_sessions],
        ["Hồ sơ làn da", s.beauty_profiles.length],
        ["Lượt quan tâm", s.interested_products.length],
      ]
        .map(
          ([label, value]) =>
            `<article class="kpi"><div class="kpi-head">${label}</div><strong class="kpi-value">${number(value)}</strong></article>`,
        )
        .join(
          "",
        )}</div>${Object.keys(c.profile).length ? profileCard(c.profile, c.profile) : '<div class="inline-alert">Khách hàng chưa có hồ sơ làn da. Bắt đầu tư vấn để bổ sung.</div>'}<section class="chart-panel interest-panel"><h2>Sản phẩm khách hàng đã quan tâm</h2>${
        s.interested_products.length
          ? `<ul>${s.interested_products
              .slice(0, 10)
              .map(
                (item) =>
                  `<li>${escape(item.product_name)} <span class="muted">· ${number(item.final_match_score)}% phù hợp</span></li>`,
              )
              .join("")}</ul>`
          : '<p class="muted">Chưa có sản phẩm được đánh dấu quan tâm.</p>'
      }</section><div class="section-heading"><div><h2>Lịch sử tư vấn</h2><p>Gợi ý đã lưu, phản hồi và công việc chăm sóc của từng phiên.</p></div><button class="button secondary" data-work="reload">${icon("refresh")} Cập nhật</button></div>${
        history.length
          ? history
              .map(
                (session, index) =>
                  `<article class="session-card"><div class="section-heading"><div><span class="eyebrow">${escape(date(session.created_at))}</span><h3>${escape(categories[session.requested_category] || session.requested_category)} · ${money(session.max_budget)}</h3><p>Phiên ${escape(session.session_id)} · ${session.results.length} sản phẩm</p></div><button class="button primary" data-work="session" data-index="${index}">Mở kết quả ${icon("arrow")}</button></div>${
                    session.results.length
                      ? session.results
                          .map((item) => {
                            const follow = session.follow_ups.find(
                              (f) => f.item_id === item.item_id,
                            );
                            return `<div class="history-product"><strong>${escape(item.product_name)}</strong><span>${number(item.final_match_score)}% phù hợp · ${item.customer_feedback === "Interested" ? "Quan tâm" : item.customer_feedback === "Not Interested" ? "Không quan tâm" : "Chưa có phản hồi"}</span>${follow?.follow_up_status === "PENDING" ? '<span class="small-pill">Chờ phân công chăm sóc</span>' : ""}${follow?.task ? `<a class="text-button" href="${escape(follow.task.url)}">CRM Task ${escape(follow.task.name)} · ${escape(follow.task.status)}</a>` : ""}</div>`;
                          })
                          .join("")
                      : '<p class="muted">Phiên này chưa có sản phẩm đạt điều kiện.</p>'
                  }</article>`,
              )
              .join("")
          : statePanel({
              title: "Chưa có lịch sử tư vấn",
              text: "Tư vấn đầu tiên sẽ giúp lưu hồ sơ làn da và các gợi ý phù hợp.",
            })
      }<div class="results-footer"><button class="button secondary" data-work="prev" ${offset === 0 ? "disabled" : ""}>Mới hơn</button><span class="muted">${h.total} phiên tư vấn</span><button class="button secondary" data-work="next" ${offset + h.sessions.length < h.total ? "" : "disabled"}>Cũ hơn</button></div>`;
      start = offset;
    } catch (error) {
      area.innerHTML =
        statePanel({
          title: "Không thể mở hồ sơ khách hàng",
          text: error.message,
          error: true,
        }) +
        '<button class="button secondary" data-work="reload">Thử lại</button>';
    } finally {
      busy = false;
    }
  }
  document.addEventListener("submit", (event) => {
    if (event.target.id === "customer-search") {
      event.preventDefault();
      loadOverview(0);
    }
  });
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-work]");
    if (!button || button.disabled) return;
    const action = button.dataset.work;
    if (action === "new") {
      sessionStorage.removeItem("beautymatch_intake_retry_v1");
      sessionStorage.removeItem("beautymatch_customer_v1");
      sessionStorage.removeItem("beautymatch_sample_profile_v1");
      location.assign("/beautymatch/consultation");
    }
    if (action === "sample") {
      sessionStorage.removeItem("beautymatch_intake_retry_v1");
      const preset = window.beautymatchPresets?.[button.dataset.count];
      if (!preset) return;
      sessionStorage.removeItem("beautymatch_customer_v1");
      sessionStorage.removeItem("beautymatch_open_session_v1");
      sessionStorage.setItem(
        "beautymatch_sample_profile_v1",
        JSON.stringify(preset),
      );
      location.assign("/beautymatch/consultation");
    }
    if (action === "select") {
      selectCustomer(button.dataset.lead);
      location.assign("/beautymatch/customer");
    }
    if (action === "consult") location.assign("/beautymatch/consultation");
    if (action === "session")
      openSession(history[Number(button.dataset.index)]);
    if (["prev", "next", "reload"].includes(action)) {
      const offset =
        action === "reload"
          ? start
          : Math.max(
              0,
              start +
                (action === "next" ? 1 : -1) * (page === "overview" ? 20 : 10),
            );
      page === "overview" ? loadOverview(offset) : loadCustomer(offset);
    }
  });
  page === "overview" ? await loadOverview() : await loadCustomer();
}
