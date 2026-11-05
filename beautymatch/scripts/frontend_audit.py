"""Local integration diagnostics. No customer data is returned by inspect_runtime.

Run with bench --site crm.localhost execute beautymatch.scripts.frontend_audit.inspect_runtime.
"""

import csv
import inspect
from uuid import uuid4
from pathlib import Path

import frappe

from beautymatch.api import dashboard, feedback, lead_summary, profile, recommendation
from beautymatch.services.matching_engine import match_products


def inspect_runtime():
	products = frappe.get_all("Product Profile", filters={"status": "Active"}, fields=["*"], limit_page_length=0)
	settings = frappe.get_doc("BeautyMatch Settings")
	fixtures = Path(__file__).resolve().parents[2] / "tests" / "fixtures"
	with (fixtures / "customer_profiles_matching_only.csv").open(encoding="utf-8-sig") as source:
		profiles = list(csv.DictReader(source))
	positive = None
	for candidate in profiles:
		for product in products:
			candidate = {**candidate, "requested_category": product.category, "max_budget": 2000000}
			answer = match_products(candidate, products, settings)
			if answer["results"]:
				positive = {key: candidate.get(key, 0) for key in recommendation.PROFILE_FIELDS}
				break
		if positive:
			break
	functions = [profile.save_beauty_profile, recommendation.generate_recommendations,
		recommendation.get_recommendation_result, recommendation.get_customer_history,
		feedback.submit_feedback, dashboard.get_dashboard_data, lead_summary.get_lead_summary]
	return {
		"system_timezone": frappe.db.get_single_value("System Settings", "time_zone"),
		"server_now": str(frappe.utils.now_datetime()),
		"contracts": {fn.__name__: str(inspect.signature(fn)) for fn in functions},
		"active_products": len(products),
		"active_categories": sorted({row.category for row in products}),
		"positive_profile": positive,
		"follow_up_assignee_configured": bool(settings.default_follow_up_assignee),
		"schema_ready": {
			f"{doctype}.{field}": frappe.db.has_column(doctype, field)
			for doctype, field in [
				("Recommendation Item", "image_url_snapshot"),
				("Recommendation Item", "product_url_snapshot"),
				("CRM Task", "beautymatch_follow_up_key"),
				("CRM Task", "beautymatch_session"),
				("CRM Task", "beautymatch_item"),
			]
		},
	}


