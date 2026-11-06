"""Explicit contact consent, scoped CRM work and genuine native call records."""
import json
from html import escape
from uuid import UUID
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import frappe
from frappe.utils import now_datetime, add_to_date, strip_html
from beautymatch.api import profile as intake, portal
from beautymatch.services.request_notifications import recipient_for

CONTACT = "BeautyMatch Contact Request"
OUTCOMES = {"Consulted": "Completed", "No Answer": "No Answer", "Call Back": "Completed", "No Longer Interested": "Completed", "More Information": "Completed"}


def _uuid(value):
    try:
        return str(UUID(value))
    except (ValueError, TypeError, AttributeError):
        frappe.throw("Mã yêu cầu không hợp lệ.")


def public_request(doc):
    return {"request_id": doc.name, "session_id": doc.recommendation_session, "status": doc.status,
        "channel": doc.channel, "contact_value": doc.contact_value, "preferred_time": doc.preferred_time,
        "products": json.loads(doc.selected_items), "created_at": portal._timestamp(doc.creation),
        "follow_up_status": "CREATED" if doc.task else "PENDING"}


def _create(session, lead, customer, payload):
    if isinstance(payload, str):
        payload = frappe.parse_json(payload)
    allowed = {"request_id", "item_ids", "channel", "contact_value", "preferred_time", "customer_note", "contact_consent"}
    if not isinstance(payload, dict) or set(payload) - allowed:
        frappe.throw("Thông tin liên hệ chứa trường không hợp lệ.")
    request_id = _uuid(payload.get("request_id"))
    intake._acquire_lock("care-contact", request_id)
    channel = payload.get("channel")
    if channel not in {"Phone", "Email"} or intake._flag(payload, "contact_consent") != 1:
        frappe.throw("Vui lòng chọn phương thức và đồng ý được liên hệ.")
    contact = intake._text(payload, "contact_value", required=True)
    if channel == "Phone":
        contact = intake._normalize_phone(contact)
        known = intake._normalize_phone(lead.mobile_no or lead.phone or "")
    else:
        contact = contact.lower()
        known = (lead.email or "").strip().lower()
    if not known or contact != known:
        frappe.throw("Liên hệ xác nhận phải khớp dữ liệu của khách. Vui lòng cập nhật hồ sơ trước.")
    ids = payload.get("item_ids")
    if not isinstance(ids, list) or not 1 <= len(ids) <= 3 or any(not isinstance(value, str) for value in ids) or len(set(ids)) != len(ids):
        frappe.throw("Chọn từ một đến ba sản phẩm đã quan tâm.")
    canonical = {"session_id": session.name, "item_ids": sorted(ids), "channel": channel, "contact_value": contact,
        "preferred_time": intake._text(payload, "preferred_time"),
        "customer_note": intake._text(payload, "customer_note", max_length=1000), "contact_consent": 1}
    digest = intake._payload_hash(canonical)
    existing = frappe.db.get_value(CONTACT, request_id, "name", for_update=True)
    if existing:
        doc = frappe.get_doc(CONTACT, existing, for_update=True)
        if doc.crm_lead != lead.name or doc.customer != customer:
            portal._deny()
        if doc.payload_hash != digest:
            raise intake.RequestConflictError("Mã liên hệ đã được dùng cho nội dung khác.")
        if doc.status == "Pending Assignment":
            _try_deliver(doc)
            doc = frappe.get_doc(CONTACT, doc.name)
        return public_request(doc)
    intake._acquire_lock("feedback-session", session.name)
    session = frappe.get_doc("Recommendation Session", session.name, for_update=True)
    # The session lock also deduplicates an active identical intent if a browser
    # loses its retry key. A completed/canceled intent needs fresh explicit consent.
    active = frappe.db.get_value(CONTACT, {"recommendation_session": session.name, "payload_hash": digest, "status": ["in", ["Pending Assignment", "Open", "In Progress"]]}, "name", for_update=True)
    if active:
        return public_request(frappe.get_doc(CONTACT, active, for_update=True))
    products = [row for row in session.recommendation_items if row.name in ids]
    if len(products) != len(ids) or any(row.customer_feedback != "Interested" for row in products):
        frappe.throw("Chỉ chọn sản phẩm đã đánh dấu Quan tâm trong đúng phiên tư vấn.")
    snapshot = [{"item_id": row.name, "product": row.product, "product_name": row.product_name_snapshot} for row in products]
    doc = frappe.get_doc({"doctype": CONTACT, "request_id": request_id, "customer": customer,
        "crm_lead": lead.name, "recommendation_session": session.name, "payload_hash": digest,
        "selected_items": json.dumps(snapshot, ensure_ascii=False), "channel": channel, "contact_value": contact,
        "preferred_time": canonical["preferred_time"], "customer_note": canonical["customer_note"],
        "contact_consent": 1, "status": "Pending Assignment", "notification_status": "Pending"}).insert(ignore_permissions=True)
    _try_deliver(doc)
    return public_request(frappe.get_doc(CONTACT, doc.name))


