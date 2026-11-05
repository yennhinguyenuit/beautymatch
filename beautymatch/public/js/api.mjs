export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export const METHODS = Object.freeze({
  generate_recommendations:
    "beautymatch.api.recommendation.generate_recommendations",
  get_recommendation_result:
    "beautymatch.api.recommendation.get_recommendation_result",
  get_customer_history:
    "beautymatch.api.recommendation.get_consultation_history",
  submit_feedback: "beautymatch.api.feedback.submit_feedback",
  get_dashboard_data: "beautymatch.api.frontend.get_dashboard_data",
  get_result_context: "beautymatch.api.frontend.get_result_context",
});

function serverError(body, status) {
  if (status === 401 || status === 403)
    return "Vui lòng đăng nhập bằng tài khoản CRM có quyền tư vấn.";
  // Do not show raw exceptions, tracebacks, or server-provided HTML.
  if (status === 404)
    return "API chưa được cài trên site này. Vui lòng kiểm tra phiên bản BeautyMatch.";
  if (status === 429)
    return "Có quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.";
  try {
    const entry = JSON.parse(body._server_messages)[0];
    const message = JSON.parse(entry).message;
    if (typeof message === "string")
      return message.replace(/<[^>]*>/g, "").slice(0, 400);
  } catch {
    /* Fall through to a safe message. */
  }
  return "Không thể hoàn tất yêu cầu. Vui lòng thử lại; phản hồi chưa được xác nhận.";
}

export function createLiveApi({
  fetcher = globalThis.fetch,
  csrf = "",
  timeout = 25000,
} = {}) {
  const pending = new Map();
  function call(key, args = {}, verb = "GET") {
    const identity = JSON.stringify([key, args]);
    if (pending.has(identity)) return pending.get(identity);
    const work = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const headers = {
          "Content-Type": "application/json",
          "X-Frappe-CSRF-Token": csrf,
        };
        // Existing GET contracts are bridged server-side so identifiers never enter URLs.
        const sensitive =
          key === "get_customer_history" ||
          key === "get_recommendation_result" ||
          key === "get_result_context";
        const url = `/api/method/${METHODS[key]}`;
        const options = {
          method: verb,
          credentials: "same-origin",
          headers,
          signal: controller.signal,
          cache: "no-store",
        };
        let target = url;
        if (verb === "POST") options.body = JSON.stringify(args);
        else if (sensitive) {
          // The bridge accepts POST and invokes the existing GET-only function server-side.
          target = "/api/method/beautymatch.api.frontend.read";
          options.method = "POST";
          options.body = JSON.stringify({ operation: key, parameters: args });
        } else target += `?${new URLSearchParams(args)}`;
        const response = await fetcher(target, options);
        let body;
        try {
          body = await response.json();
        } catch {
          throw new ApiError(
            "Máy chủ không trả JSON hợp lệ. Vui lòng kiểm tra đăng nhập.",
            response.status,
          );
        }
        if (!response.ok || body.exc || body.exc_type)
          throw new ApiError(
            serverError(body, response.status),
            response.status,
          );
        if (!body.message || typeof body.message !== "object")
          throw new ApiError("Phản hồi API thiếu dữ liệu hợp lệ.");
        return body.message;
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw new ApiError(
          error.name === "AbortError"
            ? "Kết nối quá thời gian. Bạn có thể thử lại cùng yêu cầu."
            : "Không thể kết nối máy chủ. Vui lòng kiểm tra mạng và thử lại.",
        );
      } finally {
        clearTimeout(timer);
      }
    })();
    pending.set(identity, work);
    work.then(
      () => pending.delete(identity),
      () => pending.delete(identity),
    );
    return work;
  }
  return {
    mode: "live",
    generate: (args) => call("generate_recommendations", args, "POST"),
    result: (session) =>
      call("get_recommendation_result", { recommendation_session: session }),
    context: (session) =>
      call("get_result_context", { recommendation_session: session }),
    history: (lead, start = 0) =>
      call("get_customer_history", { crm_lead: lead, start, limit: 20 }),
    feedback: (args) => call("submit_feedback", args, "POST"),
    dashboard: (args) => call("get_dashboard_data", args),
  };
}

export function readConsultation(storage) {
  let value;
  try {
    value = JSON.parse(storage.getItem("beautymatch_pending_v1") || "null");
  } catch {
    throw new ApiError(
      "Không thể đọc phiên tư vấn. Vui lòng trở lại trang tư vấn.",
    );
  }
  if (!value) return null;
  if (
    !["crm_lead", "beauty_profile", "request_id", "profile_version"].every(
      (key) => typeof value[key] === "string" && value[key].trim(),
    )
  ) {
    throw new ApiError(
      "Phiên tư vấn thiếu thông tin. Vui lòng trở lại trang tư vấn.",
    );
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value.request_id,
    )
  )
    throw new ApiError("Mã yêu cầu tư vấn không hợp lệ.");
  return Object.fromEntries(
    ["crm_lead", "beauty_profile", "request_id", "profile_version"].map(
      (key) => [key, value[key]],
    ),
  );
}

export function feedbackMessage(data) {
  if (!["Interested", "Not Interested"].includes(data.customer_feedback))
    throw new ApiError("Máy chủ chưa xác nhận phản hồi.");
  if (data.customer_feedback === "Not Interested")
    return {
      kind: "success",
      title: "Đã ghi nhận phản hồi",
      text: "Cảm ơn bạn đã chia sẻ. Bạn có thể tiếp tục khám phá những gợi ý còn lại.",
    };
  if (data.status === "PENDING")
    return {
      kind: "pending",
      title: "PENDING · Đang chờ xử lý",
      text: "Đã ghi nhận sự quan tâm. Yêu cầu theo dõi đang chờ xử lý.",
    };
  if (data.status === "CREATED" || data.follow_up_task)
    return {
      kind: "success",
      title: `${data.status} · Đã tạo lịch theo dõi`,
      text: "Đã ghi nhận sự quan tâm. Nhân viên CRM sẽ tiếp tục hỗ trợ bạn.",
    };
  return {
    kind: "pending",
    title: `${data.status || "Đã ghi nhận"}`,
    text: "Đã ghi nhận sự quan tâm. Máy chủ chưa xác nhận lịch theo dõi.",
  };
}
