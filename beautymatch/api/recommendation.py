"""BeautyMatch recommendation generation API.

Creates one immutable recommendation snapshot per consultation request.
Only authorized CRM staff with access to the corresponding Lead may use it.
"""

import json
from uuid import UUID

import frappe

from beautymatch.api.profile import (
    _check_consultation_role, _check_lead_access, _acquire_lock,
)
from beautymatch.services.matching_engine import match_products

PROFILE_FIELDS = (
    "skin_type", "sensitivity", "requested_category", "max_budget",
    "concern_oil_control", "concern_acne", "concern_post_acne",
    "concern_dehydration", "concern_barrier", "concern_dullness",
    "concern_aging", "avoid_fragrance", "avoid_alcohol_denat",
    "avoid_essential_oil", "preferred_brand",
)
SETTINGS_FIELDS = (
    "algorithm_version", "skin_weight", "concern_weight",
    "ingredient_weight", "sensitivity_weight", "budget_weight",
    "brand_weight", "minimum_recommendation_score", "number_of_results",
)
SCORE_FIELDS = (
    "rank", "product", "skin_score", "concern_score",
    "ingredient_score", "sensitivity_score", "budget_score",
    "brand_score", "final_match_score", "concern_coverage",
    "why_recommended", "warning_partial_match",
)


def _invalid(message):
    frappe.throw(message, exc=frappe.ValidationError)


def _serialize_session(session):
    """Read stored snapshot; do not recompute on retries."""
    return {
        "recommendation_session": session.name,
        "crm_lead": session.crm_lead,
        "beauty_profile": session.beauty_profile,
        "request_id": session.request_id,
        "status": session.status,
        "algorithm_version": session.algorithm_version,
        "requested_category": session.requested_category,
        "max_budget": session.max_budget,
        "number_of_eligible_products": session.number_of_eligible_products,
        "number_of_recommendations": session.number_of_recommendations,
        "result_message": session.result_message,
        "results": [
            {
                "recommendation_item": item.name,
                **{field: item.get(field) for field in SCORE_FIELDS},
                "product_code": item.product_code_snapshot,
                "product_name": item.product_name_snapshot,
                "brand": item.brand_snapshot,
                "price": item.price_snapshot,
                "customer_feedback": item.customer_feedback,
            }
            for item in session.recommendation_items
        ],
    }