@frappe.whitelist(methods=["POST"])
def request_contact(session_id, payload):
    from beautymatch.api.self_service import owned_session
    user, lead, session = owned_session(session_id)
    return _create(session, lead, user.name, payload)


@frappe.whitelist(methods=["POST"])
def request_staff_contact(session_id, payload):
    """Staff records an explicit customer consent; same checks, no impersonation."""
    intake._check_consultation_role()
    session = frappe.get_doc("Recommendation Session", session_id)
    lead = intake._check_lead_access(session.crm_lead)
    customer = frappe.db.get_value("BeautyMatch Customer Account", {"crm_lead": lead.name}, "user")
    return _create(session, lead, customer, payload)


def _try_deliver(doc):
    """A failed delivery preserves consent; no partial task/notice or false CREATED."""
    point = "bm_care_delivery"
    frappe.db.savepoint(point)
    try:
        _deliver(doc.name)
    except Exception as error:
        frappe.db.rollback(save_point=point)
        frappe.db.set_value(CONTACT, doc.name, {"notification_status": "Failed", "delivery_error": type(error).__name__[:140]}, update_modified=False)


def _deliver(name):
    doc = frappe.get_doc(CONTACT, name, for_update=True)
    if doc.task or doc.status != "Pending Assignment":
        return
    recipient = recipient_for(doc.crm_lead)
    if not recipient:
        return
    lead = frappe.get_doc("CRM Lead", doc.crm_lead)
    products = json.loads(doc.selected_items)
    category = frappe.db.get_value("Recommendation Session", doc.recommendation_session, "requested_category")
    due_days = int(frappe.db.get_single_value("BeautyMatch Settings", "default_follow_up_due_days") or 1)
    if not 0 <= due_days <= 365:
        frappe.throw("Thời hạn công việc chưa hợp lệ.")
    title = f"BeautyMatch — Liên hệ tư vấn {category.lower()} cho {strip_html(lead.first_name or lead.name)}"[:140]
    description = "<p>Khách đã chủ động đồng ý được liên hệ.</p>" + "<p>" + escape("; ".join(row["product_name"] for row in products)) + "</p>"
    description += "<p>" + escape(f"{doc.channel}: {doc.contact_value}; {doc.preferred_time or ''}; {doc.customer_note or ''}") + "</p>"
    # Fixed service-owned fields only, after authenticated ownership + explicit
    # consent. Website users never gain generic Task/ToDo permissions.
    task = frappe.get_doc({"doctype": "CRM Task", "title": title, "description": description, "status": "Todo", "priority": "Medium",
        "reference_doctype": "CRM Lead", "reference_docname": doc.crm_lead,
        "due_date": add_to_date(now_datetime(), days=due_days), "beautymatch_contact_request": doc.name,
        "beautymatch_session": doc.recommendation_session, "beautymatch_follow_up_key": "contact:" + doc.name}).insert(ignore_permissions=True)
    from frappe.desk.form.assign_to import _add
    _add({"assign_to": [recipient], "doctype": "CRM Task", "name": str(task.name), "description": title}, ignore_permissions=True)
    # Reuse the native Task-assignment notification instead of adding a second
    # bell entry. Self-assignment has no native notification, so create one.
    notice_name = frappe.db.get_value("CRM Notification", {"notification_type_doctype": "CRM Task", "notification_type_doc": str(task.name), "to_user": recipient}, "name")
    values = {"notification_type_doctype": CONTACT, "notification_type_doc": doc.name,
        "reference_doctype": "CRM Lead", "reference_name": doc.crm_lead,
        "notification_text": f"BeautyMatch · {escape(strip_html(lead.first_name or 'Khách hàng'))} yêu cầu tư vấn thêm về {escape(category.lower())}.",
        "message": "Khách đã đồng ý được liên hệ. Mở yêu cầu để xem thông tin xác nhận.", "read": 0}
    if notice_name:
        frappe.db.set_value("CRM Notification", notice_name, values)
    else:
        frappe.get_doc({"doctype": "CRM Notification", "type": "Assignment", "to_user": recipient, "from_user": frappe.session.user, **values}).insert(ignore_permissions=True, set_name="bm-contact-" + doc.name)
    frappe.db.set_value(CONTACT, doc.name, {"assigned_to": recipient, "task": task.name, "status": "Open", "notification_status": "Sent", "delivery_error": ""})
    frappe.publish_realtime("crm_notification", user=recipient, after_commit=True)


