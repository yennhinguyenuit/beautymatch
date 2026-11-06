"""Real local integration assertions. All test writes roll back."""
import json
from collections import Counter
from uuid import uuid4

import frappe

from beautymatch.api import portal, profile, frontend, recommendation, feedback, dashboard
from beautymatch.scripts.seed_demo import _guard, USERS, LOCAL, demo_payload


def verify():
    _guard()
    actor = frappe.session.user
    counts = lambda: {dt: frappe.db.count(dt) for dt in ("CRM Lead", "Beauty Profile", "BeautyMatch Customer Account", "BeautyMatch Customer Request", "Consultation Submission", "Recommendation Session", "CRM Task")}
    before = counts()
    checks = []
    seeded = json.loads((LOCAL / "seminar-data.json").read_text())
    old = frappe.get_doc("Recommendation Session", seeded["customers"]["A"]["session_id"]).as_dict()
    def denied(fn, *args, **kwargs):
        try:
            fn(*args, **kwargs)
        except (frappe.PermissionError, frappe.ValidationError):
            return
        raise AssertionError("A protected operation was accepted")
    try:
        outsider = frappe.get_doc({"doctype": "CRM Lead", "first_name": "Seminar Access Boundary QA", "email": f"boundary-{uuid4().hex}@example.invalid", "status": "New", "lead_owner": USERS["manager"][0]}).insert()
        frappe.set_user(USERS["customer"][0])
        me = portal.get_my_profile()
        assert me["email"] == USERS["customer"][0]
        assert not set(frappe.get_roles()).intersection({"Sales User", "Sales Manager", "System Manager"})
        for dt in ("CRM Lead", "Beauty Profile", "Recommendation Session", "BeautyMatch Customer Account", "BeautyMatch Customer Request"):
            assert not frappe.has_permission(dt, "read")
        denied(frontend.get_workspace)
        denied(portal.list_requests)
        denied(dashboard.get_dashboard_data)
        data = demo_payload("A")
        data["request_id"] = str(uuid4())
        denied(portal.submit_profile, {**data, "email": demo_payload("B")["email"]})
        denied(portal.submit_profile, {**data, "crm_lead": seeded["customers"]["B"]["crm_lead"]})
        denied(portal.submit_profile, {**data, "consent": 0})
        denied(portal.submit_profile, {**data, "concern_barrier": 1})
        checks.append("Customer role has no CRM/private DocType access; staff APIs, forged identity/Lead, missing consent and >3 concerns are denied")
        request = portal.submit_profile(data)
        assert portal.submit_profile(data) == request
        denied(portal.submit_profile, {**data, "max_budget": 300000})
        assert frappe.db.count("CRM Lead", {"email": data["email"]}) == 1
        lead = seeded["customers"]["A"]["crm_lead"]
        assert frappe.db.count("Beauty Profile", {"crm_lead": lead}) == 1
        assert frappe.db.count("BeautyMatch Customer Account", {"user": USERS["customer"][0]}) == 1
        checks.append("Customer retries reuse one receipt, reject changed payload and preserve one Lead, one current profile and one account")
        frappe.set_user(USERS["staff"][0])
        assert outsider.name not in frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
        denied(profile._check_lead_access, outsider.name)
        checks.append("Sales User cannot list, read or write a Lead owned by another team member outside their assignment scope")
        assert any(row["name"] == request["request_id"] for row in portal.list_requests()["requests"])
        accepted = portal.accept_request(request["request_id"])
        assert accepted["crm_lead"] == lead
        data["request_id"] = str(uuid4())
        bound = portal.generate_for_request(request["request_id"], data)
        receipt = bound["receipt"]
        args = {field: receipt[field] for field in ("crm_lead", "beauty_profile", "profile_version", "request_id")}
        session = recommendation.generate_recommendations(**args)
        assert len(session["results"]) == 3
        assert recommendation.generate_recommendations(**args)["session_id"] == session["session_id"]
        assert portal.complete_request(request["request_id"], session["session_id"])["status"] == "Completed"
        checks.append("Staff queue -> accept -> TASK2 -> real matching Top 3 -> completed request; repeated generation reuses session")
        item = session["results"][0]["item_id"]
        created = feedback.submit_feedback(session["session_id"], item, "Interested")
        assert created["follow_up_status"] == "CREATED"
        task = frappe.get_doc("CRM Task", created["follow_up_task"])
        assert task.assigned_to == USERS["staff"][0] and task.reference_docname == lead
        assert task.beautymatch_session == session["session_id"] and task.beautymatch_item == item
        assert feedback.submit_feedback(session["session_id"], item, "Interested")["follow_up_task"] == task.name
        assert frappe.db.count("CRM Task", {"beautymatch_follow_up_key": f"{session['session_id']}:{item}"}) == 1
        denied(feedback.submit_feedback, session["session_id"], item, "Not Interested")
        feedback.submit_feedback(session["session_id"], item, "Not Interested", "Khác")
        assert frappe.db.get_value("CRM Task", task.name, "status") == "Canceled"
        assert feedback.submit_feedback(session["session_id"], item, "Interested")["follow_up_task"] == task.name
        assert frappe.db.get_value("CRM Task", task.name, "status") == "Todo"
        checks.append("Real CREATED Task is assigned and linked to Lead/session/item; retries, required reason, cancel and reopen preserve one Task")
        # Isolated PENDING branch with rollback; the demo configuration remains.
        frappe.db.set_single_value("BeautyMatch Settings", "default_follow_up_assignee", "")
        other_item = session["results"][1]["item_id"]
        assert feedback.submit_feedback(session["session_id"], other_item, "Interested")["follow_up_status"] == "PENDING"
        frappe.db.set_single_value("BeautyMatch Settings", "default_follow_up_assignee", USERS["staff"][0])
        due_days = frappe.db.get_single_value("BeautyMatch Settings", "default_follow_up_due_days")
        frappe.db.set_single_value("BeautyMatch Settings", "default_follow_up_due_days", 366)
        failed_item = session["results"][2]["item_id"]
        denied(feedback.submit_feedback, session["session_id"], failed_item, "Interested")
        assert not frappe.db.get_value("Recommendation Item", failed_item, "follow_up_task")
        assert frappe.db.get_value("Recommendation Item", failed_item, "customer_feedback") == "None"
        frappe.db.set_single_value("BeautyMatch Settings", "default_follow_up_due_days", due_days)
        checks.append("Actual invalid follow-up configuration rejects Task creation; no CREATED response, feedback mutation or Task is persisted")
        assert frappe.get_doc("Recommendation Session", old["name"]).as_dict() == old
        assert recommendation.get_customer_history(lead)["total"] >= 2
        assert not recommendation.get_recommendation_result(seeded["customers"]["C"]["session_id"])["results"]
        checks.append("Returning customer keeps earlier session byte-equivalent; empty catalog result and PENDING branch remain truthful")
        for who in ("staff", "manager"):
            frappe.set_user(USERS[who][0])
            allowed = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
            assert lead in allowed
            marks = ",".join(["%s"] * len(allowed))
            expected = frappe.db.sql(f"SELECT COUNT(*) FROM `tabRecommendation Session` WHERE crm_lead IN ({marks})", tuple(allowed))[0][0]
            report = dashboard.get_dashboard_data()
            assert report["kpis"]["total_sessions"] == expected
            interested = frappe.db.sql(f"SELECT COUNT(DISTINCT s.name) FROM `tabRecommendation Session` s JOIN `tabRecommendation Item` i ON i.parent=s.name WHERE s.crm_lead IN ({marks}) AND i.customer_feedback='Interested'", tuple(allowed))[0][0]
            assert report["kpis"]["interest_rate"] == round(100 * interested / expected, 2) if expected else report["kpis"]["interest_rate"] == 0
            avg = frappe.db.sql(f"SELECT AVG(i.final_match_score) FROM `tabRecommendation Item` i JOIN `tabRecommendation Session` s ON s.name=i.parent WHERE s.crm_lead IN ({marks}) AND i.rank=1", tuple(allowed))[0][0]
            assert report["kpis"]["average_top1_score"] == round(float(avg or 0), 2)
            profiles = frappe.db.sql(f"SELECT COUNT(DISTINCT crm_lead) FROM `tabBeauty Profile` WHERE crm_lead IN ({marks})", tuple(allowed))[0][0]
            assert report["kpis"]["leads_with_profile"] == profiles
            products = frappe.db.sql(f"SELECT i.product_name_snapshot,COUNT(*) FROM `tabRecommendation Item` i JOIN `tabRecommendation Session` s ON s.name=i.parent WHERE s.crm_lead IN ({marks}) AND i.customer_feedback='Interested' GROUP BY i.product_name_snapshot", tuple(allowed))
            actual = {row["product_name"]: row["count"] for row in report["charts"]["top_interested_products"]}
            assert actual == dict(Counter(dict(products)).most_common(10))
            snapshots = frappe.db.sql(f"SELECT profile_snapshot FROM `tabRecommendation Session` WHERE crm_lead IN ({marks})", tuple(allowed))
            expected_concerns = Counter()
            labels = ("Oil Control", "Acne", "Post-acne", "Dehydration", "Skin Barrier", "Dullness", "Anti-aging")
            for (raw,) in snapshots:
                snapshot = json.loads(raw)
                for field, label in zip(profile.CONCERN_FIELDS, labels):
                    if snapshot.get(field) in (True, 1, "1"):
                        expected_concerns[label] += 1
            assert {row["skin_concern"]: row["count"] for row in report["charts"]["top_skin_concerns"]} == dict(expected_concerns)
            assert all(row["crm_lead"] in allowed for row in portal.list_requests(status="Completed")["requests"])
            checks.append(f"{who}: dashboard four KPIs and both charts match independent SQL within permitted Lead scope; queue is scoped")
        frappe.set_user("Guest")
        denied(portal.get_my_profile)
        denied(portal.submit_profile, data)
        checks.append("Guest cannot use the customer intake API")
    finally:
        frappe.db.rollback()
        frappe.set_user(actor)
    assert counts() == before
    assert frappe.db.get_single_value("BeautyMatch Settings", "default_follow_up_assignee") == USERS["staff"][0]
    return {"passed": checks, "test_writes_rolled_back": True, "record_counts_unchanged": True}
