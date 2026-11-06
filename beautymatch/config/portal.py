import frappe


def install():
    if not frappe.db.exists("Role", "BeautyMatch Customer"):
        frappe.get_doc({"doctype": "Role", "role_name": "BeautyMatch Customer", "desk_access": 0}).insert(ignore_permissions=True)