def retry_pending():
    for name in frappe.get_all(CONTACT, filters={"status": "Pending Assignment"}, pluck="name", limit_page_length=50):
        _try_deliver(frappe.get_doc(CONTACT, name))


def staff_request(request_id, lock=False):
    intake._check_consultation_role()
    if not isinstance(request_id, str) or not request_id or len(request_id) > 140:
        frappe.throw("Mã liên hệ không hợp lệ.")
    doc = frappe.get_doc(CONTACT, request_id)
    intake._check_lead_access(doc.crm_lead)
    if lock:
        intake._acquire_lock("care-state", doc.name)
        doc = frappe.get_doc(CONTACT, doc.name, for_update=True)
        intake._check_lead_access(doc.crm_lead)
    return doc


def _staff_view(doc):
    result = public_request(doc)
    result.update({"crm_lead": doc.crm_lead, "customer_name": frappe.db.get_value("CRM Lead", doc.crm_lead, "first_name"),
        "assigned_to": doc.assigned_to, "task": str(doc.task) if doc.task else None, "customer_note": doc.customer_note,
        "task_status": frappe.db.get_value("CRM Task", doc.task, "status") if doc.task else None,
        "calls": frappe.get_all("CRM Call Log", filters={"beautymatch_contact_request": doc.name}, fields=["name", "status", "start_time", "duration", "caller", "beautymatch_outcome", "beautymatch_is_demo", "note"], order_by="creation desc", limit_page_length=50)})
    for call in result["calls"]:
        call["start_time"] = portal._timestamp(call.start_time) if call.start_time else None
        call["note_text"] = strip_html(frappe.db.get_value("FCRM Note", call.note, "content") or "") if call.note and frappe.has_permission("FCRM Note", "read", doc=call.note) else ""
    return result


@frappe.whitelist(methods=["POST"])
def get_contact(request_id):
    doc = staff_request(request_id)
    if doc.status == "Pending Assignment":
        _try_deliver(doc)
    return _staff_view(frappe.get_doc(CONTACT, request_id))


@frappe.whitelist(methods=["POST"])
def list_contacts(crm_lead=None):
    intake._check_consultation_role()
    allowed = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
    if crm_lead:
        intake._check_lead_access(crm_lead)
        allowed = [crm_lead]
    if not allowed:
        return {"requests": []}
    return {"requests": [_staff_view(frappe.get_doc(CONTACT, row.name)) for row in frappe.get_all(CONTACT, filters={"crm_lead": ["in", allowed]}, fields=["name"], order_by="creation desc", limit_page_length=50)]}


