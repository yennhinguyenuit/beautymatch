"""Install BeautyMatch's additive CRM metadata without changing CRM source.

Called by the app's install/migrate hook, not exposed as a browser API. The
installer never commits, replaces a native layout or edits an unrelated row.
"""

import json
from copy import deepcopy

import frappe


FIELD_NAME = "beautymatch_insights"
SECTION_NAME = "beautymatch_insights"
LOGO = "/assets/beautymatch/images/leaf.svg"
LOADING_HTML = '<div class="bm-crm-insights" role="status">Đang tải hồ sơ BeautyMatch…</div>'


def _merge_side_panel(sections):
	"""Keep native sections intact and add the owned HTML field exactly once."""
	if not isinstance(sections, list) or not sections or any(not isinstance(section, dict) for section in sections):
		raise ValueError("CRM Side Panel must contain an existing list of native sections.")
	merged = deepcopy(sections)
	for section in merged:
		for column in section.get("columns") or []:
			if FIELD_NAME in (column.get("fields") or []):
				return merged, False
	for section in merged:
		if section.get("name") == SECTION_NAME:
			columns = section.setdefault("columns", [])
			if columns:
				columns[0].setdefault("fields", []).append(FIELD_NAME)
			else:
				columns.append({"name": "beautymatch_insights_column", "fields": [FIELD_NAME]})
			return merged, True
	merged.insert(0, {
		"name": SECTION_NAME,
		"label": "BeautyMatch · Chăm sóc cá nhân hóa",
		"opened": True,
		"columns": [{"name": "beautymatch_insights_column", "fields": [FIELD_NAME]}],
	})
	return merged, True


def _merge_dropdown_items(items):
	"""Retire only our owned website entry after native sidebar deployment.

	The native UserDropdown opens routes with window.open even for target ''.
	The real RouterLink sidebar entry replaces it; admin-customized rows stay.
	"""
	merged = [deepcopy(item) for item in items if not _owned_website_entry(item)]
	return merged, len(merged) != len(items)


def _owned_website_entry(item):
	return (
		str(item.get("route") or "").rstrip("/") == "/beautymatch"
		and item.get("label") == "BeautyMatch"
		and item.get("icon") == "feather"
		and not item.get("is_standard")
	)


def _brand_changes(name, logo):
	"""Adopt BeautyMatch only when the existing identity is stock or already ours."""
	changes = {}
	current_name = str(name or "").strip()
	if current_name.casefold() in ("", "crm", "frappe crm"):
		changes["brand_name"] = "BeautyMatch CRM"
		effective_name = "beautymatch crm"
	else:
		effective_name = current_name.casefold()
	if not logo and effective_name in ("beautymatch", "beautymatch crm"):
		changes["brand_logo"] = LOGO
	return changes


def _supports(doctype, fields):
	if not frappe.db.exists("DocType", doctype):
		return False
	meta = frappe.get_meta(doctype)
	return all(meta.has_field(field) for field in fields)


def compatibility():
	"""Read-only capability checks for the installed CRM, without version guesses."""
	return {
		"lead": bool(frappe.db.exists("DocType", "CRM Lead")),
		"custom_field": _supports("Custom Field", ("dt", "fieldname", "fieldtype", "label", "options", "module")),
		"side_panel": _supports("CRM Fields Layout", ("dt", "type", "layout")),
		"navigation": _supports("FCRM Settings", ("dropdown_items",)) and _supports(
			"CRM Dropdown Item", ("type", "route", "label", "icon", "open_in_new_window", "hidden", "is_standard")
		),
		"branding": _supports("FCRM Settings", ("brand_name", "brand_logo")),
	}


def _install_field(capabilities):
	if not capabilities["lead"] or not capabilities["custom_field"]:
		return {"supported": False, "changed": False, "reason": "CRM Lead or Custom Field metadata is unavailable."}
	field = frappe.get_meta("CRM Lead").get_field(FIELD_NAME)
	if field:
		if field.fieldtype != "HTML":
			frappe.throw(
				"Cannot install BeautyMatch: CRM Lead.beautymatch_insights already exists with a field type other than HTML."
			)
		return {"supported": True, "changed": False}
	if not frappe.db.exists("Module Def", "BeautyMatch"):
		return {"supported": False, "changed": False, "reason": "BeautyMatch module metadata is unavailable."}
	frappe.get_doc({
		"doctype": "Custom Field",
		"dt": "CRM Lead",
		"fieldname": FIELD_NAME,
		"label": "BeautyMatch",
		"fieldtype": "HTML",
		"module": "BeautyMatch",
		"options": LOADING_HTML,
		"no_copy": 1,
		"print_hide": 1,
	}).insert(ignore_permissions=True)
	return {"supported": True, "changed": True}


def _install_side_panel(capabilities, field_available):
	if not capabilities["side_panel"] or not field_available:
		return {"supported": False, "changed": False, "reason": "CRM Side Panel or BeautyMatch HTML field is unavailable."}
	filters = {"dt": "CRM Lead", "type": "Side Panel"}
	if not frappe.db.exists("CRM Fields Layout", filters):
		return {"supported": False, "changed": False, "reason": "No CRM Lead Side Panel layout exists; native defaults were preserved."}
	doc = frappe.get_doc("CRM Fields Layout", filters)
	try:
		sections = json.loads(doc.layout or "[]")
		merged, changed = _merge_side_panel(sections)
	except (ValueError, TypeError, AttributeError):
		return {"supported": False, "changed": False, "reason": "CRM Lead Side Panel layout is empty or incompatible; native layout was preserved."}
	if changed:
		doc.layout = json.dumps(merged, ensure_ascii=False)
		doc.save(ignore_permissions=True)
	return {"supported": True, "changed": changed}


def _install_settings(capabilities):
	report = {
		"navigation": {"supported": capabilities["navigation"], "changed": False},
		"branding": {"supported": capabilities["branding"], "changed": False},
	}
	if not capabilities["navigation"] and not capabilities["branding"]:
		return report
	doc = frappe.get_single("FCRM Settings")
	if capabilities["navigation"]:
		items = [row.as_dict() for row in doc.get("dropdown_items") or []]
		merged, changed = _merge_dropdown_items(items)
		if changed:
			# Remove only this app's obsolete entry. Preserve all other child rows.
			for row in list(doc.get("dropdown_items") or []):
				if _owned_website_entry(row.as_dict()):
					doc.remove(row)
			report["navigation"]["changed"] = True
	if capabilities["branding"]:
		changes = _brand_changes(doc.get("brand_name"), doc.get("brand_logo"))
		for key, value in changes.items():
			doc.set(key, value)
		report["branding"]["changed"] = bool(changes)
	if any(feature["changed"] for feature in report.values()):
		doc.save(ignore_permissions=True)
	return report


def install():
	"""Apply supported additive metadata and return a report; transaction is caller-owned."""
	capabilities = compatibility()
	field = _install_field(capabilities)
	report = {
		"lead_field": field,
		"lead_sidebar": _install_side_panel(capabilities, field["supported"]),
		**_install_settings(capabilities),
	}
	return {
		"installed": any(feature["supported"] for feature in report.values()),
		"changed": any(feature["changed"] for feature in report.values()),
		"features": report,
		"compatibility": capabilities,
	}
