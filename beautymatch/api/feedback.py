"""Staff-only feedback API for stored BeautyMatch recommendation items."""

import frappe
from frappe.utils import add_to_date, now_datetime

from beautymatch.api.profile import (
    _acquire_lock,
    _check_consultation_role,
    _check_lead_access,
)

FEEDBACK_CHOICES = {"Interested", "Not Interested"}
REJECTION_REASONS = {
    "Không thích thương hiệu",
    "Không phù hợp sở thích cá nhân",
    "Đã từng sử dụng",
    "Muốn tìm lựa chọn khác",
    "Khác",
}


def _invalid(message):
    frappe.throw(message, exc=frappe.ValidationError)


def _feedback_response(session, item):
    return {
        "recommendation_session": session.name,
        "recommendation_item": item.name,
        "crm_lead": session.crm_lead,
        "product": item.product,
        "customer_feedback": item.customer_feedback,
        "rejection_reason": item.rejection_reason or None,
        "feedback_date": str(item.feedback_date) if item.feedback_date else None,
        "follow_up_task": item.follow_up_task or None,
        "status": session.status,
    }


@frappe.whitelist(methods=["POST"])
def submit_feedback(recommendation_session, recommendation_item, feedback, rejection_reason=None):
    """Save feedback and create at most one CRM Task for each interested item.

    The parent session is locked for the whole request to serialize concurrent
    feedback updates. Tasks are never deleted automatically on feedback changes.
    """
    _check_consultation_role()
    for key, value in (
        ("recommendation_session", recommendation_session),
        ("recommendation_item", recommendation_item),
        ("feedback", feedback),
    ):
        if not isinstance(value, str) or not value.strip():
            _invalid(f"Thiếu hoặc không hợp lệ: {key}.")

    recommendation_session = recommendation_session.strip()
    recommendation_item = recommendation_item.strip()
    feedback = feedback.strip()
    if feedback not in FEEDBACK_CHOICES:
        _invalid("feedback phải là Interested hoặc Not Interested.")
    if rejection_reason is not None and not isinstance(rejection_reason, str):
        _invalid("rejection_reason phải là chuỗi.")
    rejection_reason = (rejection_reason or "").strip()
    if feedback == "Interested" and rejection_reason:
        _invalid("Interested không được có rejection_reason.")
    if feedback == "Not Interested" and rejection_reason and rejection_reason not in REJECTION_REASONS:
        _invalid("rejection_reason không hợp lệ.")

    # Do not reveal item or session details before checking the linked Lead.
    session = frappe.get_doc("Recommendation Session", recommendation_session)
    _check_lead_access(session.crm_lead)
    _acquire_lock("feedback-session", recommendation_session)
    # Re-read after acquiring lock so concurrent updates are not overwritten.
    session = frappe.get_doc("Recommendation Session", recommendation_session)
    _check_lead_access(session.crm_lead)
    item = next((row for row in session.recommendation_items if row.name == recommendation_item), None)
    if item is None:
        _invalid("Recommendation Item không thuộc phiên tư vấn này.")

    same_feedback = (item.customer_feedback == feedback and
                     (item.rejection_reason or "") == rejection_reason)
    if same_feedback and (feedback != "Interested" or item.follow_up_task):
        return _feedback_response(session, item)
    if session.status == "Closed":
        _invalid("Phiên tư vấn đã đóng, không thể thay đổi feedback.")

    if feedback == "Interested" and not item.follow_up_task:
        if not frappe.has_permission("CRM Task", "create"):
            frappe.throw("Không có quyền tạo CRM Task.", frappe.PermissionError)
        settings = frappe.get_single("BeautyMatch Settings")
        assignee = settings.default_follow_up_assignee or None
        if assignee and not frappe.db.exists("User", assignee):
            _invalid("Nhân viên phụ trách mặc định không tồn tại.")
        try:
            due_days = int(settings.default_follow_up_due_days or 1)
        except (TypeError, ValueError, OverflowError):
            _invalid("Số ngày follow-up trong BeautyMatch Settings không hợp lệ.")
        if not 0 <= due_days <= 365:
            _invalid("Số ngày follow-up phải từ 0 đến 365.")
        task = frappe.get_doc({
            "doctype": "CRM Task",
            "title": f"BeautyMatch follow-up: {item.product_name_snapshot}"[:140],
            "priority": "Medium",
            "status": "Todo",
            "assigned_to": assignee,
            "due_date": add_to_date(now_datetime(), days=due_days),
            "description": (
                f"Khách hàng quan tâm sản phẩm {item.product_name_snapshot} "
                f"({item.product_code_snapshot}). "
                f"Recommendation Session: {session.name}; Item: {item.name}."
            ),
            "reference_doctype": "CRM Lead",
            "reference_docname": session.crm_lead,
        })
        task.insert()  # Respect CRM Task permissions; do not bypass them.
        item.follow_up_task = task.name

    item.customer_feedback = feedback
    item.rejection_reason = rejection_reason if feedback == "Not Interested" else None
    item.feedback_date = now_datetime()
    session.status = (
        "Follow-up Created"
        if any(row.follow_up_task for row in session.recommendation_items)
        else "Feedback Received"
    )
    # Child table has no independent permissions; Lead read/write checked above.
    session.save(ignore_permissions=True)
    return _feedback_response(session, item)