def validate_task(doc, method=None):
    _immutable_reference(doc)
    if not doc.get("beautymatch_contact_request"):
        return
    request = frappe.get_doc(CONTACT, doc.beautymatch_contact_request)
    if not (doc.is_new() and doc.flags.ignore_permissions):
        intake._check_consultation_role()
        intake._check_lead_access(request.crm_lead)
    if doc.reference_doctype != "CRM Lead" or doc.reference_docname != request.crm_lead:
        frappe.throw("CRM Task không khớp yêu cầu liên hệ.")
    if request.status in {"Do Not Contact", "Canceled"} and doc.status != "Canceled":
        frappe.throw("Khách đã yêu cầu dừng liên hệ; cần sự đồng ý mới, không mở lại công việc này.")
    if doc.status == "Done" and request.channel == "Phone" and not frappe.db.exists("CRM Call Log", {"beautymatch_contact_request": request.name, "beautymatch_outcome": "Consulted"}):
        frappe.throw("Cần ghi nhận tư vấn thành công trước khi hoàn thành công việc.")


def sync_task(doc, method=None):
    name = doc.get("beautymatch_contact_request")
    if name and doc.status == "Done":
        frappe.db.set_value(CONTACT, name, "status", "Completed")
    if name and doc.status == "Canceled" and frappe.db.get_value(CONTACT, name, "status") != "Do Not Contact":
        frappe.db.set_value(CONTACT, name, "status", "Canceled")


def validate_call(doc, method=None):
    _immutable_reference(doc)
    name = doc.get("beautymatch_contact_request")
    if not name:
        return
    request = staff_request(name)
    if doc.reference_doctype != "CRM Lead" or doc.reference_docname != request.crm_lead:
        frappe.throw("Cuộc gọi không khớp CRM Lead của yêu cầu.")
    tasks = [str(row.link_name) for row in doc.get("links", []) if row.link_doctype == "CRM Task"]
    if not request.task or str(request.task) not in tasks:
        frappe.throw("Cuộc gọi cần liên kết đúng công việc đã được giao.")
    if doc.note:
        note = frappe.get_doc("FCRM Note", doc.note)
        if note.reference_doctype != "CRM Lead" or note.reference_docname != request.crm_lead:
            frappe.throw("Ghi chú cuộc gọi không thuộc đúng khách hàng.")


def care_document_permission(doc, ptype=None, user=None):
    """Constrain only BeautyMatch-owned native work; retain all other CRM rules."""
    linked = doc.get("beautymatch_contact_request")
    if not doc.is_new():
        linked = frappe.db.get_value(doc.doctype, doc.name, "beautymatch_contact_request") or linked
    if not linked:
        return None
    lead = frappe.db.get_value(CONTACT, linked, "crm_lead")
    return bool(lead and frappe.has_permission("CRM Lead", "write" if ptype in {"write", "delete"} else "read", doc=lead, user=user))


def _immutable_reference(doc):
    previous = doc.get_doc_before_save()
    if previous and previous.get("beautymatch_contact_request") and previous.get("beautymatch_contact_request") != doc.get("beautymatch_contact_request"):
        frappe.throw("Không được gỡ hoặc đổi liên kết yêu cầu chăm sóc đã lưu.")


def validate_note(doc, method=None):
    _immutable_reference(doc)
    if doc.get("beautymatch_contact_request"):
        request = staff_request(doc.beautymatch_contact_request)
        if doc.reference_doctype != "CRM Lead" or doc.reference_docname != request.crm_lead:
            frappe.throw("Ghi chú chăm sóc không thuộc đúng khách hàng.")


def _care_query(doctype, user=None):
    leads = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
    names = ",".join(frappe.db.escape(name) for name in leads) or "NULL"
    return f"(COALESCE(`tab{doctype}`.`beautymatch_contact_request`, '')='' OR (`tab{doctype}`.`reference_doctype`='CRM Lead' AND `tab{doctype}`.`reference_docname` IN ({names})))"


