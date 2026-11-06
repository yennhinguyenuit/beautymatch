"""Local real-database regression, all test writes roll back."""
import json
from uuid import uuid4
import frappe
from frappe.utils import now_datetime
from beautymatch.scripts.seed_demo import _guard, USERS, demo_payload
from beautymatch.api import self_service as api, customer_care as care


def _dashboard_checks():
    from collections import Counter
    from beautymatch.api.dashboard import get_dashboard_data
    actor = frappe.session.user
    checked = []
    try:
        for role in ("staff", "manager"):
            frappe.set_user(USERS[role][0])
            leads = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
            slots = ",".join(["%s"] * len(leads)) or "NULL"
            sessions = frappe.db.sql(f"SELECT name, profile_snapshot FROM `tabRecommendation Session` WHERE crm_lead IN ({slots})", tuple(leads), as_dict=True)
            items = frappe.db.sql(f"SELECT i.* FROM `tabRecommendation Item` i JOIN `tabRecommendation Session` s ON s.name=i.parent WHERE s.crm_lead IN ({slots})", tuple(leads), as_dict=True)
            profiles = frappe.db.sql(f"SELECT COUNT(DISTINCT crm_lead) FROM `tabBeauty Profile` WHERE crm_lead IN ({slots})", tuple(leads))[0][0]
            data = get_dashboard_data()
            top = [float(i.final_match_score) for i in items if i.rank == 1 and i.final_match_score is not None]
            assert data['kpis'] == {"total_sessions":len(sessions), "leads_with_profile":profiles,
                "interest_rate":round(100 * len({i.parent for i in items if i.customer_feedback == 'Interested'}) / len(sessions),2) if sessions else 0.0,
                "average_top1_score":round(sum(top)/len(top),2) if top else 0.0}
            expected_products = Counter(i.product_name_snapshot for i in items if i.customer_feedback == 'Interested' and i.product_name_snapshot)
            assert {row['product_name']:row['count'] for row in data['charts']['top_interested_products']} == dict(expected_products.most_common(10))
            labels = {'concern_oil_control':'Oil Control','concern_acne':'Acne','concern_post_acne':'Post-acne','concern_dehydration':'Dehydration','concern_barrier':'Skin Barrier','concern_dullness':'Dullness','concern_aging':'Anti-aging'}
            expected_concerns = Counter()
            for row in sessions:
                snapshot = json.loads(row.profile_snapshot or '{}')
                expected_concerns.update(label for key,label in labels.items() if snapshot.get(key))
            assert {row['skin_concern']:row['count'] for row in data['charts']['top_skin_concerns']} == dict(expected_concerns.most_common(10))
            checked.append(f"{role}: all four original recommendation KPIs and both charts match independent SQL over the actual permitted Leads")
    finally:
        frappe.set_user(actor)
    return checked


def snapshot():
    _guard()
    foreign = frappe.db.sql("SELECT s.name FROM `tabRecommendation Session` s JOIN `tabCRM Lead` l ON l.name=s.crm_lead WHERE l.lead_owner='Administrator' ORDER BY s.creation DESC LIMIT 1")
    return {"site": frappe.local.site, "foreign_session": foreign[0][0] if foreign else None, "counts": {kind: frappe.db.count(kind) for kind in ("CRM Lead", "Beauty Profile", "Recommendation Session", "CRM Task", "CRM Call Log", "CRM Notification", care.CONTACT)}}


