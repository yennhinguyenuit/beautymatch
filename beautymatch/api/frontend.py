"""TASK 5 workspace integration with the existing TASK 2 and TASK 4 APIs.

Identifiers travel in POST bodies. Existing APIs retain their authorization;
metrics and feedback semantics belong to TASK 4.
"""

import json
from urllib.parse import quote
from datetime import datetime
from zoneinfo import ZoneInfo

import frappe

from beautymatch.api import profile as intake
from beautymatch.api.lead_summary import get_lead_summary
from beautymatch.api.dashboard import get_dashboard_data as task4_dashboard_data
from beautymatch.api.profile import _check_consultation_role, _check_lead_access
from beautymatch.api.recommendation import (
	PROFILE_FIELDS,
	get_customer_history,
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


def _created_at(value):
	stamp = datetime.fromisoformat(str(value))
	if stamp.tzinfo is None:
		zone = frappe.db.get_single_value("System Settings", "time_zone") or "UTC"
		stamp = stamp.replace(tzinfo=ZoneInfo(zone))
	return stamp.isoformat()


def _lead_name(lead):
	return lead.get("lead_name") or " ".join(filter(None, (lead.get("first_name"), lead.get("last_name")))) or lead.name


@frappe.whitelist(methods=["GET"])
def get_result_context(session_id):
	"""Non-contact profile snapshot and optional current catalog ingredient text."""
	_check_consultation_role()
	if not isinstance(session_id, str) or not session_id.strip():
		frappe.throw("Thiếu session_id.", frappe.ValidationError)
	session = frappe.get_doc("Recommendation Session", session_id.strip())
	lead = _check_lead_access(session.crm_lead)
	profile = _snapshot(session.profile_snapshot)
	products = sorted({row.product for row in session.recommendation_items if row.product})
	assets = (
		frappe.get_all(
			"Product Profile",
			filters={"name": ["in", products]},
			fields=["name", "key_ingredients", "data_as_of"],
			limit_page_length=0,
		)
		if products else []
	)
	return {
		"profile": {field: profile.get(field) for field in PROFILE_FIELDS}, "products": assets,
		"customer": {"crm_lead": lead.name, "display_name": _lead_name(lead)},
		"created_at": _created_at(session.creation), "items": _item_context(session),
	}


def _item_context(session):
	items = []
	for row in session.recommendation_items:
		task = frappe.get_doc("CRM Task", row.follow_up_task) if row.follow_up_task and frappe.db.exists("CRM Task", row.follow_up_task) else None
		can_open = bool(task and frappe.has_permission("CRM Task", "read", doc=task))
		items.append({
			"item_id": row.name,
			"follow_up_status": ("CREATED" if task and task.status != "Canceled" else "PENDING") if row.customer_feedback == "Interested" else "NOT_APPLICABLE",
			"task": {"name": str(task.name), "status": task.status, "url": "/app/crm-task/" + quote(str(task.name), safe="")} if can_open else None,
		})
	return items


@frappe.whitelist(methods=["POST"])
def get_workspace(search="", start=0):
	"""Permission-filtered customer picker; never enumerate Leads with get_all."""
	_check_consultation_role()
	try:
		start = int(start)
	except (TypeError, ValueError):
		frappe.throw("Vị trí danh sách không hợp lệ.", frappe.ValidationError)
	if start < 0 or not isinstance(search, str) or len(search) > 140:
		frappe.throw("Tham số tìm kiếm không hợp lệ.", frappe.ValidationError)
	kwargs = {"fields": ["name", "first_name", "last_name", "status"], "order_by": "modified desc", "start": start, "page_length": 21}
	if search.strip():
		kwargs["or_filters"] = [[field, "like", f"%{search.strip()}%"] for field in ("name", "first_name", "last_name")]
	rows = frappe.get_list("CRM Lead", **kwargs)
	return {"leads": rows[:20], "has_more": len(rows) > 20, "start": start}


@frappe.whitelist(methods=["POST"])
def get_customer_context(crm_lead):
	_check_consultation_role()
	lead = _check_lead_access(crm_lead)
	profiles = frappe.get_all("Beauty Profile", filters={"crm_lead": lead.name}, fields=["name"], order_by="modified desc", limit_page_length=1)
	profile = frappe.get_doc("Beauty Profile", profiles[0].name) if profiles else None
	return {
		"crm_lead": lead.name,
		"full_name": _lead_name(lead),
		"email": lead.get("email") or "", "phone": lead.get("mobile_no") or lead.get("phone") or "",
		"profile": {key: profile.get(key) for key in PROFILE_FIELDS} if profile else {},
		"profile_version": str(profile.modified) if profile else None,
	}


@frappe.whitelist(methods=["POST"])
def save_consultation(payload, crm_lead=None):
	"""Bind explicitly selected Leads, then delegate all intake/idempotency to TASK 2.

	A contactless selected Lead needs its supplied contact bound before the existing
	contact-based resolver can reuse it. Any conflict aborts the same transaction.
	"""
	_check_consultation_role()
	if crm_lead:
		lead = _check_lead_access(crm_lead)
		data = intake._validate_payload(payload)
		intake._lock_submission(data)
		intake._check_lead_identity(lead, data)
		found = intake._find_existing_lead(data)
		if found and found != lead.name:
			frappe.throw("Thông tin liên hệ thuộc khách hàng khác. Vui lòng kiểm tra Lead đã chọn.", frappe.ValidationError)
		if not found:
			if data["email"] and not lead.get("email"):
				lead.email = data["email"]
			if data["phone"] and not lead.get("mobile_no") and not lead.get("phone"):
				lead.mobile_no = data["phone"]
			lead.save()
	result = intake.save_beauty_profile(payload)
	if crm_lead and result["crm_lead"] != crm_lead:
		frappe.throw("Không thể liên kết hồ sơ với Lead đã chọn.", frappe.ValidationError)
	return result


@frappe.whitelist(methods=["POST"])
def get_customer_view(crm_lead, start=0):
	"""Compose existing TASK 4 summary/history with authorized display metadata."""
	customer = get_customer_context(crm_lead)
	summary = get_lead_summary(crm_lead)
	history = get_customer_history(crm_lead, limit=10, start=start)
	for entry in history["sessions"]:
		doc = frappe.get_doc("Recommendation Session", entry["session_id"])
		entry["created_at"] = _created_at(doc.creation)
		entry["follow_ups"] = _item_context(doc)
	return {"customer": customer, "summary": summary, "history": history}


@frappe.whitelist(methods=["POST"])
def read(operation, parameters=None):
	"""Allowlisted reads only; never dispatch arbitrary methods or bypass Lead checks."""
	_check_consultation_role()
	if isinstance(parameters, str):
		parameters = frappe.parse_json(parameters)
	if not isinstance(parameters, dict):
		frappe.throw("Tham số đọc không hợp lệ.", frappe.ValidationError)
	operations = {
		"get_customer_history": (get_customer_history, {"crm_lead", "limit", "start"}),
		"get_recommendation_result": (get_recommendation_result, {"session_id"}),
		"get_result_context": (get_result_context, {"session_id"}),
		"get_lead_summary": (get_lead_summary, {"crm_lead"}),
	}
	if not isinstance(operation, str) or operation not in operations:
		frappe.throw("Thao tác đọc không được hỗ trợ.", frappe.ValidationError)
	method, keys = operations[operation]
	if set(parameters) - keys:
		frappe.throw("Tham số đọc không được hỗ trợ.", frappe.ValidationError)
	return method(**parameters)


@frappe.whitelist(methods=["GET"])
def get_dashboard_data():
	"""Compatibility alias: TASK 4 supplies all-time metrics without date filters."""
	return task4_dashboard_data()