def task_query(user=None):
    return _care_query("CRM Task", user)


def call_query(user=None):
    return _care_query("CRM Call Log", user)


def note_query(user=None):
    return _care_query("FCRM Note", user)


@frappe.whitelist(methods=["POST"])
def record_call(request_id, payload):
    doc = staff_request(request_id, lock=True)
    data = frappe.parse_json(payload) if isinstance(payload, str) else payload
    allowed = {"call_id", "outcome", "from_number", "start_time", "duration", "notes", "is_demo", "occurred"}
    if not isinstance(data, dict) or set(data) - allowed or intake._flag(data, "occurred") != 1:
        frappe.throw("Cần xác nhận đã thực hiện hoặc thử cuộc gọi.")
    key = _uuid(data.get("call_id"))
    fingerprint = intake._payload_hash(data)
    intake._acquire_lock("care-call", key)
    existing = frappe.db.get_value("CRM Call Log", {"beautymatch_call_key": key}, "name", for_update=True)
    if existing:
        if frappe.db.get_value("CRM Call Log", existing, "beautymatch_contact_request") != doc.name:
            portal._deny()
        if frappe.db.get_value("CRM Call Log", existing, "beautymatch_call_hash") != fingerprint:
            raise intake.RequestConflictError("Mã cuộc gọi đã được dùng cho nội dung khác.")
        return {"call_id": existing, "created": False}
    if not doc.task or doc.status in {"Completed", "Do Not Contact", "Canceled"} or doc.channel != "Phone":
        frappe.throw("Yêu cầu không còn cho phép ghi cuộc gọi hoặc khách đã chọn email.")
    task = frappe.get_doc("CRM Task", doc.task)
    task.check_permission("write")
    if task.status in {"Canceled", "Done"}:
        frappe.throw("Công việc đã đóng hoặc hủy. Không ghi thêm cuộc gọi cho công việc này.")
    outcome = data.get("outcome")
    if outcome not in OUTCOMES:
        frappe.throw("Kết quả chăm sóc không hợp lệ.")
    number = intake._normalize_phone(intake._text(data, "from_number", required=True))
    notes = intake._text(data, "notes", required=True, max_length=2000)
    try:
        started = datetime.fromisoformat(data["start_time"].replace("Z", "+00:00"))
        if started.tzinfo:
            zone = ZoneInfo(frappe.db.get_single_value("System Settings", "time_zone") or "UTC")
            started = started.astimezone(zone).replace(tzinfo=None)
        duration = float(data.get("duration") or 0)
        if not 0 <= duration <= 86400 or started > now_datetime() + timedelta(minutes=5):
            raise ValueError()
    except (ValueError, TypeError, KeyError, AttributeError):
        frappe.throw("Thời điểm hoặc thời lượng cuộc gọi không hợp lệ.")
    demo = intake._flag(data, "is_demo")
    note = frappe.get_doc({"doctype": "FCRM Note", "title": ("[DEMO] " if demo else "") + "BeautyMatch · Ghi nhận cuộc gọi",
        "content": "<p>" + escape(notes) + "</p>", "reference_doctype": "CRM Lead", "reference_docname": doc.crm_lead, "beautymatch_contact_request": doc.name}).insert()
    call = frappe.get_doc({"doctype": "CRM Call Log", "id": key, "from": number, "to": doc.contact_value,
        "type": "Outgoing", "telephony_medium": "Manual", "medium": "BeautyMatch DEMO" if demo else "BeautyMatch manual",
        "status": OUTCOMES[outcome], "start_time": started, "duration": duration,
        "end_time": started + timedelta(seconds=duration) if duration else None,
        "caller": frappe.session.user, "reference_doctype": "CRM Lead", "reference_docname": doc.crm_lead,
        "note": note.name, "beautymatch_contact_request": doc.name, "beautymatch_outcome": outcome,
        "beautymatch_is_demo": demo, "beautymatch_call_key": key, "beautymatch_call_hash": fingerprint,
        "links": [{"link_doctype": "CRM Task", "link_name": str(task.name)}]}).insert()
    # A call is evidence, never automatic task completion. Opt-out is binding.
    if outcome == "No Longer Interested":
        task.status = "Canceled"
        task.save()
        frappe.db.set_value(CONTACT, doc.name, "status", "Do Not Contact")
    else:
        frappe.db.set_value(CONTACT, doc.name, "status", "In Progress")
    return {"call_id": call.name, "created": True}


