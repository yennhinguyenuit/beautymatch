import {
  skinTypes,
  concerns,
  avoids,
  categories,
  emptyForm,
  validateForm,
  normalizeIntake,
  fieldErrors,
  money,
} from "./intake-domain.mjs";
const $ = (id) => document.getElementById(id);
const csrf = document.querySelector('meta[name="csrf-token"]').content;
const statuses = {
  Pending: "Chờ tiếp nhận",
  "In Progress": "Đang tư vấn",
  Completed: "Đã tư vấn",
  Superseded: "Đã có yêu cầu mới hơn",
};
async function call(method, args = {}) {
  let response, body;
  try {
    response = await fetch(`/api/method/${method}`, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": csrf,
      },
      body: JSON.stringify(args),
    });
    body = await response.json();
  } catch {
    throw new Error(
      "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại cùng yêu cầu.",
    );
  }
  if (!response.ok || body.exc_type) {
    if ([401, 403].includes(response.status))
      throw new Error(
        "Vui lòng đăng nhập tài khoản khách hàng có quyền sử dụng BeautyMatch.",
      );
    let message =
      "Chưa gửi được yêu cầu. Vui lòng kiểm tra kết nối và thử lại.";
    try {
      message = JSON.parse(JSON.parse(body._server_messages)[0])
        .message.replace(/<[^>]*>/g, "")
        .slice(0, 400);
    } catch {
      /* Safe fallback. */
    }
    throw new Error(message);
  }
  return body.message;
}
$("portal-login")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    await call("login", {
      usr: form.elements.usr.value.trim(),
      pwd: form.elements.pwd.value,
    });
    location.assign("/beautymatch/portal");
  } catch {
    $("login-status").textContent =
      "Đăng nhập chưa thành công. Vui lòng kiểm tra email và mật khẩu.";
    button.disabled = false;
  }
});
$("portal-logout")?.addEventListener("click", async () => {
  await call("logout");
  for (const key of Object.keys(sessionStorage))
    if (key.startsWith("beautymatch_")) sessionStorage.removeItem(key);
  location.assign("/beautymatch/portal");
});
const form = $("portal-form");
if (form) {
  let account,
    pending = false;
  const state = (message, error = false) => {
    $("portal-status").textContent = message;
    $("portal-status").dataset.error = error ? "1" : "0";
  };
  for (const [field, options] of [
    ["skin_type", skinTypes],
    ["requested_category", categories],
  ])
    for (const [value, label] of Object.entries(options))
      form.elements[field].add(new Option(label, value));
  for (const [id, options] of [
    ["portal-concerns", concerns],
    ["portal-avoids", avoids],
  ])
    for (const [name, label] of Object.entries(options)) {
      const node = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = name;
      node.append(input, document.createTextNode(label));
      $(id).append(node);
    }
  function count() {
    const selected = Object.keys(concerns).filter(
      (key) => form.elements[key].checked,
    ).length;
    $("portal-concern-count").textContent =
      `Mối quan tâm · ${selected}/3 vấn đề`;
    for (const key of Object.keys(concerns))
      form.elements[key].disabled =
        selected >= 3 && !form.elements[key].checked;
  }
  form.addEventListener("change", count);
  const retryKey = () => `beautymatch_portal_retry_v1:${account.email}`;
  const nextStep = {
    Pending:
      "Hồ sơ đã được nhận. Chờ nhân viên tiếp nhận; bạn có thể cập nhật trạng thái tại đây.",
    "In Progress": "Nhân viên đang tư vấn từ hồ sơ bạn đã gửi.",
    Completed:
      "Đã xử lý yêu cầu. Kết quả và lịch sử được lưu để chuyên viên tiếp tục chăm sóc bạn.",
    Superseded:
      "Đã có yêu cầu mới hơn. Yêu cầu này vẫn được lưu trong lịch sử.",
  };
  function confirmation(request) {
    const panel = $("portal-confirmation");
    panel.hidden = !request;
    if (!request) return;
    panel.querySelector("h3").textContent =
      request.status === "Pending"
        ? "Đã nhận hồ sơ · Chờ nhân viên tiếp nhận"
        : statuses[request.status];
    panel.querySelector("p").textContent = nextStep[request.status];
    panel.querySelector("small").textContent =
      `Mã ${request.request_id.slice(0, 8)} · ${new Date(request.submitted_at).toLocaleString("vi-VN")}`;
  }
  function budgetHint() {
    $("portal-budget-value").textContent =
      Number(form.elements.max_budget.value) > 0
        ? money(form.elements.max_budget.value)
        : "Ngân sách cho một sản phẩm · Ví dụ: 325000 = 325.000 ₫";
  }
  form.elements.max_budget.addEventListener("input", budgetHint);
  form.elements.max_budget.closest("label").append($("portal-budget-value"));
  function validate(values) {
    for (const node of form.querySelectorAll("[data-field-error]"))
      node.remove();
    for (const field of form.querySelectorAll("[aria-invalid]")) {
      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
    }
    const errors = fieldErrors(values);
    for (const [key, message] of Object.entries(errors)) {
      const field = form.elements[key];
      const text = document.createElement("span");
      text.id = `portal-error-${key}`;
      text.dataset.fieldError = key;
      text.className = "portal-field-error";
      text.textContent = message;
      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", text.id);
      if (key === "consent") field.closest("label").after(text);
      else field.closest("label").append(text);
    }
    if (Object.keys(errors).length)
      form.elements[Object.keys(errors)[0]].focus();
    return Object.values(errors)[0] || "";
  }
  async function load(hydrate = true) {
    if (typeof hydrate !== "boolean") hydrate = true;
    $("portal-retry").hidden = true;
    try {
      account = await call("beautymatch.api.portal.get_my_profile");
      let retry;
      try {
        retry = JSON.parse(sessionStorage.getItem(retryKey()) || "null");
      } catch {
        /* Ignore damaged session data. */
      }
      const values = {
        ...emptyForm(),
        ...account.profile,
        full_name: account.full_name,
        email: account.email,
        phone: account.phone,
        ...(retry?.payload || {}),
        consent: false,
      };
      for (const [key, value] of Object.entries(hydrate ? values : {})) {
        const field = form.elements[key];
        if (!field) continue;
        if (field.type === "checkbox")
          field.checked = [true, 1, "1"].includes(value);
        else field.value = value ?? "";
      }
      form.elements.email.value = account.email;
      count();
      budgetHint();
      form.hidden = false;
      $("portal-requests").hidden = false;
      const list = $("portal-requests").querySelector("ul");
      list.replaceChildren();
      for (const request of account.requests) {
        const item = document.createElement("li");
        const title = document.createElement("strong"),
          detail = document.createElement("p"),
          step = document.createElement("p");
        title.textContent = statuses[request.status];
        detail.textContent = `Mã ${request.request_id.slice(0, 8)} · ${new Date(request.submitted_at).toLocaleString("vi-VN")}`;
        step.textContent = nextStep[request.status];
        item.append(title, detail, step);
        list.append(item);
      }
      confirmation(account.requests[0]);
      if (!account.requests.length) {
        const item = document.createElement("li");
        item.textContent = "Bạn chưa gửi yêu cầu tư vấn.";
        list.append(item);
      }
      return true;
    } catch (error) {
      state(error.message, true);
      $("portal-retry").hidden = false;
      return false;
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (pending) return;
    const values = Object.fromEntries(new FormData(form));
    for (const key of [
      ...Object.keys(concerns),
      ...Object.keys(avoids),
      "consent",
    ])
      values[key] = form.elements[key].checked;
    const validation = validate(values) || validateForm(values);
    if (validation) {
      state(validation, true);
      return;
    }
    const normalized = normalizeIntake(values);
    const signature = JSON.stringify(normalized);
    let previous;
    try {
      previous = JSON.parse(sessionStorage.getItem(retryKey()) || "null");
    } catch {
      /* New UUID below. */
    }
    const payload = {
      ...normalized,
      request_id:
        previous?.signature === signature
          ? previous.payload.request_id
          : crypto.randomUUID(),
    };
    sessionStorage.setItem(retryKey(), JSON.stringify({ signature, payload }));
    pending = true;
    form.querySelector("button[type=submit]").disabled = true;
    form.setAttribute("aria-busy", "true");
    state("Đang gửi yêu cầu…");
    try {
      const reply = await call("beautymatch.api.portal.submit_profile", {
        payload,
      });
      if (!reply.request_id || !statuses[reply.status])
        throw new Error("Máy chủ chưa xác nhận yêu cầu. Vui lòng thử lại.");
      sessionStorage.removeItem(retryKey());
      confirmation(reply);
      await load();
      state(
        `Đã gửi yêu cầu thành công. ${statuses[reply.status]}. Chuyên viên sẽ tiếp nhận hồ sơ của bạn.`,
      );
    } catch (error) {
      state(error.message, true);
    } finally {
      pending = false;
      form.querySelector("button[type=submit]").disabled = false;
      form.setAttribute("aria-busy", "false");
    }
  });
  $("portal-retry").addEventListener("click", load);
  $("portal-refresh").addEventListener("click", async () => {
    if (pending) return;
    const button = $("portal-refresh");
    button.disabled = true;
    try {
      if (await load(false)) state("Đã cập nhật trạng thái yêu cầu.");
    } finally {
      button.disabled = false;
    }
  });
  if (await load())
    state("Chọn nhu cầu hiện tại và xác nhận đồng ý trước khi gửi.");
}
