// Explicit demonstration adapter. Never used as a fallback for failed live requests.
import { ApiError } from "./api.mjs";

export function createDemoApi({ storage = globalThis.sessionStorage } = {}) {
  let catalog;
  let scenario = "three";
  let feedbackState = "CREATED";
  const saved = new Map();
  const pause = () => new Promise((resolve) => setTimeout(resolve, 380));
  const sessionId = "DEMO-SESSION";
  const getCatalog = async () => {
    if (!catalog) {
      const response = await fetch("/assets/beautymatch/demo/products.json");
      if (!response.ok) throw new ApiError("Không tải được dữ liệu minh họa.");
      catalog = await response.json();
    }
    return catalog;
  };
  function session(products) {
    const count = { empty: 0, one: 1, two: 2, three: 3 }[scenario] ?? 3;
    return {
      recommendation_session: sessionId,
      crm_lead: "DEMO-LEAD",
      beauty_profile: "DEMO-PROFILE",
      request_id: "00000000-0000-4000-8000-000000000001",
      status: "Generated",
      algorithm_version: "demo",
      requested_category: "CLEANSER",
      max_budget: 400000,
      number_of_recommendations: count,
      result_message: count
        ? "Gợi ý minh họa cho làn da của bạn."
        : "Chưa có sản phẩm phù hợp với các điều kiện đã chọn.",
      results: products.slice(0, count).map((p, i) => ({
        ...p,
        product: p.name,
        recommendation_item: `DEMO-ITEM-${i + 1}`,
        rank: i + 1,
        final_match_score: [94, 88, 82][i],
        customer_feedback:
          saved.get(`DEMO-ITEM-${i + 1}`)?.customer_feedback || "None",
        why_recommended:
          "Ví dụ minh họa cách giải thích: ưu tiên loại sản phẩm, nhu cầu chăm sóc da và mức ngân sách bạn đã chọn. Điểm số trong chế độ này là dữ liệu giả lập.",
        warning_partial_match:
          i === 2
            ? "Ví dụ khớp một phần: chưa xác nhận đủ mọi nhu cầu. Cần kiểm tra thành phần và khả năng dung nạp trước khi lựa chọn."
            : "",
      })),
    };
  }
  return {
    mode: "demo",
    setScenario(value) {
      scenario = value;
    },
    setFeedbackState(value) {
      feedbackState = value;
    },
    async generate() {
      return this.result();
    },
    async result() {
      await pause();
      if (scenario === "error")
        throw new ApiError(
          "Lỗi kết nối giả lập. Chọn trạng thái khác hoặc thử lại.",
        );
      return session(await getCatalog());
    },
    async context() {
      return {
        profile: {
          skin_type: "DRY",
          sensitivity: "Sensitive",
          concern_dehydration: 1,
          concern_barrier: 1,
          avoid_fragrance: 1,
        },
        products: await getCatalog(),
      };
    },
    async feedback(args) {
      await pause();
      if (feedbackState === "ERROR")
        throw new ApiError(
          "Lỗi gửi phản hồi giả lập. Chưa có phản hồi nào được lưu.",
        );
      const response = {
        ...args,
        customer_feedback: args.feedback,
        status:
          args.feedback === "Interested" ? feedbackState : "Feedback Received",
        follow_up_task:
          args.feedback === "Interested" && feedbackState === "CREATED"
            ? "DEMO-TASK"
            : null,
      };
      saved.set(args.recommendation_item, response);
      try {
        storage?.setItem(
          "beautymatch_demo_feedback_v1",
          JSON.stringify([...saved]),
        );
      } catch {
        /* Demo can operate without storage. */
      }
      return response;
    },
    async history() {
      await pause();
      return {
        total: 1,
        start: 0,
        limit: 20,
        sessions: [session(await getCatalog())],
      };
    },
    async dashboard(args) {
      await pause();
      if (scenario === "error") throw new ApiError("Lỗi tải báo cáo giả lập.");
      const empty = scenario === "empty";
      const products = await getCatalog();
      return {
        ...args,
        kpis: {
          total_sessions: empty ? 0 : 1284,
          leads_with_profile: empty ? 0 : 986,
          interest_rate: empty ? 0 : 68.5,
          average_top1_score: empty ? null : 89.2,
          total_recommendations: empty ? 0 : 3218,
          interested_rate: empty ? 0 : 68.5,
          follow_up_tasks: empty ? 0 : 427,
        },
        charts: {
          top_skin_concerns: empty
            ? []
            : [
                { concern: "concern_acne", count: 486 },
                { concern: "concern_dehydration", count: 372 },
                { concern: "concern_post_acne", count: 294 },
                { concern: "concern_oil_control", count: 245 },
                { concern: "concern_barrier", count: 183 },
              ],
          top_interested_products: empty
            ? []
            : products.map((p, i) => ({
                product: p.name,
                product_name: p.product_name,
                count: [186, 142, 98][i],
              })),
          sessions_by_day: [],
          feedback_distribution: [],
        },
      };
    },
  };
}
