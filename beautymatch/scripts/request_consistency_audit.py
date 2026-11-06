"""Local database regression tests; every write rolls back (no HTTP mocks)."""
import json
from uuid import uuid4

import frappe
from beautymatch.api import portal, frontend, recommendation, feedback
from beautymatch.scripts.seed_demo import _guard, USERS, demo_payload


def verify():
    _guard()
    actor = frappe.session.user
    kinds = ("CRM Lead", "Beauty Profile", "BeautyMatch Customer Request", "Consultation Submission", "Recommendation Session", "CRM Task")
    counts = lambda: {kind: frappe.db.count(kind) for kind in kinds}
    before = counts()
    checks = []

    def denied(fn, *args, **kwargs):
        try:
            fn(*args, **kwargs)
        except (frappe.PermissionError, frappe.ValidationError):
            return
        raise AssertionError("Expected a rejected operation")

    def submit(budget):
        frappe.set_user(USERS["customer"][0])
        data = {**demo_payload("A"), "max_budget": budget, "request_id": str(uuid4())}
        return portal.submit_profile(data), data

    try:
        a, data_a = submit(325000)
        frappe.set_user(USERS["staff"][0])
        accepted = portal.accept_request(a["request_id"])
        original = json.dumps(accepted["snapshot"], sort_keys=True)
        b, data_b = submit(324999)
        frappe.set_user(USERS["staff"][0])
        stale = portal.get_request(a["request_id"])
        assert stale["status"] == "Superseded" and stale["superseded_by"] == b["request_id"]
        assert json.dumps(stale["snapshot"], sort_keys=True) == original
        denied(portal.accept_request, a["request_id"])
        denied(portal.generate_for_request, a["request_id"], {**data_b, "request_id": str(uuid4())})
        checks.append("A accepted -> B submitted: A explicitly superseded, immutable A snapshot retained, generating A from B rejected")
        portal.accept_request(b["request_id"])
        frappe.set_user(USERS["manager"][0])
        denied(portal.accept_request, b["request_id"])
        denied(portal.generate_for_request, b["request_id"], {**data_b, "request_id": str(uuid4())})
        checks.append("A second staff member (including Manager) cannot take over or generate an already claimed request")
        frappe.set_user(USERS["staff"][0])
        payload = {**data_b, "full_name": "Nguyễn Minh Anh · QA chỉnh sửa", "max_budget": 325001, "request_id": str(uuid4())}
        generated = portal.generate_for_request(b["request_id"], payload)
        session = generated["result"]
        assert len(session["results"]) == 3 and session["max_budget"] == 325001
        saved = portal.get_request(session_id=session["session_id"])
        assert saved["status"] == "In Progress" and saved["session_id"] == session["session_id"]
        assert saved["snapshot"]["max_budget"] == 324999
        assert portal.generate_for_request(b["request_id"], payload)["result"]["session_id"] == session["session_id"]
        assert frappe.db.count("Recommendation Session", {"request_id": payload["request_id"]}) == 1
        denied(portal.generate_for_request, b["request_id"], {**payload, "max_budget": 400000})
        denied(portal.complete_request, a["request_id"], session["session_id"])
        checks.append("Staff edit creates a separate confirmed version/session; server recovery and idempotent retry retain one session and original customer snapshot")
        # Real permission failure after the session exists; no fake success API.
        frappe.set_user(USERS["manager"][0])
        denied(portal.complete_request, b["request_id"], session["session_id"])
        assert recommendation.get_recommendation_result(session["session_id"])["session_id"] == session["session_id"]
        frappe.set_user(USERS["staff"][0])
        assert portal.complete_request(b["request_id"], session["session_id"])["status"] == "Completed"
        assert portal.complete_request(b["request_id"], session["session_id"])["status"] == "Completed"
        checks.append("Completion denied after session save: saved result remains readable; correct owner retries completion twice without another session")
        doc = frappe.get_doc("BeautyMatch Customer Request", b["request_id"])
        doc.payload_json = "{}"
        denied(doc.save, ignore_permissions=True)
        checks.append("DocType validation rejects changing submitted snapshot")
        lead = saved["crm_lead"]
        feedback.submit_feedback(session["session_id"], session["results"][0]["item_id"], "Interested")
        # Put the known feedback session behind more than two unfiltered pages.
        for _ in range(21):
            receipt = frontend.save_consultation({**data_b, "request_id": str(uuid4())}, lead)
            recommendation.generate_recommendations(**{k: receipt[k] for k in ("crm_lead", "beauty_profile", "request_id", "profile_version")})
        all_history = frontend.get_customer_view(lead)
        assert session["session_id"] not in [row["session_id"] for row in all_history["history"]["sessions"]]
        actual_ids = {row[0] for row in frappe.db.sql("SELECT DISTINCT s.name FROM `tabRecommendation Session` s JOIN `tabRecommendation Item` i ON i.parent=s.name WHERE s.crm_lead=%s AND i.customer_feedback IN ('Interested','Not Interested')", (lead,))}
        found = []
        for offset in range(0, len(actual_ids), 10):
            page = frontend.get_customer_view(lead, start=offset, feedback_only=True)["history"]
            assert page["total"] == len(actual_ids)
            found.extend(row["session_id"] for row in page["sessions"])
        assert len(found) == len(set(found)) and set(found) == actual_ids and session["session_id"] in found
        checks.append("Feedback filter runs before pagination: old feedback beyond 21 newer sessions is found; total and every page match independent SQL")
        c, data_c = submit(325003)
        frappe.set_user(USERS["staff"][0])
        portal.accept_request(c["request_id"])
        denied(portal.generate_for_request, c["request_id"], payload)
        result_c = portal.generate_for_request(c["request_id"], {**data_c, "request_id": str(uuid4())})["result"]
        d, data_d = submit(325004)
        frappe.set_user(USERS["staff"][0])
        denied(portal.complete_request, c["request_id"], result_c["session_id"])
        assert recommendation.get_recommendation_result(result_c["session_id"])["session_id"] == result_c["session_id"]
        assert portal.get_request(c["request_id"])["status"] == "Superseded"
        portal.accept_request(d["request_id"])
        portal.generate_for_request(d["request_id"], {**data_d, "request_id": str(uuid4())})
        checks.append("A previously used consultation UUID cannot bind an old session to a new request; a superseded request retains its saved result but cannot complete, and the replacement generates normally")
        frappe.set_user(USERS["customer"][0])
        denied(portal.get_request, b["request_id"])
        denied(frontend.get_customer_view, lead)
        checks.append("Customer cannot read staff request snapshots or internal history")
    finally:
        frappe.db.rollback()
        frappe.set_user(actor)
    assert counts() == before
    return {"passed": checks, "test_writes_rolled_back": True, "record_counts_unchanged": True}
