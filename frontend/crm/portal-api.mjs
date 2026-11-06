import { currentAccount } from "../../beautymatch/public/js/account-context.mjs";
export async function portalCall(operation, args = {}) {
  const allowed = [
    "list_requests",
    "accept_request",
    "complete_request",
    "get_request",
    "generate_for_request",
  ];
  if (!allowed.includes(operation))
    throw new Error("Thao tác không được hỗ trợ.");
  const response = await fetch(
    `/api/method/beautymatch.api.portal.${operation}`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-Frappe-CSRF-Token": window.csrf_token || "",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(25000),
    },
  ).catch(() => {
    throw new Error(
      "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại cùng yêu cầu.",
    );
  });
  const body = await response.json();
  if (!response.ok || body.exc_type) {
    let message =
      "Chưa cập nhật được yêu cầu tư vấn. Kiểm tra quyền và thử lại.";
    try {
      message = JSON.parse(JSON.parse(body._server_messages)[0])
        .message.replace(/<[^>]*>/g, "")
        .slice(0, 400);
    } catch {
      /* Safe fallback. */
    }
    if (response.status === 401 || !currentAccount())
      document.dispatchEvent(new Event("beautymatch:session-ended"));
    throw new Error(message);
  }
  return body.message;
}
