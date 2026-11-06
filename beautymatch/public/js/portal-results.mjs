import { escape, money, number, safeUrl, photoMarkup } from "./components.mjs";
import { enhanceProductPhotos } from "./product-photos.mjs";

const labels = {
  "Pending Assignment": "Chờ phân công",
  Open: "Đã nhận yêu cầu",
  "In Progress": "Đang chăm sóc",
  Completed: "Đã hoàn thành",
  Canceled: "Đã hủy công việc",
  "Do Not Contact": "Đã dừng liên hệ",
};
const reasons = [
  "Không thích thương hiệu",
  "Không phù hợp sở thích cá nhân",
  "Đã từng sử dụng",
  "Muốn tìm lựa chọn khác",
  "Khác",
];
export function createPortalResults({ call, email }) {
  const root = document.getElementById("portal-discovery");
  const account = email;
  let result,
    busy = false;
  const key = () =>
    `beautymatch_contact_retry:${account()}:${result.session_id}`;
  const rpc = (action, args) =>
    call(`beautymatch.api.self_service.${action}`, args);
  function error(message) {
    root.querySelector("[data-result-status]").textContent = message;
  }
  function render(value, focus = false) {
    result = value;
    root.dataset.sessionId = value.session_id;
    sessionStorage.setItem(
      `beautymatch_portal_result:${account()}`,
      result.session_id,
    );
    root.hidden = false;
    root.innerHTML = `<header class="portal-discovery-header"><p class="portal-eyebrow">ĐƯỢC CHỌN CHO RIÊNG BẠN</p><h2 tabindex="-1">Sản phẩm dành cho bạn</h2><p>Gợi ý dựa trên hồ sơ đã lưu · Phiên ${escape(result.session_id)}</p><p>Bạn tự chọn điều phù hợp. Chỉ khi bạn đồng ý được liên hệ, chuyên viên mới nhận yêu cầu chăm sóc.</p></header><p data-result-status role="status" aria-live="polite"></p><div class="portal-product-grid">${result.results.map((item) => `<article class="portal-product" data-portal-item="${escape(item.item_id)}"><div class="portal-product-photo"><span class="portal-rank">Top ${Number(item.rank)}</span>${photoMarkup(safeUrl(item.image_url), item.product_name)}</div><div class="portal-product-copy"><p>${escape(item.brand)}</p><h3>${escape(item.product_name)}</h3><strong>${money(item.price)}</strong><label class="portal-score">${number(item.final_match_score)}% phù hợp<progress value="${Math.max(0, Math.min(100, Number(item.final_match_score) || 0))}" max="100"></progress></label><p>${escape(item.why_recommended)}</p>${item.key_ingredients ? `<p class="portal-hint">Thành phần: ${escape(item.key_ingredients)}</p>` : ""}${item.warning_partial_match ? `<p class="portal-warning">${escape(item.warning_partial_match)}</p>` : ""}${safeUrl(item.product_url) ? `<a href="${escape(safeUrl(item.product_url))}" target="_blank" rel="noopener noreferrer">Xem chi tiết sản phẩm ↗</a>` : "<p class=portal-hint>Catalog chưa có liên kết chi tiết.</p>"}<p class="portal-feedback-saved">${item.customer_feedback === "Interested" ? "Đã quan tâm" : item.customer_feedback === "Not Interested" ? "Đã ghi nhận không quan tâm" : "Bạn thấy sản phẩm này thế nào?"}</p><div class="portal-product-actions"><button type="button" data-interest="${escape(item.item_id)}" aria-pressed="${item.customer_feedback === "Interested"}">♡ Quan tâm</button><button type="button" data-reject="${escape(item.item_id)}">Không quan tâm</button></div><form data-reject-form="${escape(item.item_id)}" hidden><label>Lý do (không bắt buộc)<select name="reason"><option value="">Không nêu lý do</option>${reasons.map((x) => `<option>${escape(x)}</option>`).join("")}</select></label><button type="submit">Lưu phản hồi</button><button type="button" data-cancel-reject>Đóng</button></form></div></article>`).join("")}</div>${!result.results.length ? `<div class="portal-empty"><h3>Chưa có sản phẩm phù hợp</h3><p>${escape(result.result_message)}</p><p>Hồ sơ và phiên tư vấn đã được lưu. Bạn có thể điều chỉnh nhu cầu rồi thử một phiên mới.</p></div>` : ""}<section class="portal-contact"><h3>Bạn có muốn chuyên viên BeautyMatch liên hệ để tư vấn thêm không?</h3><p>Chọn Quan tâm ở một sản phẩm trước. Không yêu cầu liên hệ vẫn giữ nguyên hồ sơ và phản hồi của bạn.</p><div class="portal-product-actions"><button type="button" data-contact-yes ${result.results.some((i) => i.customer_feedback === "Interested") ? "" : "disabled"}>Có, tôi muốn được tư vấn thêm</button><button type="button" data-contact-no>Không, cảm ơn</button></div><form id="portal-contact-form" hidden><fieldset><legend>Sản phẩm muốn trao đổi</legend>${result.results
      .filter((i) => i.customer_feedback === "Interested")
      .map(
        (i) =>
          `<label class="portal-consent"><input type="checkbox" name="items" value="${escape(i.item_id)}" checked>${escape(i.product_name)}</label>`,
      )
      .join(
        "",
      )}</fieldset><div class="portal-fields"><label>Phương thức liên hệ<select name="channel">${Object.entries(
      result.contact_options,
    )
      .filter(([, v]) => v)
      .map(
        ([k]) =>
          `<option value="${k}">${k === "Phone" ? "Điện thoại" : "Email"}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Liên hệ đã xác nhận<input name="contact_value" readonly required></label><label>Khung thời gian mong muốn (tùy chọn)<input name="preferred_time" maxlength="140"></label></div><label>Lời nhắn (tùy chọn)<textarea name="customer_note" maxlength="1000"></textarea></label><label class="portal-consent"><input name="contact_consent" type="checkbox" required>Tôi đồng ý để chuyên viên liên hệ theo thông tin trên.</label><button class="portal-primary" type="submit">Gửi yêu cầu tư vấn thêm</button></form><div class="portal-contact-history">${(result.contact_requests || []).map((r) => `<p><strong>${labels[r.status] || escape(r.status)}</strong> · Mã ${escape(r.request_id.slice(0, 8))} · ${r.channel === "Phone" ? "Điện thoại" : "Email"}<br>${escape(r.contact_value)}</p>`).join("")}</div></section>`;
    enhanceProductPhotos(root);
    if (focus) {
      root.scrollIntoView({
        behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      root.querySelector("h2").focus({ preventScroll: true });
    }
  }
  async function refresh() {
    render(await rpc("get_result", { session_id: result.session_id }));
  }
  async function feedback(itemId, value, reason) {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    try {
      await rpc("submit_feedback", {
        session_id: result.session_id,
        item_id: itemId,
        customer_feedback: value,
        rejection_reason: reason || null,
      });
      await refresh();
      error("Phản hồi đã lưu. Chưa tạo yêu cầu liên hệ.");
    } catch (e) {
      error(e.message);
    } finally {
      busy = false;
      root.removeAttribute("aria-busy");
    }
  }
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b || busy) return;
    if (b.dataset.interest) feedback(b.dataset.interest, "Interested");
    if (b.dataset.reject)
      root.querySelector(
        `[data-reject-form="${CSS.escape(b.dataset.reject)}"]`,
      ).hidden = false;
    if (b.hasAttribute("data-cancel-reject")) b.closest("form").hidden = true;
    if (b.hasAttribute("data-contact-no")) {
      root.querySelector("#portal-contact-form").hidden = true;
      error(
        "Đã giữ phản hồi. Bạn chưa yêu cầu liên hệ; không tạo công việc mới.",
      );
    }
    if (b.hasAttribute("data-contact-yes")) {
      const form = root.querySelector("#portal-contact-form");
      form.hidden = false;
      form.elements.contact_consent.checked = false;
      const update = () => {
        form.elements.contact_value.value =
          result.contact_options[form.elements.channel.value] || "";
      };
      form.elements.channel.onchange = update;
      update();
      form.elements.channel.focus();
    }
  });
  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const form = e.target;
    if (form.dataset.rejectForm) {
      feedback(
        form.dataset.rejectForm,
        "Not Interested",
        form.elements.reason.value,
      );
      return;
    }
    if (form.id !== "portal-contact-form") return;
    const data = {
      item_ids: [...form.querySelectorAll('[name="items"]:checked')].map(
        (i) => i.value,
      ),
      channel: form.elements.channel.value,
      contact_value: form.elements.contact_value.value,
      preferred_time: form.elements.preferred_time.value,
      customer_note: form.elements.customer_note.value,
      contact_consent: form.elements.contact_consent.checked ? 1 : 0,
    };
    const signature = JSON.stringify(data);
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(key()) || "null");
    } catch {}
    const payload = {
      ...data,
      request_id:
        saved?.signature === signature
          ? saved.payload.request_id
          : crypto.randomUUID(),
    };
    sessionStorage.setItem(key(), JSON.stringify({ signature, payload }));
    busy = true;
    form.querySelector('[type="submit"]').disabled = true;
    try {
      const ack = await call("beautymatch.api.customer_care.request_contact", {
        session_id: result.session_id,
        payload,
      });
      sessionStorage.removeItem(key());
      await refresh();
      error(
        `Đã nhận yêu cầu ${ack.request_id.slice(0, 8)}. ${ack.follow_up_status === "CREATED" ? "Chuyên viên đã được giao công việc chăm sóc." : "Đang chờ phân công; yêu cầu đã được lưu."}`,
      );
    } catch (e) {
      error(e.message);
      form.querySelector('[type="submit"]').disabled = false;
    } finally {
      busy = false;
    }
  });
  return {
    show: render,
    restore: async () => {
      const history = await rpc("history", {});
      const stored = sessionStorage.getItem(
        `beautymatch_portal_result:${account()}`,
      );
      const id =
        history.sessions.find((s) => s.name === stored)?.name ||
        history.sessions[0]?.name;
      const list = document.getElementById("portal-session-history");
      list.replaceChildren();
      for (const row of history.sessions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `${row.name} · ${row.number_of_recommendations} sản phẩm`;
        button.onclick = async () => {
          try {
            render(await rpc("get_result", { session_id: row.name }), true);
          } catch (e) {
            error(e.message);
          }
        };
        list.append(button);
      }
      if (id) render(await rpc("get_result", { session_id: id }));
    },
  };
}
