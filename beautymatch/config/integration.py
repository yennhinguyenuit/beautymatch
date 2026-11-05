"""Install only BeautyMatch's own CRM Form Script, leaving team scripts intact."""

from pathlib import Path

import frappe
from beautymatch.config.crm_customization import install as install_crm_customization


def install():
	if not frappe.db.exists("DocType", "CRM Form Script"):
		return {"installed": False, "reason": "CRM Form Script not available"}
	customization = install_crm_customization()
	name = "BeautyMatch Workspace"
	script = (Path(__file__).resolve().parents[1] / "public/js/crm_form_script.js").read_text(encoding="utf-8")
	exists = frappe.db.exists("CRM Form Script", name)
	if exists:
		doc = frappe.get_doc("CRM Form Script", name)
		if doc.dt != "CRM Lead" or doc.view != "Form":
			frappe.throw("BeautyMatch Workspace script name is already used by another integration.")
		if doc.script == script and doc.enabled:
			return {"installed": True, "changed": customization["changed"], "customization": customization}
	else:
		doc = frappe.get_doc({"doctype": "CRM Form Script", "name": name, "dt": "CRM Lead", "view": "Form", "is_standard": 0})
	doc.script = script
	doc.enabled = 1
	if exists:
		doc.save(ignore_permissions=True)
	else:
		doc.insert(ignore_permissions=True)
	return {"installed": True, "changed": True, "customization": customization}
