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


def _feedback_response(session, item, follow_up_status):
    return {
        "session_id": session.name,
        "item_id": item.name,
        "customer_feedback": item.customer_feedback,
        "follow_up_status": follow_up_status,
        "follow_up_task": item.follow_up_task or None,
    }


@frappe.whitelist(methods=["POST"])
def submit_feedback(session_id, item_id, customer_feedback, rejection_reason=None):
    """Save feedback and create at most one CRM follow-up task per item."""
    _check_consultation_role()

    for key, value in (
        ("session_id", session_id),
        ("item_id", item_id),
        ("customer_feedback", customer_feedback),
    ):
        if not isinstance(value, str) or not value.strip():
            _invalid(f"Thiếu hoặc không hợp lệ: {key}.")

    session_id = session_id.strip()
    item_id = item_id.strip()
    customer_feedback = customer_feedback.strip()

    if customer_feedback not in FEEDBACK_CHOICES:
        _invalid("customer_feedback phải là Interested hoặc Not Interested.")

    if rejection_reason is not None and not isinstance(rejection_reason, str):
        _invalid("rejection_reason phải là chuỗi.")

    rejection_reason = (rejection_reason or "").strip()

    if customer_feedback == "Interested" and rejection_reason:
        _invalid("Interested không được có rejection_reason.")

    if customer_feedback == "Not Interested" and rejection_reason not in REJECTION_REASONS:
        _invalid("Not Interested yêu cầu rejection_reason hợp lệ.")

    session = frappe.get_doc("Recommendation Session", session_id)
    _check_lead_access(session.crm_lead)

    _acquire_lock("feedback-session", session_id)

    session = frappe.get_doc("Recommendation Session", session_id)
    _check_lead_access(session.crm_lead)

    item = next(
        (row for row in session.recommendation_items if row.name == item_id),
        None,
    )
    if item is None:
        _invalid("Recommendation Item không thuộc phiên tư vấn này.")

    same_feedback = (
        item.customer_feedback == customer_feedback
        and (item.rejection_reason or "") == rejection_reason
    )

    if session.status == "Closed" and not same_feedback:
        _invalid("Phiên tư vấn đã đóng, không thể thay đổi feedback.")

    follow_up_status = "NOT_APPLICABLE"
    follow_up_key = f"{session.name}:{item.name}"

    if customer_feedback == "Interested":
        task_name = item.follow_up_task or frappe.db.get_value(
            "CRM Task",
            {"beautymatch_follow_up_key": follow_up_key},
            "name",
        )

        if task_name:
            task = frappe.get_doc("CRM Task", task_name)
            if task.get("beautymatch_follow_up_key") != follow_up_key:
                _invalid("CRM Task không khớp Recommendation Item.")

            if task.status == "Canceled":
                if not frappe.has_permission("CRM Task", "write", doc=task):
                    frappe.throw(
                        "Không có quyền mở lại CRM Task.",
                        frappe.PermissionError,
                    )
                task.status = "Todo"
                task.save()

            item.follow_up_task = task.name
            follow_up_status = "CREATED"
        else:
            settings = frappe.get_single("BeautyMatch Settings")
            assignee = settings.default_follow_up_assignee or None

            if not assignee:
                follow_up_status = "PENDING"
            else:
                if not frappe.db.exists("User", assignee):
                    _invalid("Nhân viên phụ trách mặc định không tồn tại.")

                if not frappe.has_permission("CRM Task", "create"):
                    frappe.throw(
                        "Không có quyền tạo CRM Task.",
                        frappe.PermissionError,
                    )

                try:
                    due_days = int(settings.default_follow_up_due_days or 1)
                except (TypeError, ValueError, OverflowError):
                    _invalid("Số ngày follow-up không hợp lệ.")

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
                        f"Khách hàng quan tâm {item.product_name_snapshot} "
                        f"({item.product_code_snapshot}). "
                        f"Session: {session.name}; Item: {item.name}."
                    ),
                    "reference_doctype": "CRM Lead",
                    "reference_docname": session.crm_lead,
                    "beautymatch_session": session.name,
                    "beautymatch_item": item.name,
                    "beautymatch_follow_up_key": follow_up_key,
                })

                task.insert()
                item.follow_up_task = task.name
                follow_up_status = "CREATED"

    if customer_feedback == "Not Interested":
        task_name = item.follow_up_task or frappe.db.get_value(
            "CRM Task",
            {"beautymatch_follow_up_key": follow_up_key},
            "name",
        )

        if task_name:
            task = frappe.get_doc("CRM Task", task_name)
            if task.get("beautymatch_follow_up_key") != follow_up_key:
                _invalid("CRM Task không khớp Recommendation Item.")

            if task.status != "Canceled":
                if not frappe.has_permission("CRM Task", "write", doc=task):
                    frappe.throw(
                        "Không có quyền cập nhật CRM Task.",
                        frappe.PermissionError,
                    )
                task.status = "Canceled"
                task.save()

            item.follow_up_task = task.name

    item.customer_feedback = customer_feedback
    item.rejection_reason = (
        rejection_reason if customer_feedback == "Not Interested" else None
    )

    if not same_feedback:
        item.feedback_date = now_datetime()

    session.status = (
        "Follow-up Created"
        if any(
            row.follow_up_task and row.customer_feedback == "Interested"
            for row in session.recommendation_items
        )
        else "Feedback Received"
    )

    session.save(ignore_permissions=True)

    return _feedback_response(session, item, follow_up_status)
