export async function portalCall(operation, args = {}) {
  const allowed = ["list_requests", "accept_request", "complete_request"];
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
    },
  );
  const body = await response.json();
  if (!response.ok || body.exc_type)
    throw new Error(
      "Chưa cập nhật được yêu cầu tư vấn. Kiểm tra quyền và thử lại.",
    );
  return body.message;
}
