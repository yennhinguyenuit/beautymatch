"""BeautyMatch summary for a CRM Lead."""

import frappe

from beautymatch.api.profile import _check_consultation_role
from beautymatch.api.recommendation import (
    _check_lead_access,
    _serialize_session,
)


@frappe.whitelist(methods=["GET"])
def get_lead_summary(crm_lead):
    """Return BeautyMatch information for an authorized CRM Lead."""
    _check_consultation_role()
    _check_lead_access(crm_lead)

    profiles = frappe.get_all(
        "Beauty Profile",
        filters={"crm_lead": crm_lead},
        fields=["name", "status", "modified"],
        order_by="modified desc",
        limit_page_length=0,
    )

    sessions = frappe.get_all(
        "Recommendation Session",
        filters={"crm_lead": crm_lead},
        fields=["name", "creation"],
        order_by="creation desc",
        limit_page_length=0,
    )

    history = [
        _serialize_session(
            frappe.get_doc("Recommendation Session", row.name)
        )
        for row in sessions
    ]

    interested_products = []
    for session in history:
        for item in session.get("results", []):
            if item.get("customer_feedback") == "Interested":
                interested_products.append(item)

    return {
        "crm_lead": crm_lead,
        "beauty_profile": profiles[0].name if profiles else None,
        "beauty_profiles": profiles,
        "total_sessions": len(sessions),
        "history": history,
        "latest_interested_products": (
            [
                item for item in history[0].get("results", [])
                if item.get("customer_feedback") == "Interested"
            ]
            if history else []
        ),
        "interested_products": interested_products,
    }
