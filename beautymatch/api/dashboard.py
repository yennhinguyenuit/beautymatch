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


@frappe.whitelist(methods=["GET"])
def get_dashboard_data():
    """TASK 4 dashboard, scoped to CRM Leads visible to the caller."""
    import json

    _check_consultation_role()

    allowed_leads = frappe.get_list(
        "CRM Lead", pluck="name", limit_page_length=0
    )

    kpis = {
        "total_sessions": 0,
        "leads_with_profile": 0,
        "interest_rate": 0.0,
        "average_top1_score": 0.0,
    }
    charts = {
        "top_skin_concerns": [],
        "top_interested_products": [],
    }

    if not allowed_leads:
        return {"kpis": kpis, "charts": charts}

    kpis["leads_with_profile"] = len(set(frappe.get_all(
        "Beauty Profile",
        filters={"crm_lead": ["in", allowed_leads]},
        pluck="crm_lead",
        limit_page_length=0,
    )))

    sessions = frappe.get_all(
        "Recommendation Session",
        filters={"crm_lead": ["in", allowed_leads]},
        fields=["name", "profile_snapshot"],
        limit_page_length=0,
    )

    kpis["total_sessions"] = len(sessions)
    if not sessions:
        return {"kpis": kpis, "charts": charts}

    session_ids = [s.name for s in sessions]
    items = frappe.get_all(
        "Recommendation Item",
        filters={
            "parenttype": "Recommendation Session",
            "parent": ["in", session_ids],
        },
        fields=[
            "parent", "rank", "final_match_score",
            "customer_feedback", "product_name_snapshot",
        ],
        limit_page_length=0,
    )

    interested_sessions = {
        item.parent for item in items
        if item.customer_feedback == "Interested"
    }
    kpis["interest_rate"] = round(
        100 * len(interested_sessions) / len(sessions), 2
    )

    top1_scores = [
        float(item.final_match_score)
        for item in items
        if int(item.rank or 0) == 1
        and item.final_match_score is not None
    ]
    if top1_scores:
        kpis["average_top1_score"] = round(
            sum(top1_scores) / len(top1_scores), 2
        )

    concerns = Counter()
    for session in sessions:
        try:
            snapshot = json.loads(session.profile_snapshot or "{}")
        except (ValueError, TypeError):
            continue
        concern_labels = {
            "concern_oil_control": "Oil Control",
            "concern_acne": "Acne",
            "concern_post_acne": "Post-acne",
            "concern_dehydration": "Dehydration",
            "concern_barrier": "Skin Barrier",
            "concern_dullness": "Dullness",
            "concern_aging": "Anti-aging",
        }

        for field, label in concern_labels.items():
            if snapshot.get(field):
                concerns[label] += 1

    charts["top_skin_concerns"] = [
        {"skin_concern": name, "count": count}
        for name, count in concerns.most_common(10)
    ]

    products = Counter(
        item.product_name_snapshot
        for item in items
        if item.customer_feedback == "Interested"
        and item.product_name_snapshot
    )
    charts["top_interested_products"] = [
        {"product_name": name, "count": count}
        for name, count in products.most_common(10)
    ]

    return {"kpis": kpis, "charts": charts}
