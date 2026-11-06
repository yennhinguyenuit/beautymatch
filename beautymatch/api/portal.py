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


def _account(user, for_update=False):
    name = frappe.db.get_value("BeautyMatch Customer Account", {"user": user.name}, "crm_lead", for_update=for_update)
    if not name:
        return None
    lead = frappe.get_doc("CRM Lead", name, for_update=for_update)
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
    """Compatibility entry now follows instant self-service, never creates a queue item."""
    from beautymatch.api.self_service import recommend
    return recommend(payload)


def _submit_legacy_profile(payload):
    """Historical fixture helper; not whitelisted, never used by the portal."""
    user = _customer()
    data = normalize_customer_payload(payload, user.email)
    # Serialize all intakes for this authenticated account, then use TASK 2's
    # globally consistent request/contact locks (released on commit/rollback).
    intake._acquire_lock("portal-user", user.name)
    intake._lock_submission(data)
    # Locking reads see commits made while this transaction waited for the
    # advisory lock (MariaDB REPEATABLE READ otherwise retains an old snapshot).
    existing = frappe.db.get_value("BeautyMatch Customer Request", data["request_id"], "name", for_update=True)
    if existing:
        request = frappe.get_doc("BeautyMatch Customer Request", existing, for_update=True)
        if request.customer != user.name:
            _deny()
        if request.payload_hash != intake._payload_hash(data):
            raise intake.RequestConflictError("Mã yêu cầu đã được dùng cho nội dung khác.")
        return _ack(request)
    if frappe.db.get_value("Consultation Submission", {"request_id": data["request_id"]}, "name", for_update=True):
        frappe.throw("Mã yêu cầu không hợp lệ. Vui lòng gửi lại với yêu cầu mới.", frappe.ValidationError)
    lead, profile, receipt = _store_customer_profile(user, data)
    request = frappe.get_doc({
        "doctype": "BeautyMatch Customer Request", "request_id": data["request_id"],
        "customer": user.name, "crm_lead": lead.name, "beauty_profile": profile.name,
        "profile_version": str(profile.modified), "status": "Pending",
        "notification_status": "Pending",
        "payload_hash": intake._payload_hash(data), "payload_json": json.dumps(data, ensure_ascii=False),
    }).insert(ignore_permissions=True)
    # The same customer lock is held by every staff transition. Never leave an
    # accepted A looking actionable after B updates the single current profile.
    previous = frappe.db.sql(
        "SELECT name FROM `tabBeautyMatch Customer Request` WHERE customer=%s AND status IN ('Pending', 'In Progress') AND name!=%s FOR UPDATE",
        (user.name, request.name),
    )
    for (name,) in previous:
        frappe.db.set_value("BeautyMatch Customer Request", name, {
            "status": "Superseded", "superseded_by": request.name,
            "notification_status": "Pending",
        })
    from beautymatch.services.request_notifications import stage, schedule
    stage(request)
    for (name,) in previous:
        schedule(name)
    return _ack(request)


@frappe.whitelist(methods=["POST"])
def list_requests(status="Pending", start=0, search=""):
    intake._check_consultation_role()
    if status not in STATES:
        frappe.throw("Trạng thái yêu cầu không hợp lệ.", frappe.ValidationError)
    try:
        start = max(0, min(100000, int(start)))
    except (TypeError, ValueError):
        frappe.throw("Phân trang không hợp lệ.", frappe.ValidationError)
    if not isinstance(search, str) or len(search) > 140:
        frappe.throw("Từ khóa tìm kiếm không hợp lệ.", frappe.ValidationError)
    leads = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
    filters = {"crm_lead": ["in", leads], "status": status}
    # Search the submitted name, never the newer mutable Lead/profile name.
    if search.strip() and leads:
        placeholders = ",".join(["%s"] * len(leads))
        matching = frappe.db.sql(
            f"SELECT name FROM `tabBeautyMatch Customer Request` WHERE crm_lead IN ({placeholders}) AND status=%s AND (name LIKE %s OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.full_name')) LIKE %s)",
            (*leads, status, f"%{search.strip()}%", f"%{search.strip()}%"),
        )
        if not matching:
            return {"requests": [], "has_more": False, "start": start, "total": 0}
        filters["name"] = ["in", [row[0] for row in matching]]
    total = frappe.get_all("BeautyMatch Customer Request", filters=filters, fields=["count(name) as total"])[0].total if leads else 0
    rows = frappe.get_all(
        "BeautyMatch Customer Request", filters=filters,
        fields=["name", "crm_lead", "beauty_profile", "status", "assigned_to", "creation", "payload_json"],
        order_by="creation desc, name desc", start=start, limit_page_length=21,
    ) if leads else []
    result = []
    for row in rows[:20]:
        snapshot = json.loads(row.pop("payload_json"))
        writable = frappe.has_permission("CRM Lead", "write", doc=frappe.get_doc("CRM Lead", row.crm_lead))
        result.append({**row, "submitted_at": _timestamp(row.creation),
            "assigned_name": frappe.db.get_value("User", row.assigned_to, "full_name") if row.assigned_to else None,
            "can_accept": bool(writable and row.status == "Pending" and not row.assigned_to),
            "can_continue": bool(writable and row.status == "In Progress" and row.assigned_to == frappe.session.user),
            "full_name": snapshot["full_name"], "profile": {field: snapshot.get(field) for field in PROFILE_FIELDS}})
    # Retry failed outbox entries on a normal authorized queue refresh, as well
    # as through the scheduler. The queue response never depends on delivery.
    from beautymatch.services.request_notifications import schedule
    for name in frappe.get_all("BeautyMatch Customer Request", filters={"name": ["in", [row["name"] for row in result]], "notification_status": ["in", ["Pending", "Failed"]]}, limit_page_length=5, pluck="name") if result else []:
        schedule(name)
    return {"requests": result, "has_more": len(rows) > 20, "start": start, "total": total}


