export function createPortalClient({
  fetcher = globalThis.fetch,
  csrf = () => "",
  timeout = 12000,
} = {}) {
  return async (method, args = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetcher(`/api/method/${method}`, {
        method: "POST",
        credentials: "same-origin",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": csrf(),
        },
        body: JSON.stringify(args),
      });
      let body;
      try {
        body = await response.json();
      } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error(
          "Máy chủ trả dữ liệu không hợp lệ. Vui lòng thử tải lại.",
        );
      }
      if (!body || typeof body !== "object")
        throw new Error("Máy chủ chưa trả đủ dữ liệu. Vui lòng thử lại.");
      if (!response.ok || body.exc_type) {
        if ([401, 403].includes(response.status))
          throw new Error(
            "Vui lòng đăng nhập tài khoản khách hàng có quyền sử dụng BeautyMatch.",
          );
        let message =
          "Chưa hoàn tất yêu cầu. Vui lòng kiểm tra kết nối và thử lại.";
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
    } catch (error) {
      if (controller.signal.aborted)
        throw new Error(
          "Máy chủ phản hồi quá lâu. Vui lòng thử lại; nội dung đã nhập được giữ nguyên.",
        );
      if (error instanceof TypeError)
        throw new Error(
          "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại cùng yêu cầu.",
        );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  };
}

export function validatePortalProfile(value) {
  const statuses = ["Pending", "In Progress", "Completed", "Superseded"];
  if (
    !value ||
    typeof value.full_name !== "string" ||
    typeof value.email !== "string" ||
    !value.profile ||
    typeof value.profile !== "object" ||
    Array.isArray(value.profile) ||
    !Array.isArray(value.requests) ||
    !value.requests.every(
      (row) =>
        row &&
        typeof row.request_id === "string" &&
        row.request_id &&
        statuses.includes(row.status) &&
        Number.isFinite(Date.parse(row.submitted_at)),
    )
  )
    throw new Error(
      "Phản hồi hồ sơ chưa đầy đủ. Vui lòng thử tải lại hoặc liên hệ chuyên viên.",
    );
  return value;
}
