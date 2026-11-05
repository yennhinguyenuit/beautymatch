"""Add BeautyMatch follow-up fields to CRM Task."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
    custom_fields = {
        "CRM Task": [
            {
                "fieldname": "beautymatch_session",
                "label": "BeautyMatch Session",
                "fieldtype": "Link",
                "options": "Recommendation Session",
                "insert_after": "reference_docname",
                "read_only": 1,
            },
            {
                "fieldname": "beautymatch_item",
                "label": "BeautyMatch Recommendation Item",
                "fieldtype": "Data",
                "insert_after": "beautymatch_session",
                "read_only": 1,
            },
            {
                "fieldname": "beautymatch_follow_up_key",
                "label": "BeautyMatch Follow-up Key",
                "fieldtype": "Data",
                "insert_after": "beautymatch_item",
                "unique": 1,
                "read_only": 1,
            },
        ]
    }

    create_custom_fields(custom_fields, update=True)

    frappe.clear_cache(doctype="CRM Task")
