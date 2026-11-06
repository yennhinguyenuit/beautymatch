"""Local-only test-user lifecycle for real CRM sidebar acceptance tests.

Not whitelisted. Credentials are consumed in memory by the browser runner.
No email, business records, existing users or permissions are changed.
"""

import re
import secrets
from uuid import uuid4

import frappe
from frappe.utils.password import update_password


PREFIX = "beautymatch-sidebar-qa-"


def _local_only():
	if frappe.local.site != "crm.localhost" or frappe.session.user != "Administrator":
		frappe.throw("Sidebar audit user setup is limited to local Administrator.", frappe.PermissionError)


def prepare_sales_user():
	_local_only()
	user = f"{PREFIX}{uuid4().hex[:12]}@example.invalid"
	password = secrets.token_urlsafe(32)
	doc = frappe.get_doc({
		"doctype": "User", "email": user,
		"first_name": "BeautyMatch Sidebar QA", "last_name": "Sales",
		"enabled": 1, "user_type": "System User", "language": "en",
		"send_welcome_email": 0,
		"roles": [{"role": "Sales User"}],
	})
	doc.flags.no_welcome_mail = True
	doc.insert()
	update_password(user, password, logout_all_sessions=True)
	frappe.db.commit()
	return {"user": user, "password": password, "role": "Sales User"}


def disable_sales_user(user):
	_local_only()
	if not re.fullmatch(r"beautymatch-sidebar-qa-[a-f0-9]{12}@example\.invalid", str(user)):
		frappe.throw("Not a sidebar audit user.", frappe.ValidationError)
	doc = frappe.get_doc("User", user)
	if doc.first_name != "BeautyMatch Sidebar QA" or doc.last_name != "Sales":
		frappe.throw("Not an owned sidebar audit user.", frappe.ValidationError)
	doc.enabled = 0
	doc.save()
	frappe.db.commit()
	return {"disabled": True, "business_records_changed": 0}
