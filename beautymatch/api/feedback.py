"""Staff feedback records preference; contact work requires separate consent.

The endpoint name is retained. Legacy sessions/tasks are never deleted or
reopened/cancelled merely because a product preference changes.
"""
import frappe

FEEDBACK_CHOICES = {"Interested", "Not Interested"}
REJECTION_REASONS = {
    "Không thích thương hiệu",
    "Không phù hợp sở thích cá nhân",
    "Đã từng sử dụng",
    "Muốn tìm lựa chọn khác",
    "Khác",
}


@frappe.whitelist(methods=["POST"])
def submit_feedback(session_id, item_id, customer_feedback, rejection_reason=None):
    from beautymatch.api.self_service import record_staff_feedback
    return record_staff_feedback(session_id, item_id, customer_feedback, rejection_reason)