def verify():
    _guard()
    actor = frappe.session.user
    kinds = ["User", "CRM Lead", "Beauty Profile", "BeautyMatch Customer Account", "Consultation Submission", "Recommendation Session", "Recommendation Item", "CRM Task", "CRM Notification", "CRM Call Log", "ToDo", "FCRM Note", care.CONTACT]
    counts = lambda: {dt: frappe.db.count(dt) for dt in kinds}
    before = counts()
    checks = []
    def denied(fn, *args, **kwargs):
        try:
            fn(*args, **kwargs)
        except (frappe.PermissionError, frappe.ValidationError):
            return
        raise AssertionError("Expected rejection")
    try:
        frappe.set_user(USERS["customer"][0])
        payload = {**demo_payload("A"), "request_id": str(uuid4()), "phone": "0999990001"}
        a = api.recommend(payload)
        assert len(a["results"]) == 3
        assert counts()["CRM Task"] == before["CRM Task"]
        assert counts()["CRM Notification"] == before["CRM Notification"]
        assert api.recommend(payload)["session_id"] == a["session_id"]
        assert api.get_result(a["session_id"])["results"] == a["results"]
        checks.append("Customer receives actual saved Top 3 immediately; reload/retry retains one session and creates no Task/contact notification")
        item = a["results"][0]["item_id"]
        api.submit_feedback(a["session_id"], item, "Interested")
        assert counts()["CRM Task"] == before["CRM Task"]
        assert counts()["CRM Notification"] == before["CRM Notification"]
        assert frappe.db.get_value("Recommendation Item", item, "feedback_source") == "Customer"
        denied(api.submit_feedback, a["session_id"], "other-item", "Interested")
        denied(api.get_result, frappe.db.get_value("Recommendation Session", {"customer_user": ["is", "not set"]}, "name"))
        checks.append("Customer feedback is source-attributed and owned; Interested alone and invalid cross-item access create no work")
        consent = {"request_id": str(uuid4()), "item_ids": [item], "channel": "Phone", "contact_value": "0999990001", "contact_consent": 1, "customer_note": "DEMO: xin tu van", "preferred_time": "DEMO"}
        denied(care.request_contact, a["session_id"], {**consent, "contact_consent": 0})
        contact = care.request_contact(a["session_id"], consent)
        doc = frappe.get_doc(care.CONTACT, contact["request_id"])
        assert doc.task, doc.delivery_error
        assert contact["follow_up_status"] == "CREATED"
        assert care.request_contact(a["session_id"], consent)["request_id"] == doc.name
        assert care.request_contact(a["session_id"], {**consent, "request_id": str(uuid4())})["request_id"] == doc.name
        assert counts()["CRM Task"] == before["CRM Task"] + 1
        assert counts()["CRM Notification"] == before["CRM Notification"] + 1
        task = frappe.get_doc("CRM Task", doc.task)
        assert task.status == "Todo" and task.assigned_to == USERS["staff"][0]
        assert task.reference_docname == doc.crm_lead
        checks.append("Explicit consent creates one native assigned CRM Task and one reused native CRM notification; repeat request creates neither duplicate")
        frappe.set_user(USERS["staff"][0])
        detail = care.get_contact(doc.name)
        assert detail["task_status"] == "Todo"
        denied(care.update_task, doc.name, "complete")
        call = {"call_id": str(uuid4()), "outcome": "No Answer", "from_number": "0999990002", "start_time": str(now_datetime()), "notes": "DEMO - khach chua nghe may", "is_demo": 1, "occurred": 1}
        logged = care.record_call(doc.name, call)
        assert care.record_call(doc.name, call)["call_id"] == logged["call_id"]
        assert frappe.db.get_value("CRM Call Log", logged["call_id"], "reference_docname") == doc.crm_lead
        assert frappe.db.get_value("CRM Task", doc.task, "status") != "Done"
        denied(care.update_task, doc.name, "complete")
        care.record_call(doc.name, {**call, "call_id": str(uuid4()), "outcome": "Consulted"})
        assert frappe.db.get_value("CRM Task", doc.task, "status") != "Done"
        care.update_task(doc.name, "complete")
        assert frappe.db.get_value("CRM Task", doc.task, "status") == "Done"
        checks.append("Authorized Sales User creates linked native DEMO Call Logs idempotently; calls do not auto-complete Task; explicit completion needs successful consultation")
        metrics = care.care_metrics()
        assert metrics["calls"] >= 2 and metrics["completed_tasks"] >= 1
        frappe.set_user(USERS["customer"][0])
        denied(care.get_contact, doc.name)
        b = api.recommend({**payload, "request_id": str(uuid4()), "max_budget": 1})
        assert not b["results"] and frappe.db.exists("Recommendation Session", b["session_id"])
        assert api.get_result(a["session_id"])["results"][0]["final_match_score"] == a["results"][0]["final_match_score"]
        checks.append("Empty result is persisted; returning profile never overwrites old recommendation snapshot; staff metrics use real work/calls and customers cannot read internal care records")
        denied(api.recommend, {**payload, "request_id": str(uuid4()), "consent": 0})
        denied(api.recommend, {**payload, "request_id": str(uuid4()), "crm_lead": doc.crm_lead})
        denied(care.request_contact, a["session_id"], {**consent, "customer_note": "changed"})
        checks.append("Missing consent, caller-selected Lead and changed payload under a reused contact UUID are rejected")
        # First-ever website customer: no native assignment bell on intake.
        frappe.set_user("Administrator")
        fresh_email = f"bm-self-service-{uuid4().hex}@example.invalid"
        user = frappe.get_doc({"doctype":"User", "email":fresh_email, "first_name":"BeautyMatch Self Service QA", "enabled":1, "user_type":"Website User", "send_welcome_email":0, "roles":[{"role":"BeautyMatch Customer"}]}).insert()
        count_notices = frappe.db.count("CRM Notification")
        frappe.set_user(user.name)
        fresh = api.recommend({**demo_payload("A"), "full_name":user.full_name, "email":user.email, "phone":"0999990003", "request_id":str(uuid4())})
        assert len(fresh["results"]) == 3
        assert frappe.db.count("CRM Notification") == count_notices
        account_lead = frappe.db.get_value("BeautyMatch Customer Account", {"user":user.name}, "crm_lead")
        assert frappe.db.get_value("CRM Lead", account_lead, "lead_owner") == USERS["staff"][0]
        checks.append("First-time Website User gets a saved owner-linked Lead/profile/session without an unsolicited native Lead-assignment notification")
        fresh_item = fresh["results"][0]["item_id"]
        api.submit_feedback(fresh["session_id"], fresh_item, "Not Interested", "Đã từng sử dụng")
        assert frappe.db.count("CRM Notification") == count_notices
        api.submit_feedback(fresh["session_id"], fresh_item, "Interested")
        frappe.set_user("Administrator")
        frappe.db.set_single_value("BeautyMatch Settings", "default_follow_up_assignee", None)
        frappe.db.set_value("CRM Lead", account_lead, "lead_owner", None)
        frappe.set_user(user.name)
        pending_data = {"request_id":str(uuid4()), "item_ids":[fresh_item], "channel":"Phone", "contact_value":"0999990003", "contact_consent":1}
        pending = care.request_contact(fresh["session_id"], pending_data)
        assert pending["follow_up_status"] == "PENDING" and pending["status"] == "Pending Assignment"
        assert not frappe.db.get_value(care.CONTACT, pending["request_id"], "task")
        checks.append("Not Interested sends no contact notice; missing eligible assignee preserves contact consent as PENDING with no false CREATED")
        frappe.set_user("Administrator")
        frappe.db.set_value("CRM Lead", account_lead, "lead_owner", USERS["manager"][0])
        frappe.set_user(USERS["manager"][0])
        assigned = care.get_contact(pending["request_id"])
        assert assigned["task"] and assigned["assigned_to"] == USERS["manager"][0]
        manager_call = care.record_call(pending["request_id"], {**call, "call_id":str(uuid4()), "outcome":"Call Back"})
        frappe.set_user(USERS["staff"][0])
        denied(care.get_contact, pending["request_id"])
        denied(frappe.get_doc("CRM Task", assigned["task"]).check_permission, "read")
        denied(frappe.get_doc("CRM Call Log", manager_call["call_id"]).check_permission, "read")
        outside_note = frappe.db.get_value("CRM Call Log", manager_call["call_id"], "note")
        denied(frappe.get_doc("FCRM Note", outside_note).check_permission, "read")
        assert outside_note not in frappe.get_list("FCRM Note", pluck="name", limit_page_length=0)
        forged = frappe.get_doc("CRM Task", assigned["task"])
        forged.beautymatch_contact_request = None
        forged.reference_docname = doc.crm_lead
        denied(forged.check_permission, "write")
        assert manager_call["call_id"] not in frappe.get_list("CRM Call Log", pluck="name", limit_page_length=0)
        assert str(assigned["task"]) not in [str(n) for n in frappe.get_list("CRM Task", pluck="name", limit_page_length=0)]
        checks.append("Pending assignment recovers to the authorized new owner; unrelated Sales User is denied Contact, native Task, native Call Log and their list rows")
        frappe.set_user(USERS["manager"][0])
        stop_data = {**call,"call_id":str(uuid4()),"outcome":"No Longer Interested"}
        stopped = care.record_call(pending["request_id"], stop_data)
        assert care.record_call(pending["request_id"], stop_data)["call_id"] == stopped["call_id"]
        denied(care.record_call, pending["request_id"], {**stop_data,"call_id":str(uuid4())})
        assert frappe.db.get_value("CRM Task", assigned["task"], "status") == "Canceled"
        assert frappe.db.get_value(care.CONTACT, pending["request_id"], "status") == "Do Not Contact"
        checks.append("Customer opt-out cancels the linked Task, blocks further calls, and retry of the recorded opt-out call stays idempotent")
        # Staff consultation stays available but preference no longer implies consent.
        frappe.set_user(USERS["staff"][0])
        from beautymatch.api import recommendation, feedback
        from beautymatch.api.profile import save_beauty_profile
        receipt = save_beauty_profile({**demo_payload("A"),"request_id":str(uuid4())})
        staff_result = recommendation.generate_recommendations(**{key:receipt[key] for key in ("crm_lead","beauty_profile","request_id","profile_version")})
        before_task = frappe.db.count("CRM Task")
        recorded = feedback.submit_feedback(staff_result["session_id"],staff_result["results"][0]["item_id"],"Interested")
        assert recorded["feedback_source"] == "Staff" and recorded["follow_up_status"] == "NOT_REQUESTED"
        assert frappe.db.count("CRM Task") == before_task
        checks.append("Staff-led intake and real matching still work; staff-recorded feedback is labeled Staff and creates no Task without separate consent")
        allowed = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
        placeholders = ','.join(['%s'] * len(allowed))
        expected = frappe.db.sql(f"SELECT COUNT(*) FROM `tab{care.CONTACT}` WHERE crm_lead IN ({placeholders})", tuple(allowed))[0][0]
        expected_calls = frappe.db.sql(f"SELECT COUNT(*) FROM `tabCRM Call Log` l INNER JOIN `tab{care.CONTACT}` r ON l.beautymatch_contact_request=r.name WHERE r.crm_lead IN ({placeholders})", tuple(allowed))[0][0]
        expected_done = frappe.db.sql(f"SELECT COUNT(*) FROM `tabCRM Task` t INNER JOIN `tab{care.CONTACT}` r ON r.task=t.name WHERE r.crm_lead IN ({placeholders}) AND t.status='Done'", tuple(allowed))[0][0]
        actual = care.care_metrics()
        assert actual['contact_requests'] == expected and actual['calls'] == expected_calls and actual['completed_tasks'] == expected_done
        checks.append("Care request, call and completed-task dashboard counts match independent SQL within the actual Sales User Lead permission scope")
        # A real unique-key failure in native Task insertion, not a mocked API.
        failure_id = str(uuid4())
        frappe.set_user("Administrator")
        collision = frappe.get_doc({"doctype":"CRM Task", "title":"[DEMO QA] Contact delivery unique-key fault", "status":"Todo", "priority":"Low", "beautymatch_follow_up_key":"contact:" + failure_id}).insert()
        frappe.set_user(USERS["customer"][0])
        failed = care.request_contact(a["session_id"], {**consent,"request_id":failure_id,"customer_note":"DEMO delivery fault"})
        failed_doc = frappe.get_doc(care.CONTACT, failed["request_id"])
        assert failed["follow_up_status"] == "PENDING" and not failed_doc.task
        assert failed_doc.notification_status == "Failed" and failed_doc.delivery_error
        frappe.set_user("Administrator")
        collision.delete()
        frappe.set_user(USERS["staff"][0])
        recovered = care.get_contact(failed_doc.name)
        assert recovered["task"] and recovered["task_status"] == "Todo"
        assert frappe.db.count("CRM Notification", {"notification_type_doctype":care.CONTACT,"notification_type_doc":failed_doc.name}) == 1
        checks.append("A real native Task uniqueness failure preserves the contact request as PENDING/Failed without false CREATED; removing only the QA fault lets authorized retry deliver exactly one Task/notification")
        checks.extend(_dashboard_checks())
    finally:
        frappe.db.rollback()
        frappe.set_user(actor)
    assert counts() == before
    return {"passed": checks, "rolled_back": True, "counts_unchanged": True}
