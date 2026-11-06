import { currentAccount } from "../../beautymatch/public/js/account-context.mjs";
export async function careCall(action, args = {}) {
  const account = currentAccount();
  const allowed = new Set([
    "list_contacts",
    "get_contact",
    "record_call",
    "update_task",
    "care_metrics",
    "request_staff_contact",
  ]);
  if (!allowed.has(action)) throw new Error("Thao tác không được hỗ trợ.");
  const response = await fetch(
    `/api/method/beautymatch.api.customer_care.${action}`,
    {
      method: "POST",
      credentials: "same-origin",
      signal: AbortSignal.timeout(25000),
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": window.csrf_token || "",
      },
      body: JSON.stringify(args),
    },
  ).catch(() => {
    throw new Error("Không thể kết nối. Vui lòng thử lại cùng yêu cầu.");
  });
  const body = await response.json();
  if (!account || account !== currentAccount())
    throw new Error("Tài khoản đã thay đổi. Vui lòng mở lại BeautyMatch.");
  if (!response.ok || body.exc_type) {
    let message =
      "Chưa hoàn tất thao tác. Kiểm tra dữ liệu, quyền truy cập và thử lại.";
    try {
      message = JSON.parse(
        JSON.parse(body._server_messages)[0],
      ).message.replace(/<[^>]*>/g, "");
    } catch {}
    throw new Error(message);
  }
  return body.message;
}
