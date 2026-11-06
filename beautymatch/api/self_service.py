"""Customer-owned recommendation endpoints. Never grant CRM roles to customers."""
import json

import frappe
from frappe.utils import now_datetime

from beautymatch.api import profile as intake, portal, recommendation


def owned_session(session_id, lock=False):
    user = portal._customer()
    lead = portal._account(user)
    if not isinstance(session_id, str) or not session_id.strip() or len(session_id) > 140 or not lead:
        portal._deny()
    if lock:
        intake._acquire_lock("feedback-session", session_id)
    session = frappe.get_doc("Recommendation Session", session_id, for_update=lock)
    if session.crm_lead != lead.name or session.get("customer_user") != user.name:
        portal._deny()
    return user, lead, session


@frappe.whitelist(methods=["POST"])
def recommend(payload):
    user = portal._customer()
    data = portal.normalize_customer_payload(payload, user.email)
    intake._acquire_lock("portal-user", user.name)
    intake._lock_submission(data)
    existing = frappe.db.get_value("Consultation Submission", {"request_id": data["request_id"]}, "name", for_update=True)
    if existing:
        submission = frappe.get_doc("Consultation Submission", existing, for_update=True)
        linked = portal._account(user, for_update=True)
        if not linked or linked.name != submission.crm_lead:
            portal._deny()
        if submission.payload_hash != intake._payload_hash(data):
            raise intake.RequestConflictError("Mã yêu cầu đã được dùng cho nội dung khác.")
        session_id = frappe.db.get_value("Recommendation Session", {"request_id": data["request_id"]}, "name", for_update=True)
        if not session_id:
            frappe.throw("Mã tư vấn thuộc luồng cũ. Vui lòng gửi yêu cầu mới.")
        return get_result(session_id)
    lead, profile, receipt = portal._store_customer_profile(user, data, self_service=True)
    from beautymatch.services.request_notifications import schedule
    for name in frappe.get_all("BeautyMatch Customer Request", filters={"customer": user.name, "status": ["in", ["Pending", "In Progress"]]}, pluck="name"):
        frappe.db.set_value("BeautyMatch Customer Request", name, {"status": "Superseded", "notification_status": "Pending"})
        schedule(name)
    submission = frappe.get_doc("Consultation Submission", {"request_id": data["request_id"]})
    result = recommendation._generate_saved_submission(lead.name, profile.name, data["request_id"], receipt["profile_version"], submission, customer_user=user.name)
    return get_result(result["session_id"])


@frappe.whitelist(methods=["POST"])
def get_result(session_id):
    user, lead, session = owned_session(session_id)
    # Expose only the customer's catalog snapshot, never CRM notes or task internals.
    result = recommendation._serialize_session(session)
    for key in ("crm_lead", "beauty_profile"):
        result.pop(key, None)
    from beautymatch.api.customer_care import public_request, CONTACT
    result["contact_requests"] = [public_request(frappe.get_doc(CONTACT, row.name)) for row in frappe.get_all(CONTACT, filters={"customer": user.name, "recommendation_session": session.name}, fields=["name"], order_by="creation desc", limit_page_length=20)]
    result["profile"] = json.loads(session.profile_snapshot)
    result["created_at"] = portal._timestamp(session.creation)
    result["contact_options"] = {"Email": user.email, "Phone": lead.mobile_no or lead.phone or ""}
    return result


@frappe.whitelist(methods=["POST"])
def history():
    user = portal._customer()
    return {"sessions": frappe.get_all("Recommendation Session", filters={"customer_user": user.name}, fields=["name", "creation", "number_of_recommendations"], order_by="creation desc, name desc", limit_page_length=30)}


def record_feedback(session, item_id, customer_feedback, rejection_reason, source):
    if not isinstance(item_id, str) or not item_id or len(item_id) > 140 or not isinstance(customer_feedback, str):
        frappe.throw("Thông tin phản hồi không hợp lệ.")
    if rejection_reason is not None and not isinstance(rejection_reason, str):
        frappe.throw("Lý do không hợp lệ.")
    rejection_reason = (rejection_reason or "").strip()
    if customer_feedback == "Interested" and rejection_reason:
        frappe.throw("Phản hồi Quan tâm không có lý do từ chối.")
    if customer_feedback not in {"Interested", "Not Interested"}:
        frappe.throw("Phản hồi không hợp lệ.")
    from beautymatch.api.feedback import REJECTION_REASONS
    if rejection_reason and rejection_reason not in REJECTION_REASONS:
        frappe.throw("Lý do không hợp lệ.")
    item = next((row for row in session.recommendation_items if row.name == item_id), None)
    if not item:
        portal._deny()
    if session.status == "Closed":
        frappe.throw("Phiên đã đóng, không thể thay đổi phản hồi.")
    if item.customer_feedback != customer_feedback or (item.rejection_reason or "") != (rejection_reason or ""):
        item.feedback_date = now_datetime()
    item.customer_feedback = customer_feedback
    item.rejection_reason = rejection_reason if customer_feedback == "Not Interested" else None
    item.feedback_source = source
    item.feedback_by = frappe.session.user
    session.status = "Feedback Received"
    session.save(ignore_permissions=True)
    return {"session_id": session.name, "item_id": item.name, "customer_feedback": item.customer_feedback, "feedback_source": source, "follow_up_status": "NOT_REQUESTED" if customer_feedback == "Interested" else "NOT_APPLICABLE", "follow_up_task": None}


@frappe.whitelist(methods=["POST"])
def submit_feedback(session_id, item_id, customer_feedback, rejection_reason=None):
    _, _, session = owned_session(session_id, lock=True)
    return record_feedback(session, item_id, customer_feedback, rejection_reason, "Customer")


@frappe.whitelist(methods=["POST"])
def record_staff_feedback(session_id, item_id, customer_feedback, rejection_reason=None):
    intake._check_consultation_role()
    if not isinstance(session_id, str) or not session_id.strip() or len(session_id) > 140:
        frappe.throw("Mã phiên tư vấn không hợp lệ.")
    session = frappe.get_doc("Recommendation Session", session_id)
    intake._check_lead_access(session.crm_lead)
    intake._acquire_lock("feedback-session", session_id)
    session = frappe.get_doc("Recommendation Session", session_id, for_update=True)
    intake._check_lead_access(session.crm_lead)
    return record_feedback(session, item_id, customer_feedback, rejection_reason, "Staff")
