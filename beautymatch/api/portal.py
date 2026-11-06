"""Authenticated customer intake and permission-scoped staff handoff.

Website users never receive staff roles. All ignore_permissions writes below
are allowlisted service writes after ownership checks; no arbitrary dispatch,
caller-selected Lead, privilege switching or public Lead listing is supported.
Existing TASK 2 validation/identity/locks/current-profile logic is reused.
"""
import json

import frappe

from beautymatch.api import profile as intake
from beautymatch.api.recommendation import PROFILE_FIELDS

CUSTOMER_ROLE = "BeautyMatch Customer"
STATES = {"Pending", "In Progress", "Completed", "Superseded"}


def _deny():
    frappe.throw("Bạn không có quyền truy cập thông tin này.", frappe.PermissionError)


def _customer():
    user = frappe.session.user
    if user == "Guest" or CUSTOMER_ROLE not in frappe.get_roles(user):
        _deny()
    doc = frappe.get_doc("User", user)
    if not doc.enabled or doc.user_type != "Website User" or not doc.email:
        _deny()
    return doc


def normalize_customer_payload(payload, email):
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)
    allowed = {
        "full_name", "email", "phone", "skin_type", "sensitivity", "requested_category",
        "max_budget", "preferred_brand", "consent", "request_id",
        *intake.CONCERN_FIELDS, *intake.AVOID_FIELDS,
    }
    if not isinstance(payload, dict) or set(payload) - allowed:
        frappe.throw("Yêu cầu chứa trường không được phép.", frappe.ValidationError)
    if str(payload.get("email", "")).strip().lower() != email.strip().lower():
        _deny()
    return intake._validate_payload({**payload, "email": email.strip().lower()})


def _account(user):
    name = frappe.db.get_value("BeautyMatch Customer Account", {"user": user.name}, "crm_lead")
    if not name:
        return None
    lead = frappe.get_doc("CRM Lead", name)
    if (lead.email or "").strip().lower() != user.email.strip().lower():
        _deny()
    return lead


def _ack(request):
    return {"request_id": request.name, "status": request.status, "submitted_at": _timestamp(request.creation)}


def _timestamp(value):
    from beautymatch.api.frontend import _created_at
    return _created_at(value)


@frappe.whitelist(methods=["POST"])
def get_my_profile():
    user = _customer()
    lead = _account(user)
    profile = {}
    full_name = user.full_name
    if lead:
        name = frappe.db.get_value("Beauty Profile", {"crm_lead": lead.name}, "name")
        if name:
            doc = frappe.get_doc("Beauty Profile", name)
            profile = {field: doc.get(field) for field in PROFILE_FIELDS}
            full_name = doc.full_name or full_name
    requests = frappe.get_all(
        "BeautyMatch Customer Request", filters={"customer": user.name},
        fields=["name", "status", "creation"], order_by="creation desc", limit_page_length=10,
    )
    return {
        "full_name": full_name,
        "email": user.email, "phone": (lead.mobile_no or lead.phone or "") if lead else "",
        "profile": profile,
        "requests": [{"request_id": row.name, "status": row.status, "submitted_at": _timestamp(row.creation)} for row in requests],
    }


@frappe.whitelist(methods=["POST"])
def submit_profile(payload):
    user = _customer()
    data = normalize_customer_payload(payload, user.email)
    # Serialize all intakes for this authenticated account, then use TASK 2's
    # globally consistent request/contact locks (released on commit/rollback).
    intake._acquire_lock("portal-user", user.name)
    intake._lock_submission(data)
    existing = frappe.db.exists("BeautyMatch Customer Request", data["request_id"])
    if existing:
        request = frappe.get_doc("BeautyMatch Customer Request", existing)
        if request.customer != user.name:
            _deny()
        if request.payload_hash != intake._payload_hash(data):
            raise intake.RequestConflictError("Mã yêu cầu đã được dùng cho nội dung khác.")
        return _ack(request)
    if frappe.db.exists("Consultation Submission", {"request_id": data["request_id"]}):
        frappe.throw("Mã yêu cầu không hợp lệ. Vui lòng gửi lại với yêu cầu mới.", frappe.ValidationError)
    lead = _account(user)
    found = intake._find_existing_lead(data)
    if lead and found and found != lead.name:
        _deny()
    if not lead and found:
        candidate = frappe.get_doc("CRM Lead", found)
        # A phone number alone is never proof of ownership of an existing Lead.
        if (candidate.email or "").strip().lower() != user.email.strip().lower():
            _deny()
        lead = candidate
    if lead:
        intake._check_lead_identity(lead, data)
        lead.first_name = data["full_name"]
        if data["phone"] and not lead.mobile_no and not lead.phone:
            lead.mobile_no = data["phone"]
        lead.save(ignore_permissions=True)
    else:
        assignee = frappe.db.get_single_value("BeautyMatch Settings", "default_follow_up_assignee")
        if not assignee or not frappe.db.get_value("User", assignee, "enabled") or not set(frappe.get_roles(assignee)).intersection({"Sales User", "Sales Manager"}):
            frappe.throw("Chưa cấu hình nhân viên tiếp nhận. Vui lòng liên hệ BeautyMatch.", frappe.ValidationError)
        lead = frappe.get_doc({
            "doctype": "CRM Lead", "first_name": data["full_name"], "email": data["email"],
            "mobile_no": data["phone"], "status": "New", "lead_owner": assignee,
        }).insert(ignore_permissions=True)
    if not frappe.db.exists("BeautyMatch Customer Account", {"user": user.name}):
        if frappe.db.exists("BeautyMatch Customer Account", {"crm_lead": lead.name}):
            _deny()
        frappe.get_doc({"doctype": "BeautyMatch Customer Account", "user": user.name, "crm_lead": lead.name}).insert(ignore_permissions=True)
    profile = intake._save_profile(data, lead.name)
    receipt = {
        "crm_lead": lead.name, "beauty_profile": profile.name, "request_id": data["request_id"],
        "profile_version": str(profile.modified), "is_existing_lead": bool(found),
    }
    frappe.get_doc({
        "doctype": "Consultation Submission", "request_id": data["request_id"],
        "payload_hash": intake._payload_hash(data), "crm_lead": lead.name,
        "beauty_profile": profile.name, "profile_version": str(profile.modified),
        "response_json": json.dumps(receipt, ensure_ascii=False),
    }).insert(ignore_permissions=True)
    # Preserve completed history; only unaccepted older requests are superseded.
    for name in frappe.get_all("BeautyMatch Customer Request", filters={"customer": user.name, "status": "Pending"}, pluck="name"):
        frappe.db.set_value("BeautyMatch Customer Request", name, "status", "Superseded")
    request = frappe.get_doc({
        "doctype": "BeautyMatch Customer Request", "request_id": data["request_id"],
        "customer": user.name, "crm_lead": lead.name, "beauty_profile": profile.name,
        "profile_version": str(profile.modified), "status": "Pending",
        "payload_hash": intake._payload_hash(data), "payload_json": json.dumps(data, ensure_ascii=False),
    }).insert(ignore_permissions=True)
    return _ack(request)