def verify_transactional_feedback():
	"""Exercise CREATED/idempotency/cancel/reopen/PENDING; always roll back test writes.

	Changes to follow-up settings exist only within this uncommitted transaction.
	No existing catalog, customer, or task is edited.
	"""
	from beautymatch.api import frontend

	user = frappe.session.user
	frappe.set_user("Administrator")
	doctypes = ["CRM Lead", "Beauty Profile", "Consultation Submission", "Recommendation Session", "CRM Task"]
	before = {doctype: frappe.db.count(doctype) for doctype in doctypes}
	checks = []
	try:
		runtime = inspect_runtime()
		assert runtime["positive_profile"], "No positive profile for the current active catalog."
		payload = {**runtime["positive_profile"], "full_name": "BeautyMatch Integration Rollback Test",
			"email": f"beautymatch-rollback-{uuid4().hex}@example.invalid", "consent": 1, "request_id": str(uuid4())}
		handoff = profile.save_beauty_profile(payload)
		args = {key: handoff[key] for key in ("crm_lead", "beauty_profile", "request_id", "profile_version")}
		session = recommendation.generate_recommendations(**args)
		assert session["results"]
		assert recommendation.generate_recommendations(**args)["session_id"] == session["session_id"]
		checks.append("generation retries reuse one persisted session")
		settings = frappe.get_doc("BeautyMatch Settings")
		settings.default_follow_up_assignee = "Administrator"
		settings.save()
		item_id = session["results"][0]["item_id"]
		created = feedback.submit_feedback(session["session_id"], item_id, "Interested")
		assert created["follow_up_status"] == "CREATED" and created["follow_up_task"]
		repeated = feedback.submit_feedback(session["session_id"], item_id, "Interested")
		assert repeated["follow_up_task"] == created["follow_up_task"]
		key = f"{session['session_id']}:{item_id}"
		assert frappe.db.count("CRM Task", {"beautymatch_follow_up_key": key}) == 1
		checks.append("CREATED is confirmed by a real CRM Task; repeated interest creates one task")
		try:
			feedback.submit_feedback(session["session_id"], item_id, "Not Interested")
		except frappe.ValidationError:
			checks.append("missing rejection reason is rejected by the actual backend")
		else:
			raise AssertionError("Backend accepted an invalid rejection")
		feedback.submit_feedback(session["session_id"], item_id, "Not Interested", "Khác")
		assert frappe.get_doc("CRM Task", created["follow_up_task"]).status == "Canceled"
		reopened = feedback.submit_feedback(session["session_id"], item_id, "Interested")
		assert reopened["follow_up_task"] == created["follow_up_task"]
		assert frappe.get_doc("CRM Task", created["follow_up_task"]).status == "Todo"
		checks.append("rejection cancels the task; renewed interest reopens the same task")
		settings.default_follow_up_assignee = ""
		settings.save()
		payload["request_id"] = str(uuid4())
		handoff = profile.save_beauty_profile(payload)
		session = recommendation.generate_recommendations(**{key: handoff[key] for key in args})
		pending = feedback.submit_feedback(session["session_id"], session["results"][0]["item_id"], "Interested")
		assert pending["follow_up_status"] == "PENDING" and not pending["follow_up_task"]
		checks.append("PENDING saves interest without claiming a task exists")
		view = frontend.get_customer_view(handoff["crm_lead"])
		assert view["summary"]["total_sessions"] >= 2
		assert view["history"]["sessions"][0]["created_at"]
		checks.append("Lead Summary and dated history include persisted sessions and follow-up metadata")
		lead_count = frappe.db.count("CRM Lead")
		payload["request_id"] = str(uuid4())
		selected = frontend.save_consultation(payload, handoff["crm_lead"])
		assert selected["crm_lead"] == handoff["crm_lead"] and frappe.db.count("CRM Lead") == lead_count
		checks.append("explicit Lead consultation reuses the existing customer without duplication")
		try:
			frontend.save_consultation({**payload, "email": f"conflict-{uuid4().hex}@example.invalid", "request_id": str(uuid4())},handoff["crm_lead"])
		except frappe.ValidationError:
			assert frappe.db.count("CRM Lead") == lead_count
			checks.append("selected Lead rejects a conflicting contact before creating a customer")
		else:
			raise AssertionError("Conflicting selected customer was accepted")
		contactless = frappe.get_doc({"doctype":"CRM Lead","first_name":"BeautyMatch Contactless Rollback","status":"New","lead_owner":"Administrator"}).insert()
		lead_count = frappe.db.count("CRM Lead")
		bound = frontend.save_consultation({**payload,"full_name":"BeautyMatch Contactless Rollback","email":f"contactless-{uuid4().hex}@example.invalid","request_id":str(uuid4())},contactless.name)
		assert bound["crm_lead"] == contactless.name and frappe.db.count("CRM Lead") == lead_count
		checks.append("a selected contactless Lead receives a contact and profile without a duplicate Lead")
		frappe.set_user("Guest")
		try:
			frontend.read("get_recommendation_result", {"session_id": session["session_id"]})
		except frappe.PermissionError:
			checks.append("anonymous access to private result bridge is denied")
		else:
			raise AssertionError("Guest was allowed to read a result")
	finally:
		frappe.set_user("Administrator")
		frappe.db.rollback()
		frappe.set_user(user)
	after = {doctype: frappe.db.count(doctype) for doctype in doctypes}
	assert after == before, "Rollback did not preserve record counts"
	return {"passed": checks, "all_test_writes_rolled_back": True, "record_counts_unchanged": True}
