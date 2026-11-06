"""Guarded local diagnostics/regressions for CRM ownership and portal delivery."""
import json
from uuid import uuid4, UUID

import frappe
from beautymatch.scripts.seed_demo import _guard, USERS


def prepare_delivery_failure(request_id):
    """Insert a clearly labeled conflicting QA bell row, not a fake API result."""
    _guard()
    from beautymatch.services.request_notifications import notification_name
    request_id = str(UUID(request_id))
    lead = frappe.db.get_value("BeautyMatch Customer Account", {"user": USERS["customer"][0]}, "crm_lead")
    name = notification_name(request_id)
    if frappe.db.exists("CRM Notification", name):
        frappe.throw("QA notification identity already exists.")
    frappe.get_doc({"doctype": "CRM Notification", "type": "Automation", "from_user": "Administrator", "to_user": USERS["staff"][0],
        "notification_text": "BeautyMatch QA delivery failure injection", "reference_doctype": "CRM Lead", "reference_name": lead,
        "notification_type_doctype": "CRM Lead", "notification_type_doc": lead,
    }).insert(ignore_permissions=True, set_name=name)
    return {"notification": name, "request_id": request_id}


def clear_delivery_failure(request_id):
    _guard()
    from beautymatch.services.request_notifications import notification_name
    doc = frappe.get_doc("CRM Notification", notification_name(str(UUID(request_id))))
    if doc.notification_text != "BeautyMatch QA delivery failure injection":
        frappe.throw("Refusing to delete a notification not owned by this QA fault.")
    doc.delete()
    return {"removed_owned_qa_fault": True}


def verify():
    _guard()
    from beautymatch.api import portal, feedback
    from beautymatch.scripts.seed_demo import demo_payload, repair_demo_assignments
    from beautymatch.services import request_notifications as notices
    from crm.api.notifications import mark_as_read
    actor = frappe.session.user
    kinds = ("User", "CRM Lead", "Beauty Profile", "BeautyMatch Customer Account", "BeautyMatch Customer Request", "Consultation Submission", "Recommendation Session", "CRM Task", "CRM Notification", "ToDo")
    counts = lambda: {kind: frappe.db.count(kind) for kind in kinds}
    before = counts(); checks = []
    def denied(fn, *args, **kwargs):
        try: fn(*args, **kwargs)
        except (frappe.PermissionError, frappe.ValidationError): return
        raise AssertionError("Expected permission rejection")
    try:
        assert not repair_demo_assignments()["changed"]
        assert not repair_demo_assignments()["changed"]
        assert "System Manager" not in frappe.get_roles(USERS["staff"][0])
        target = frappe.get_doc("CRM Lead", "CRM-LEAD-2026-00038")
        assert target.lead_owner == USERS["staff"][0]
        outsider = frappe.get_doc({"doctype":"CRM Lead", "first_name":"BeautyMatch Notification Boundary QA", "email":f"bm-notice-boundary-{uuid4().hex}@example.invalid", "lead_owner":USERS["manager"][0], "status":"New"}).insert()
        frappe.set_user(USERS["staff"][0])
        target.check_permission("read"); target.check_permission("write")
        assert target.name in frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
        denied(outsider.check_permission,"read")
        assert outsider.name not in frappe.get_list("CRM Lead",pluck="name",limit_page_length=0)
        checks.append("Sales User Demo reads/writes assigned QA Lead 00038 and is denied an outside-scope Lead; repair is idempotent and grants no admin role")
        frappe.set_user(USERS["customer"][0])
        payload={**demo_payload("A"),"request_id":str(uuid4())}
        a=portal.submit_profile(payload)
        assert frappe.db.get_value(notices.REQUEST,a["request_id"],"notification_status")=="Pending"
        assert not frappe.db.exists("CRM Notification",notices.notification_name(a["request_id"]))
        notices.deliver(a["request_id"])
        notices.deliver(a["request_id"])
        assert portal.submit_profile(payload)["request_id"]==a["request_id"]
        notification=frappe.get_doc("CRM Notification",notices.notification_name(a["request_id"]))
        assert notification.to_user==USERS["staff"][0] and not notification.read
        assert notification.notification_type_doc==a["request_id"]
        assert frappe.db.count("CRM Notification",{"notification_type_doctype":notices.REQUEST,"notification_type_doc":a["request_id"]})==1
        assert "325000" not in notification.notification_text and "COMBINATION" not in notification.notification_text
        checks.append("Notification stays in transactional outbox before commit; real delivery/retry creates exactly one native CRM Notification to the authorized Lead owner without skin details")
        frappe.set_user(USERS["staff"][0])
        own=next(row for row in notices.get_notifications() if row["notification_type_doc"]==a["request_id"])
        assert own["route_name"]=="BeautyMatchRequest" and own["reference_name"]==a["request_id"]
        mark_as_read(a["request_id"])
        assert frappe.db.get_value("CRM Notification",notification.name,"read")==1
        frappe.set_user(USERS["manager"][0])
        assert a["request_id"] not in [row["notification_type_doc"] for row in notices.get_notifications()]
        frappe.set_user("Administrator")
        assert a["request_id"] not in [row["notification_type_doc"] for row in notices.get_notifications()]
        frappe.set_user(USERS["customer"][0])
        denied(portal.get_request,a["request_id"])
        assert a["request_id"] not in [row["notification_type_doc"] for row in notices.get_notifications()]
        checks.append("Native read/unread and exact-request route work; unrelated Manager, Administrator and Customer receive no copy")
        bdata={**payload,"request_id":str(uuid4()),"max_budget":325002}
        b=portal.submit_profile(bdata)
        notices.deliver(a["request_id"]); notices.deliver(b["request_id"])
        assert frappe.db.get_value(notices.REQUEST,a["request_id"],"status")=="Superseded"
        assert frappe.db.get_value("CRM Notification",notification.name,"read")==1
        frappe.set_user(USERS["staff"][0])
        accepted=portal.accept_request(b["request_id"])
        assert accepted["snapshot"]["max_budget"]==325002
        generated=portal.generate_for_request(b["request_id"],{**bdata,"request_id":str(uuid4())})["result"]
        assert len(generated["results"])==3
        item=generated["results"][0]["item_id"]
        task=feedback.submit_feedback(generated["session_id"],item,"Interested")
        assert task["follow_up_status"]=="CREATED"
        assert feedback.submit_feedback(generated["session_id"],item,"Interested")["follow_up_task"]==task["follow_up_task"]
        doc=frappe.get_doc("CRM Task",task["follow_up_task"])
        assert doc.assigned_to==USERS["staff"][0] and doc.reference_docname==accepted["crm_lead"]
        assert doc.beautymatch_session==generated["session_id"] and doc.beautymatch_item==item
        checks.append("Superseded notification is read and retained; Sales User accepts the replacement snapshot, generates real Top 3 and creates/reuses one correctly linked CRM Task")
        # Exercise first-ever portal intake, not just an already seeded Lead.
        frappe.set_user("Administrator")
        email=f"bm-portal-notice-{uuid4().hex}@example.invalid"
        user=frappe.get_doc({"doctype":"User","email":email,"first_name":"BeautyMatch Portal Notification QA","enabled":1,"user_type":"Website User","send_welcome_email":0,"roles":[{"role":"BeautyMatch Customer"}]}).insert()
        frappe.set_user(user.name)
        fresh=portal.submit_profile({**payload,"email":email,"full_name":"BeautyMatch Portal Notification QA","request_id":str(uuid4())})
        req=frappe.get_doc(notices.REQUEST,fresh["request_id"])
        fresh_lead=frappe.get_doc("CRM Lead",req.crm_lead)
        assert fresh_lead.lead_owner==USERS["staff"][0]
        notices.deliver(req.name)
        frappe.set_user(USERS["staff"][0])
        fresh_lead.check_permission("read");fresh_lead.check_permission("write")
        assert req.crm_lead in frappe.get_list("CRM Lead",pluck="name",limit_page_length=0)
        portal.accept_request(req.name)
        assert frappe.db.get_value("CRM Notification",notices.notification_name(req.name),"to_user")==USERS["staff"][0]
        checks.append("A first-time Website User portal submission creates a genuinely assigned Lead, visible/readable/writable/acceptable by Sales User Demo, with one targeted notification")
    finally:
        frappe.db.rollback();frappe.set_user(actor)
    assert counts()==before
    return {"passed":checks,"test_writes_rolled_back":True,"record_counts_unchanged":True}


