"""Additive metadata for native CRM Task and Call Log, no core patch."""
import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def install():
    request = {"fieldname": "beautymatch_contact_request", "label": "BeautyMatch Contact Request", "fieldtype": "Link", "options": "BeautyMatch Contact Request", "read_only": 1}
    create_custom_fields({
        "CRM Task": [request],
        "FCRM Note": [request],
        "CRM Call Log": [request,
            {"fieldname": "beautymatch_outcome", "label": "Care Outcome", "fieldtype": "Select", "options": "\nConsulted\nNo Answer\nCall Back\nNo Longer Interested\nMore Information", "read_only": 1},
            {"fieldname": "beautymatch_is_demo", "label": "BeautyMatch DEMO call", "fieldtype": "Check", "read_only": 1},
            {"fieldname": "beautymatch_call_key", "label": "BeautyMatch Call ID", "fieldtype": "Data", "unique": 1, "read_only": 1},
            {"fieldname": "beautymatch_call_hash", "label": "BeautyMatch Call Payload Hash", "fieldtype": "Data", "read_only": 1},
        ],
    }, update=True)
    # Backfill only notes unambiguously attached to our existing call records.
    for call in frappe.get_all("CRM Call Log", filters={"beautymatch_contact_request": ["is", "set"], "note": ["is", "set"]}, fields=["note", "beautymatch_contact_request"]):
        lead = frappe.db.get_value("BeautyMatch Contact Request", call.beautymatch_contact_request, "crm_lead")
        note = frappe.db.get_value("FCRM Note", call.note, ["reference_doctype", "reference_docname", "beautymatch_contact_request"], as_dict=True)
        if note and lead and note.reference_doctype == "CRM Lead" and note.reference_docname == lead and not note.beautymatch_contact_request:
            frappe.db.set_value("FCRM Note", call.note, "beautymatch_contact_request", call.beautymatch_contact_request, update_modified=False)