@frappe.whitelist(methods=["POST"])
def list_requests(status="Pending", start=0):
    intake._check_consultation_role()
    if status not in STATES:
        frappe.throw("Trạng thái yêu cầu không hợp lệ.", frappe.ValidationError)
    try:
        start = max(0, min(100000, int(start)))
    except (TypeError, ValueError):
        frappe.throw("Phân trang không hợp lệ.", frappe.ValidationError)
    leads = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
    rows = frappe.get_all(
        "BeautyMatch Customer Request", filters={"crm_lead": ["in", leads], "status": status},
        fields=["name", "crm_lead", "beauty_profile", "status", "assigned_to", "creation", "payload_json"],
        order_by="creation desc", start=start, limit_page_length=21,
    ) if leads else []
    result = []
    for row in rows[:20]:
        snapshot = json.loads(row.pop("payload_json"))
        result.append({**row, "full_name": snapshot["full_name"], "profile": {field: snapshot.get(field) for field in PROFILE_FIELDS}})
    return {"requests": result, "has_more": len(rows) > 20, "start": start}


def _staff_request(request_id):
    intake._check_consultation_role()
    if not isinstance(request_id, str) or len(request_id) > 140:
        _deny()
    request = frappe.get_doc("BeautyMatch Customer Request", request_id)
    intake._check_lead_access(request.crm_lead)
    intake._acquire_lock("portal-request", request.name)
    request = frappe.get_doc("BeautyMatch Customer Request", request.name, for_update=True)
    intake._check_lead_access(request.crm_lead)
    if request.assigned_to and request.assigned_to != frappe.session.user and not set(frappe.get_roles()).intersection({"Sales Manager", "System Manager"}):
        _deny()
    return request


@frappe.whitelist(methods=["POST"])
def accept_request(request_id):
    request = _staff_request(request_id)
    if request.status not in {"Pending", "In Progress"}:
        frappe.throw("Yêu cầu không còn chờ tư vấn. Vui lòng tải lại danh sách.", frappe.ValidationError)
    request.status = "In Progress"
    request.assigned_to = frappe.session.user
    request.save(ignore_permissions=True)
    return {"request_id": request.name, "crm_lead": request.crm_lead, "status": request.status}


@frappe.whitelist(methods=["POST"])
def complete_request(request_id, session_id):
    request = _staff_request(request_id)
    session = frappe.get_doc("Recommendation Session", session_id)
    if session.crm_lead != request.crm_lead or session.beauty_profile != request.beauty_profile or session.creation < request.creation:
        _deny()
    if request.status == "Completed" and request.recommendation_session == session.name:
        return {"status": "Completed"}
    if request.status != "In Progress" or session.owner != frappe.session.user:
        _deny()
    request.status = "Completed"
    request.recommendation_session = session.name
    request.save(ignore_permissions=True)
    return {"status": request.status}


def restrict_customer_crm():
    """Runs after Frappe initializes its session; APIs still enforce permissions."""
    path = frappe.local.request.path.rstrip("/")
    if (path == "/crm" or path.startswith("/crm/")) and frappe.session.user != "Guest" and frappe.db.get_value("User", frappe.session.user, "user_type") == "Website User" and CUSTOMER_ROLE in frappe.get_roles():
        _deny()