def inspect():
    _guard()
    actor = frappe.session.user
    target = "CRM-LEAD-2026-00038"
    doc = frappe.get_doc("CRM Lead", target) if frappe.db.exists("CRM Lead", target) else None
    lead = None
    if doc:
        lead = {key: doc.get(key) for key in ("name", "first_name", "email", "lead_owner", "owner", "_assign", "creation")}
        lead["shares"] = frappe.get_all("DocShare", filters={"share_doctype": "CRM Lead", "share_name": target}, fields=["user", "read", "write", "share"])
        lead["tasks"] = frappe.get_all("ToDo", filters={"reference_type": "CRM Lead", "reference_name": target}, fields=["allocated_to", "status"])
    try:
        frappe.set_user(USERS["staff"][0])
        permissions = {kind: frappe.has_permission("CRM Lead", kind, doc=doc) for kind in ("read", "write")} if doc else {}
        listed = target in frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
    finally:
        frappe.set_user(actor)
    return {
        "site": frappe.local.site, "lead": lead, "sales_user_permissions": permissions, "listed_for_sales_user": listed,
        "username_login": frappe.db.get_single_value("System Settings", "allow_login_using_user_name"),
        "customer_mapping": frappe.get_all("BeautyMatch Customer Account", fields=["user", "crm_lead"]),
        "demo_users": [{"name": email, "full_name": frappe.db.get_value("User", email, "full_name"), "user_type": frappe.db.get_value("User", email, "user_type"), "enabled": frappe.db.get_value("User", email, "enabled"), "username": frappe.db.get_value("User", email, "username"), "roles": frappe.get_roles(email)} for email, *_ in USERS.values()],
        "notifications": {kind: frappe.db.count(kind) for kind in ("Notification Log", "CRM Notification")},
        "crm_notification_fields": [field.fieldname for field in frappe.get_meta("CRM Notification").fields],
    }
