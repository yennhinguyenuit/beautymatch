"""Read-only frontend projections. Existing recommendation/feedback contracts stay intact."""

import json
from collections import Counter

import frappe

from beautymatch.api.dashboard import get_dashboard
from beautymatch.api.profile import CONCERN_FIELDS, _check_consultation_role, _check_lead_access
from beautymatch.api.recommendation import (
	PROFILE_FIELDS,
	get_consultation_history,
	get_recommendation_result,
)


def _snapshot(value):
	if isinstance(value, dict):
		return value
	try:
		parsed = json.loads(value or "{}")
		return parsed if isinstance(parsed, dict) else {}
	except (TypeError, ValueError):
		return {}


@frappe.whitelist(methods=["GET"])
def get_result_context(recommendation_session):
	"""Expose only non-contact snapshot fields and catalog assets for an authorized session."""
	_check_consultation_role()
	if not isinstance(recommendation_session, str) or not recommendation_session.strip():
		frappe.throw("Thiếu recommendation_session.", frappe.ValidationError)
	session = frappe.get_doc("Recommendation Session", recommendation_session.strip())
	_check_lead_access(session.crm_lead)
	profile = _snapshot(session.profile_snapshot)
	products = sorted({row.product for row in session.recommendation_items if row.product})
	assets = frappe.get_all(
		"Product Profile",
		filters={"name": ["in", products]},
		fields=["name", "image_url", "product_url", "key_ingredients", "data_as_of"],
		limit_page_length=0,
	) if products else []
	return {
		"profile": {field: profile.get(field) for field in PROFILE_FIELDS},
		"products": assets,
	}


@frappe.whitelist(methods=["POST"])
def read(operation, parameters=None):
	"""Allowlisted read-only RPC bridge: customer identifiers stay in POST bodies.

	Existing GET-only endpoints are invoked directly, retaining their authorization.
	No arbitrary method dispatch or permission bypass is permitted.
	"""
	_check_consultation_role()
	if isinstance(parameters, str):
		parameters = frappe.parse_json(parameters)
	if not isinstance(parameters, dict):
		frappe.throw("Tham số đọc không hợp lệ.", frappe.ValidationError)
	operations = {
		"get_customer_history": (get_consultation_history, {"crm_lead", "limit", "start"}),
		"get_recommendation_result": (get_recommendation_result, {"recommendation_session"}),
		"get_result_context": (get_result_context, {"recommendation_session"}),
	}
	if operation not in operations:
		frappe.throw("Thao tác đọc không được hỗ trợ.", frappe.ValidationError)
	method, keys = operations[operation]
	if set(parameters) - keys:
		frappe.throw("Tham số đọc không được hỗ trợ.", frappe.ValidationError)
	return method(**parameters)


@frappe.whitelist(methods=["GET"])
def get_dashboard_data(start_date=None, end_date=None):
	"""Extend get_dashboard with the requested metrics, using the same date/access scope.

	leads_with_profile: distinct visible Leads with an Active, consented profile
	and a consultation in the date range. Concerns count sessions, not unique Leads.
	Top products count Interested items; Top-1 averages only stored rank=1 scores.
	"""
	base = get_dashboard(start_date=start_date, end_date=end_date)
	allowed = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
	sessions = frappe.get_all(
		"Recommendation Session",
		filters={
			"crm_lead": ["in", allowed],
			"creation": ["between", [f"{base['start_date']} 00:00:00", f"{base['end_date']} 23:59:59.999999"]],
		},
		fields=["name", "crm_lead", "profile_snapshot"], limit_page_length=0,
	) if allowed else []
	names = [row.name for row in sessions]
	leads = sorted({row.crm_lead for row in sessions})
	profiles = frappe.get_all(
		"Beauty Profile", filters={"crm_lead": ["in", leads], "status": "Active", "consent": 1},
		fields=["crm_lead"], limit_page_length=0,
	) if leads else []
	items = frappe.get_all(
		"Recommendation Item",
		filters={"parenttype": "Recommendation Session", "parent": ["in", names]},
		fields=["rank", "final_match_score", "customer_feedback", "product", "product_name_snapshot"],
		limit_page_length=0,
	) if names else []
	concerns = Counter()
	for row in sessions:
		profile = _snapshot(row.profile_snapshot)
		concerns.update(field for field in CONCERN_FIELDS if profile.get(field) in (True, 1, "1"))
	scores = [float(row.final_match_score) for row in items if row.rank == 1 and row.final_match_score is not None]
	interested = Counter(row.product for row in items if row.customer_feedback == "Interested")
	labels = {row.product: row.product_name_snapshot for row in items}
	base["kpis"].update({
		"leads_with_profile": len({row.crm_lead for row in profiles}),
		"interest_rate": base["kpis"]["interested_rate"],
		"average_top1_score": round(sum(scores) / len(scores), 2) if scores else None,
	})
	base["charts"].update({
		"top_skin_concerns": [{"concern": key, "count": count} for key, count in concerns.most_common(7)],
		"top_interested_products": [
			{"product": key, "product_name": labels[key], "count": count}
			for key, count in interested.most_common(5)
		],
	})
	return base