def _staff_request(request_id):
    intake._check_consultation_role()
    if not isinstance(request_id, str) or len(request_id) > 140:
        _deny()
    request = frappe.get_doc("BeautyMatch Customer Request", request_id)
    intake._check_lead_access(request.crm_lead)
    # Same lock order as customer submit: account -> request -> contact/profile.
    intake._acquire_lock("portal-user", request.customer)
    intake._acquire_lock("portal-request", request.name)
    request = frappe.get_doc("BeautyMatch Customer Request", request.name, for_update=True)
    intake._check_lead_access(request.crm_lead)
    return request


def _conflict(message):
    frappe.throw(message, exc=intake.RequestConflictError)


def _owner(request):
    if request.assigned_to != frappe.session.user:
        _conflict("Yêu cầu đã được nhân viên khác tiếp nhận. Vui lòng tải lại danh sách.")


def _version(request, expected):
    profile = frappe.get_doc("Beauty Profile", request.beauty_profile, for_update=True)
    if str(profile.modified) != str(expected):
        _conflict("Hồ sơ đã thay đổi. Hãy tải lại yêu cầu mới nhất trước khi tư vấn.")


def _request_view(request):
    snapshot = json.loads(request.payload_json)
    return {**_ack(request), "crm_lead": request.crm_lead,
        "assigned_to": request.assigned_to, "superseded_by": request.superseded_by,
        "snapshot": snapshot, "profile_version": request.profile_version,
        "session_id": request.recommendation_session,
        "can_accept": request.status == "Pending" and not request.assigned_to,
        "can_continue": request.status == "In Progress" and request.assigned_to == frappe.session.user}


@frappe.whitelist(methods=["POST"])
def get_request(request_id=None, session_id=None):
    """Server recovery; no browser storage is needed to resume a claimed request."""
    intake._check_consultation_role()
    if session_id and not request_id:
        session = frappe.get_doc("Recommendation Session", session_id)
        intake._check_lead_access(session.crm_lead)
        request_id = frappe.db.get_value("BeautyMatch Customer Request", {"recommendation_session": session.name}, "name")
        if not request_id:
            return None
    return _request_view(_staff_request(request_id))


@frappe.whitelist(methods=["POST"])
def accept_request(request_id):
    request = _staff_request(request_id)
    if request.status not in {"Pending", "In Progress"}:
        _conflict("Yêu cầu không còn chờ tư vấn hoặc đã có yêu cầu mới hơn. Vui lòng tải lại danh sách.")
    if request.assigned_to and request.assigned_to != frappe.session.user:
        _owner(request)
    if not request.recommendation_session:
        _version(request, request.profile_version)
    request.status = "In Progress"
    request.assigned_to = frappe.session.user
    request.save(ignore_permissions=True)
    from beautymatch.services.request_notifications import schedule
    schedule(request.name)
    return _request_view(request)


