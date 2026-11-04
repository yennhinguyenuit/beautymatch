"""Permission-scoped BeautyMatch dashboard metrics."""

from collections import Counter
from datetime import date, timedelta

import frappe
from frappe.utils import getdate

from beautymatch.api.profile import _check_consultation_role


def _invalid(message):
    frappe.throw(message, exc=frappe.ValidationError)


@frappe.whitelist(methods=["GET"])
def get_dashboard(start_date=None, end_date=None):
    """Four KPIs and two chart datasets for CRM Leads visible to the caller.

    Dates are inclusive. Interested rate uses only items with explicit feedback.
    """
    _check_consultation_role()

    today = getdate()
    try:
        start = getdate(start_date) if start_date else today - timedelta(days=29)
        end = getdate(end_date) if end_date else today
    except (ValueError, TypeError, OverflowError):
        _invalid("Ngày bắt đầu hoặc ngày kết thúc không hợp lệ.")
    if not isinstance(start, date) or not isinstance(end, date):
        _invalid("Ngày bắt đầu hoặc ngày kết thúc không hợp lệ.")
    if start > end:
        _invalid("Ngày bắt đầu không được sau ngày kết thúc.")
    if (end - start).days > 366:
        _invalid("Khoảng thời gian không được vượt quá 366 ngày.")

    # get_list applies CRM's permission_query_conditions for CRM Lead.
    # Query only session IDs linked to permitted Leads; never expose other Leads.
    allowed_leads = frappe.get_list("CRM Lead", pluck="name", limit_page_length=0)
    sessions = []
    if allowed_leads:
        sessions = frappe.get_all(
            "Recommendation Session",
            filters={
                "crm_lead": ["in", allowed_leads],
                "creation": ["between", [f"{start} 00:00:00", f"{end} 23:59:59.999999"]],
            },
            fields=["name", "creation", "number_of_recommendations"],
            limit_page_length=0,
        )

    session_names = [row.name for row in sessions]
    items = []
    if session_names:
        items = frappe.get_all(
            "Recommendation Item",
            filters={"parenttype": "Recommendation Session", "parent": ["in", session_names]},
            fields=["customer_feedback", "follow_up_task"],
            limit_page_length=0,
        )

    feedback_counts = Counter(row.customer_feedback for row in items)
    interested = feedback_counts["Interested"]
    not_interested = feedback_counts["Not Interested"]
    answered = interested + not_interested
    sessions_by_day = Counter(str(getdate(row.creation)) for row in sessions)
    days = (end - start).days + 1

    return {
        "start_date": str(start),
        "end_date": str(end),
        "kpis": {
            "total_sessions": len(sessions),
            "total_recommendations": len(items),
            "interested_rate": round(100 * interested / answered, 2) if answered else 0.0,
            "follow_up_tasks": len({str(row.follow_up_task) for row in items if row.follow_up_task}),
        },
        "charts": {
            "sessions_by_day": [
                {"date": str(start + timedelta(days=i)), "count": sessions_by_day[str(start + timedelta(days=i))]}
                for i in range(days)
            ],
            "feedback_distribution": [
                {"feedback": "Interested", "count": interested},
                {"feedback": "Not Interested", "count": not_interested},
                {"feedback": "No Feedback", "count": len(items) - answered},
            ],
        },
    }