@frappe.whitelist(methods=["POST"])
def update_task(request_id, action, due_date=None):
    doc = staff_request(request_id, lock=True)
    if not doc.task or doc.status in {"Do Not Contact", "Canceled"}:
        frappe.throw("Không thể tiếp tục liên hệ yêu cầu này.")
    task = frappe.get_doc("CRM Task", doc.task)
    task.check_permission("write")
    if task.status == "Canceled":
        frappe.throw("Công việc đã hủy; không mở lại từ thay đổi sở thích hoặc lịch gọi lại.")
    if action == "complete":
        calls = frappe.get_all("CRM Call Log", filters={"beautymatch_contact_request": doc.name, "beautymatch_outcome": "Consulted"}, pluck="name", limit_page_length=1)
        if doc.channel == "Phone" and not calls:
            frappe.throw("Chỉ hoàn thành sau khi có cuộc gọi tư vấn thành công.")
        if doc.channel == "Email":
            frappe.throw("Cập nhật email qua CRM Task gốc sau khi thực sự liên hệ; không giả lập Call Log.")
        task.status = "Done"
        status = "Completed"
    elif action == "callback":
        from frappe.utils import get_datetime
        try:
            due = get_datetime(due_date)
            if due.tzinfo:
                due = due.astimezone(ZoneInfo(frappe.db.get_single_value("System Settings", "time_zone") or "UTC")).replace(tzinfo=None)
            if due <= now_datetime():
                raise ValueError()
        except (TypeError, ValueError):
            frappe.throw("Chọn thời hạn liên hệ lại trong tương lai.")
        task.due_date = due
        task.status = "In Progress"
        status = "In Progress"
    else:
        frappe.throw("Thao tác công việc không hợp lệ.")
    task.save()
    frappe.db.set_value(CONTACT, doc.name, "status", status)
    return _staff_view(frappe.get_doc(CONTACT, doc.name))


@frappe.whitelist(methods=["POST"])
def care_metrics():
    intake._check_consultation_role()
    leads = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
    requests = frappe.get_all(CONTACT, filters={"crm_lead": ["in", leads]}, fields=["name", "status", "task"], limit_page_length=0) if leads else []
    tasks = [row.task for row in requests if row.task]
    task_rows = frappe.get_all("CRM Task", filters={"name": ["in", tasks]}, fields=["status"], limit_page_length=0) if tasks else []
    calls = frappe.get_all("CRM Call Log", filters={"beautymatch_contact_request": ["in", [row.name for row in requests]]}, fields=["beautymatch_contact_request", "beautymatch_outcome", "beautymatch_is_demo"], order_by="creation desc, name desc", limit_page_length=0) if requests else []
    latest = {}
    for call in calls:
        latest.setdefault(call.beautymatch_contact_request, call.beautymatch_outcome)
    again = {frappe.db.get_value(CONTACT, row.name, "crm_lead") for row in requests if row.status not in {"Completed", "Do Not Contact", "Canceled"} and latest.get(row.name) in {"Call Back", "No Answer"}}
    return {"contact_requests": len(requests), "pending_requests": sum(row.status in {"Pending Assignment", "Open"} for row in requests),
        "open_tasks": sum(row.status in {"Backlog", "Todo", "In Progress"} for row in task_rows), "completed_tasks": sum(row.status == "Done" for row in task_rows),
        "calls": len(calls), "demo_calls": sum(bool(row.beautymatch_is_demo) for row in calls),
        "callback_customers": len(again)}
