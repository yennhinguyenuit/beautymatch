"""Read-only navigation capability; business APIs retain their own permission checks."""

import frappe

from beautymatch.api.profile import _check_consultation_role


@frappe.whitelist(methods=["GET"])
def get_sidebar_entry():
	"""Return only a public route for authorized CRM consultation staff, never customer data."""
	try:
		_check_consultation_role()
	except frappe.PermissionError:
		return None
	if not frappe.has_permission("CRM Lead", "read"):
		return None
	return {"label": "BeautyMatch", "href": "/crm/beautymatch", "icon": "leaf"}