@frappe.whitelist(methods=["POST"])
def generate_recommendations(crm_lead, beauty_profile, request_id, profile_version):
    """Generate and persist at most three recommendations per consultation."""
    _check_consultation_role()

    for key, value in (
        ("crm_lead", crm_lead),
        ("beauty_profile", beauty_profile),
        ("request_id", request_id),
        ("profile_version", profile_version),
    ):
        if not isinstance(value, str) or not value.strip():
            _invalid(f"Thiếu hoặc sai định dạng: {key}")
    try:
        request_id = str(UUID(request_id))
    except (ValueError, AttributeError):
        _invalid("request_id phải là UUID hợp lệ.")

    # Authorization first: never disclose another customer's consultation.
    _check_lead_access(crm_lead)

    submission_name = frappe.db.get_value(
        "Consultation Submission", {"request_id": request_id}, "name"
    )
    if not submission_name:
        _invalid("Không tìm thấy yêu cầu tư vấn đã lưu.")
    submission = frappe.get_doc("Consultation Submission", submission_name)
    if (
        submission.crm_lead != crm_lead
        or submission.beauty_profile != beauty_profile
        or submission.profile_version != profile_version
    ):
        _invalid("Thông tin không khớp với yêu cầu tư vấn ban đầu.")

    # Hold the lock until transaction commit/rollback, not just until return.
    _acquire_lock("recommend", request_id)
    existing = frappe.db.get_value(
        "Recommendation Session", {"request_id": request_id}, "name"
    )
    if existing:
        session = frappe.get_doc("Recommendation Session", existing)
        if session.crm_lead != crm_lead or session.beauty_profile != beauty_profile:
            _invalid("request_id đã thuộc phiên tư vấn khác.")
        return _serialize_session(session)

    profile = frappe.get_doc("Beauty Profile", beauty_profile)
    if profile.crm_lead != crm_lead or profile.status != "Active" or not profile.consent:
        _invalid("Hồ sơ không hợp lệ hoặc chưa có đồng ý lưu thông tin.")
    if str(profile.modified) != profile_version:
        _invalid("Hồ sơ đã thay đổi; vui lòng thực hiện yêu cầu tư vấn mới.")

    snapshot = {field: profile.get(field) for field in PROFILE_FIELDS}
    settings = frappe.get_doc("BeautyMatch Settings")
    settings_snapshot = {field: settings.get(field) for field in SETTINGS_FIELDS}

    # Product document `name` is required by the matching engine.
    products = frappe.get_all("Product Profile", filters={"status": "Active"}, fields=["*"])
    matched = match_products(snapshot, products, settings)
    results = matched["results"][:3]
    product_by_name = {product.name: product for product in products}

    session = frappe.get_doc({
        "doctype": "Recommendation Session",
        "crm_lead": crm_lead,
        "beauty_profile": beauty_profile,
        "request_id": request_id,
        "profile_snapshot": json.dumps(snapshot, ensure_ascii=False),
        "requested_category": snapshot["requested_category"],
        "max_budget": snapshot["max_budget"],
        "number_of_eligible_products": matched["number_of_eligible_products"],
        "number_of_recommendations": len(results),
        "status": "Generated",
        "algorithm_version": settings_snapshot["algorithm_version"],
        "settings_snapshot": json.dumps(settings_snapshot, ensure_ascii=False),
        "result_message": (
            f"Đã tìm thấy {len(results)} sản phẩm phù hợp."
            if results else "Chưa tìm thấy sản phẩm đáp ứng các điều kiện đã chọn."
        ),
    })
    for result in results:
        product = product_by_name.get(result["product"])
        if not product:
            _invalid("Sản phẩm gợi ý không còn tồn tại trong catalog.")
        session.append("recommendation_items", {
            **{field: result.get(field) for field in SCORE_FIELDS},
            "product_code_snapshot": product.product_code,
            "product_name_snapshot": product.product_name,
            "brand_snapshot": product.brand,
            "price_snapshot": product.price,
            "customer_feedback": "None",
        })
    # Recommendation DocTypes have no staff permissions; access was
    # explicitly authorized through the linked CRM Lead above.
    session.insert(ignore_permissions=True)
    return _serialize_session(session)


@frappe.whitelist(methods=["GET"])
def get_recommendation_result(recommendation_session):
    """Return a stored recommendation after checking its CRM Lead access."""
    _check_consultation_role()
    if not isinstance(recommendation_session, str) or not recommendation_session.strip():
        _invalid("Thiếu recommendation_session.")
    session = frappe.get_doc("Recommendation Session", recommendation_session.strip())
    _check_lead_access(session.crm_lead)
    return _serialize_session(session)


@frappe.whitelist(methods=["GET"])
def get_consultation_history(crm_lead, limit=20, start=0):
    """List stored consultations for one authorized CRM Lead, newest first."""
    _check_consultation_role()
    if not isinstance(crm_lead, str) or not crm_lead.strip():
        _invalid("Thiếu crm_lead.")
    crm_lead = crm_lead.strip()
    _check_lead_access(crm_lead)
    try:
        limit = int(limit)
        start = int(start)
    except (TypeError, ValueError, OverflowError):
        _invalid("limit và start phải là số nguyên hợp lệ.")
    if not 1 <= limit <= 100 or start < 0:
        _invalid("limit phải từ 1 đến 100 và start không được âm.")

    total = frappe.db.count("Recommendation Session", {"crm_lead": crm_lead})
    rows = frappe.get_all(
        "Recommendation Session",
        filters={"crm_lead": crm_lead},
        fields=["name"],
        order_by="creation desc, name desc",
        start=start,
        page_length=limit,
    )
    sessions = [
        _serialize_session(frappe.get_doc("Recommendation Session", row.name))
        for row in rows
    ]
    return {
        "crm_lead": crm_lead,
        "total": total,
        "start": start,
        "limit": limit,
        "sessions": sessions,
    }
