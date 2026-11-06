export const skinTypes = {
  OILY: "Da dầu",
  DRY: "Da khô",
  COMBINATION: "Da hỗn hợp",
  NORMAL: "Da thường",
};
export const categories = {
  CLEANSER: "Sữa rửa mặt",
  TONER: "Toner",
  SERUM: "Serum",
  MOISTURIZER: "Kem dưỡng",
  SUNSCREEN: "Kem chống nắng",
};
export const concerns = {
  concern_oil_control: "Kiểm soát dầu",
  concern_acne: "Mụn",
  concern_post_acne: "Thâm sau mụn",
  concern_dehydration: "Thiếu nước",
  concern_barrier: "Hàng rào bảo vệ da",
  concern_dullness: "Da xỉn màu",
  concern_aging: "Dấu hiệu lão hóa",
};
export const avoids = {
  avoid_fragrance: "Hương liệu",
  avoid_alcohol_denat: "Cồn khô",
  avoid_essential_oil: "Tinh dầu",
};
export const rejectionReasons = [
  "Không thích thương hiệu",
  "Không phù hợp sở thích cá nhân",
  "Đã từng sử dụng",
  "Muốn tìm lựa chọn khác",
  "Khác",
];
export const money = (value) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
export const number = (value) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(
        Number(value),
      );
export const date = (value) =>
  value
    ? new Intl.DateTimeFormat("vi-VN", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "";
export function safeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, "https://beautymatch.invalid");
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? value
      : "";
  } catch {
    return "";
  }
}
export function emptyForm() {
  return {
    full_name: "",
    email: "",
    phone: "",
    skin_type: "",
    sensitivity: "",
    requested_category: "",
    max_budget: "",
    preferred_brand: "",
    consent: false,
    ...Object.fromEntries(
      [...Object.keys(concerns), ...Object.keys(avoids)].map((key) => [
        key,
        false,
      ]),
    ),
  };
}
export function validateForm(form) {
  if (!form.full_name.trim() || !(form.email.trim() || form.phone.trim()))
    return "Nhập tên khách hàng và ít nhất email hoặc số điện thoại.";
  if (
    !skinTypes[form.skin_type] ||
    !["Sensitive", "Not specifically sensitive"].includes(form.sensitivity)
  )
    return "Chọn loại da và độ nhạy cảm.";
  const count = Object.keys(concerns).filter((key) => form[key]).length;
  if (count < 1 || count > 3) return "Chọn từ 1 đến 3 vấn đề da.";
  if (
    !categories[form.requested_category] ||
    !Number.isFinite(Number(form.max_budget)) ||
    Number(form.max_budget) <= 0
  )
    return "Chọn danh mục và ngân sách lớn hơn 0.";
  if (!form.consent) return "Cần xác nhận đồng ý lưu thông tin tư vấn.";
  return "";
}
export function fieldErrors(form) {
  const errors = {};
  if (!String(form.full_name || "").trim())
    errors.full_name = "Nhập họ và tên của bạn.";
  if (!String(form.email || "").trim() && !String(form.phone || "").trim())
    errors.email = "Cần email hoặc số điện thoại để liên hệ.";
  if (
    form.phone &&
    !/^\+?[0-9]{8,15}$/.test(String(form.phone).replace(/[\s().-]/g, ""))
  )
    errors.phone = "Kiểm tra số điện thoại (8–15 chữ số).";
  if (!skinTypes[form.skin_type])
    errors.skin_type = "Chọn mô tả loại da gần nhất.";
  if (!["Sensitive", "Not specifically sensitive"].includes(form.sensitivity))
    errors.sensitivity = "Chọn độ nhạy cảm của da.";
  const count = Object.keys(concerns).filter((key) => form[key]).length;
  if (count < 1 || count > 3)
    errors.concern_oil_control = "Chọn từ 1 đến 3 vấn đề bạn muốn ưu tiên.";
  if (!categories[form.requested_category])
    errors.requested_category = "Chọn danh mục sản phẩm.";
  if (!Number.isFinite(Number(form.max_budget)) || Number(form.max_budget) <= 0)
    errors.max_budget = "Nhập ngân sách lớn hơn 0.";
  if (![true, 1, "1"].includes(form.consent))
    errors.consent = "Bạn cần xác nhận đồng ý trước khi gửi.";
  return errors;
}
export function normalizeIntake(form) {
  const result = Object.fromEntries(
    [
      "full_name",
      "email",
      "phone",
      "skin_type",
      "sensitivity",
      "requested_category",
      "preferred_brand",
    ].map((key) => [key, String(form[key] || "").trim()]),
  );
  result.email = result.email.toLowerCase();
  result.max_budget = Number(form.max_budget);
  for (const key of [
    ...Object.keys(concerns),
    ...Object.keys(avoids),
    "consent",
  ])
    result[key] = [true, 1, "1"].includes(form[key]) ? 1 : 0;
  return result;
}
export function taskFromUrl(value) {
  const match = /^\/app\/crm-task\/([^/?#]+)$/.exec(value || "");
  return match ? decodeURIComponent(match[1]) : null;
}
