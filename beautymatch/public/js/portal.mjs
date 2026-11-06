import {
  skinTypes,
  concerns,
  avoids,
  categories,
  emptyForm,
  validateForm,
  normalizeIntake,
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
  async function load() {
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
      for (const [key, value] of Object.entries(values)) {
        const field = form.elements[key];
        if (!field) continue;
        if (field.type === "checkbox")
          field.checked = [true, 1, "1"].includes(value);
        else field.value = value ?? "";
      }
      form.elements.email.value = account.email;
      count();
      form.hidden = false;
      $("portal-requests").hidden = false;
      const list = $("portal-requests").querySelector("ul");
      list.replaceChildren();
      for (const request of account.requests) {
        const item = document.createElement("li");
        item.textContent = `${statuses[request.status]} · ${new Date(request.submitted_at.replace(" ", "T")).toLocaleString("vi-VN")}`;
        list.append(item);
      }
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
    const validation = validateForm(values);
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
    if (await load()) state("Đã cập nhật trạng thái yêu cầu.");
  });
  if (await load())
    state("Chọn nhu cầu hiện tại và xác nhận đồng ý trước khi gửi.");
}