@frappe.whitelist(methods=["POST"])
def generate_for_request(request_id, payload):
    """Atomically bind an explicitly confirmed consultation to its request.

    Original snapshot/version stay immutable. A staff edit creates a separate
    TASK 2 submission/version. Session association commits before completion.
    """
    from beautymatch.api.frontend import save_consultation
    from beautymatch.api.recommendation import generate_recommendations, get_recommendation_result
    request = _staff_request(request_id)
    _owner(request)
    data = intake._validate_payload(payload)
    if request.recommendation_session:
        if intake._payload_hash(data) != request.consultation_hash:
            _conflict("Yêu cầu đã có kết quả. Hãy mở lại kết quả đã lưu; không gửi nội dung khác.")
        return {"receipt": json.loads(request.consultation_receipt), "result": get_recommendation_result(request.recommendation_session)}
    if request.status != "In Progress":
        _conflict("Yêu cầu đã có yêu cầu mới hơn hoặc không còn đang tư vấn. Hãy tải lại danh sách.")
    # Match TASK 2's contact -> Lead -> profile lock order. Do not hold the
    # profile lock while waiting for a generic staff intake's contact lock.
    intake._lock_submission(data)
    lead = frappe.get_doc("CRM Lead", request.crm_lead, for_update=True)
    lead.check_permission("read")
    lead.check_permission("write")
    _version(request, request.profile_version)
    if frappe.db.get_value("Consultation Submission", {"request_id": data["request_id"]}, "name", for_update=True):
        _conflict("Mã phiên tư vấn đã được dùng. Hãy mở kết quả cũ hoặc xác nhận một phiên mới cho yêu cầu này.")
    receipt = save_consultation(data, request.crm_lead)
    identifiers = {key: receipt[key] for key in ("crm_lead", "beauty_profile", "request_id", "profile_version")}
    result = generate_recommendations(**identifiers)
    request.consultation_receipt = json.dumps(identifiers)
    request.consultation_hash = intake._payload_hash(data)
    request.recommendation_session = result["session_id"]
    request.save(ignore_permissions=True)
    return {"receipt": identifiers, "result": result}


@frappe.whitelist(methods=["POST"])
def complete_request(request_id, session_id):
    request = _staff_request(request_id)
    _owner(request)
    session = frappe.get_doc("Recommendation Session", session_id)
    if request.recommendation_session != session.name or not request.consultation_receipt:
        _conflict("Kết quả không thuộc phiên tư vấn đã xác nhận của yêu cầu này.")
    receipt = json.loads(request.consultation_receipt)
    if session.crm_lead != request.crm_lead or session.beauty_profile != request.beauty_profile or session.request_id != receipt["request_id"]:
        _deny()
    if request.status == "Completed" and request.recommendation_session == session.name:
        return {"status": "Completed"}
    if request.status != "In Progress":
        _conflict("Yêu cầu đã có yêu cầu mới hơn. Kết quả cũ được giữ trong lịch sử; hãy tiếp nhận yêu cầu mới.")
    _version(request, receipt["profile_version"])
    request.status = "Completed"
    request.recommendation_session = session.name
    request.save(ignore_permissions=True)
    return {"status": request.status}


def restrict_customer_crm():
    """Runs after Frappe initializes its session; APIs still enforce permissions."""
    path = frappe.local.request.path.rstrip("/")
    if (path == "/crm" or path.startswith("/crm/")) and frappe.session.user != "Guest" and frappe.db.get_value("User", frappe.session.user, "user_type") == "Website User" and CUSTOMER_ROLE in frappe.get_roles():
        _deny()


def _store_customer_profile(user, data, self_service=False):
    """Private: caller validates ownership and holds account/contact locks."""
    lead = _account(user, for_update=True)
    found = intake._find_existing_lead(data)
    if lead and found and found != lead.name:
        _deny()
    if not lead and found:
        candidate = frappe.get_doc("CRM Lead", found, for_update=True)
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
        valid_assignee = assignee and frappe.db.get_value("User", assignee, "enabled") and set(frappe.get_roles(assignee)).intersection({"Sales User", "Sales Manager"})
        if not self_service and not valid_assignee:
            frappe.throw("Chưa cấu hình nhân viên tiếp nhận. Vui lòng liên hệ BeautyMatch.", frappe.ValidationError)
        lead = frappe.get_doc({
            "doctype": "CRM Lead", "first_name": data["full_name"], "email": data["email"],
            "mobile_no": data["phone"], "status": "New", "lead_owner": None if self_service else assignee,
        }).insert(ignore_permissions=True)
        if self_service and valid_assignee:
            # Internal ownership mapping without an unsolicited assignment bell.
            # Native controller access is based on this owner; no CRM role grant.
            frappe.db.set_value("CRM Lead", lead.name, "lead_owner", assignee)
            lead = frappe.get_doc("CRM Lead", lead.name, for_update=True)
    if not frappe.db.get_value("BeautyMatch Customer Account", {"user": user.name}, "name", for_update=True):
        if frappe.db.get_value("BeautyMatch Customer Account", {"crm_lead": lead.name}, "name", for_update=True):
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
    return lead, profile, receipt
