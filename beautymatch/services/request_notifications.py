"""Native CRM request notifications, delivered only after intake commits.

CRM 1.86 reads CRM Notification, not Notification Log. Keep an outbox on the
request and a deterministic notification name: retry never duplicates a bell
entry. Delivery failures cannot roll back an already committed consultation.
"""
from html import escape

import frappe

REQUEST = "BeautyMatch Customer Request"


def notification_name(request_id):
    return "bm-request-" + request_id


def eligible(user, lead):
    return bool(user and frappe.db.get_value("User", user, "enabled")
        and frappe.db.get_value("User", user, "user_type") == "System User"
        and set(frappe.get_roles(user)).intersection({"Sales User", "Sales Manager", "System Manager"})
        and all(frappe.has_permission("CRM Lead", kind, doc=lead, user=user) for kind in ("read", "write")))


def recipient_for(lead_name):
    # Fresh document: never inherit ignore_permissions from a portal service write.
    lead = frappe.get_doc("CRM Lead", lead_name)
    candidates = [lead.lead_owner]
    candidates += frappe.get_all("ToDo", filters={"reference_type": "CRM Lead", "reference_name": lead.name, "status": "Open"}, order_by="creation asc", pluck="allocated_to")
    candidates.append(frappe.db.get_single_value("BeautyMatch Settings", "default_follow_up_assignee"))
    return next((user for user in candidates if eligible(user, lead)), None)


def schedule(request_id):
    """Register a best-effort callback; never commit the intake transaction here."""
    batch = getattr(frappe.local, "beautymatch_notification_batch", None)
    if batch is None:
        batch = []
        frappe.local.beautymatch_notification_batch = batch
        def clear():
            frappe.local.beautymatch_notification_batch = None
        def flush():
            targets = frappe.local.beautymatch_notification_batch or []
            clear()
            # A delivery rollback must not discard reconciliation callbacks
            # for older requests from the same successfully committed intake.
            for target in targets:
                _deliver_committed(target)
        frappe.db.after_commit.add(flush)
        frappe.db.after_rollback.add(clear)
    if request_id not in batch:
        batch.append(request_id)


def stage(request):
    schedule(request.name)


def deliver(request_id):
    """One transactional delivery/reconciliation; callers decide when to commit."""
    request = frappe.get_doc(REQUEST, request_id, for_update=True)
    name = notification_name(request.name)
    existing = frappe.db.get_value("CRM Notification", name, ["name", "to_user", "notification_type_doc"], as_dict=True)
    if request.status != "Pending":
        if existing:
            if existing.notification_type_doc != request.name:
                raise frappe.ValidationError("Notification identity conflict")
            text = "Yêu cầu BeautyMatch đã có yêu cầu mới hơn." if request.status == "Superseded" else "Yêu cầu BeautyMatch đã được tiếp nhận."
            frappe.db.set_value("CRM Notification", name, {"read": 1, "notification_text": text}, update_modified=False)
            frappe.publish_realtime("crm_notification", user=existing.to_user, after_commit=True)
        frappe.db.set_value(REQUEST, request.name, {"notification_status": "Sent" if existing else "Skipped", "notification_error": ""}, update_modified=False)
        return
    recipient = request.notification_recipient or recipient_for(request.crm_lead)
    lead = frappe.get_doc("CRM Lead", request.crm_lead)
    if not eligible(recipient, lead):
        frappe.db.set_value(REQUEST, request.name, "notification_status", "Skipped", update_modified=False)
        return
    if existing and (existing.to_user != recipient or existing.notification_type_doc != request.name):
        raise frappe.ValidationError("Notification identity conflict")
    if not existing:
        import json
        snapshot = json.loads(request.payload_json)
        text = f"BeautyMatch · Yêu cầu tư vấn mới từ {escape(str(snapshot['full_name'])[:140])} · {request.name[:8]}"
        frappe.get_doc({
            "doctype": "CRM Notification", "type": "Automation", "from_user": request.customer,
            "to_user": recipient, "read": 0, "notification_text": text,
            "message": "Có yêu cầu tư vấn BeautyMatch mới. Mở yêu cầu để kiểm tra và tiếp nhận.",
            "reference_doctype": "CRM Lead", "reference_name": request.crm_lead,
            "notification_type_doctype": REQUEST, "notification_type_doc": request.name,
        }).insert(ignore_permissions=True, set_name=name)
    frappe.db.set_value(REQUEST, request.name, {"notification_status": "Sent", "notification_recipient": recipient, "notification_error": ""}, update_modified=False)
    frappe.publish_realtime("crm_notification", user=recipient, after_commit=True)


def _deliver_committed(request_id):
    # The intake has committed. This is a separate transaction, including error
    # recording. No exception may turn the successful intake response into an error.
    try:
        deliver(request_id)
        frappe.db.commit()
    except Exception as error:
        frappe.db.rollback()
        try:
            frappe.db.set_value(REQUEST, request_id, {"notification_status": "Failed", "notification_error": type(error).__name__[:140]}, update_modified=False)
            frappe.db.commit()
        except Exception:
            frappe.db.rollback()


def retry_pending():
    """Scheduler/bench job; queue remains usable even when delivery is unavailable."""
    for name in frappe.get_all(REQUEST, filters={"notification_status": ["in", ["Pending", "Failed"]]}, order_by="creation asc", limit_page_length=100, pluck="name"):
        _deliver_committed(name)


@frappe.whitelist()
def get_notifications():
    """Project only BeautyMatch routes; preserve native rows and read/unread API."""
    from crm.api.notifications import get_notifications as native_notifications
    result = []
    for row in native_notifications():
        if row["notification_type_doctype"] == "BeautyMatch Contact Request":
            name = row["notification_type_doc"]
            if not frappe.db.exists("BeautyMatch Contact Request", name):
                continue
            request = frappe.get_doc("BeautyMatch Contact Request", name)
            lead = frappe.get_doc("CRM Lead", request.crm_lead)
            if not eligible(frappe.session.user, lead):
                continue
            result.append({**row, "route_name": "BeautyMatchContact", "reference_name": name, "hash": ""})
            continue
        if row["notification_type_doctype"] == REQUEST:
            if not frappe.db.exists(REQUEST, row["notification_type_doc"]):
                continue
            request = frappe.get_doc(REQUEST, row["notification_type_doc"])
            if not frappe.db.exists("CRM Lead", request.crm_lead):
                continue
            lead = frappe.get_doc("CRM Lead", request.crm_lead)
            if not eligible(frappe.session.user, lead):
                continue
            row = {**row, "route_name": "BeautyMatchRequest", "reference_name": request.name, "hash": ""}
        result.append(row)
    return result
