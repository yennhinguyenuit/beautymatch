"""BeautyMatch matching engine, pure Python; no DB writes, Session or CRM Task.

Requires Frappe Product Profile fields (not CSV column aliases) and the
Beauty Profile snapshot fields agreed in TASK 1. Products must contain their
Frappe document `name`. See docs/IMPLEMENTATION_NOTES.md for scoring decisions.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse

CATEGORY_VALUES = {"CLEANSER", "TONER", "SERUM", "MOISTURIZER", "SUNSCREEN"}
SKIN_FIELDS = {
    "OILY": "suitable_oily",
    "DRY": "suitable_dry",
    "COMBINATION": "suitable_combination",
    "NORMAL": "suitable_normal",
}
CONCERNS = {
    "concern_oil_control": ("concern_oil_control", "oil_control", "kiểm soát dầu"),
    "concern_acne": ("concern_acne", "acne_prone", "da dễ nổi mụn"),
    "concern_post_acne": ("concern_post_acne", "post_acne_marks", "thâm sau mụn"),
    "concern_dehydration": ("concern_dehydration", "dehydration", "thiếu ẩm"),
    "concern_barrier": ("concern_barrier", "soothing_barrier", "hỗ trợ hàng rào da"),
    "concern_dullness": ("concern_dullness", "dullness", "xỉn màu"),
    "concern_aging": ("concern_aging", "aging", "dấu hiệu lão hóa"),
}
AVOID_MAP = {
    "avoid_fragrance": "contains_fragrance",
    "avoid_alcohol_denat": "contains_alcohol_denat",
    "avoid_essential_oil": "contains_essential_oil",
}
WEIGHTS = ("skin_weight", "concern_weight", "ingredient_weight", "sensitivity_weight", "budget_weight", "brand_weight")


def _read(obj, field, default=None):
    # Accept dicts and Frappe _dict/Document; only known schema names are read.
    return obj.get(field, default) if hasattr(obj, "get") else getattr(obj, field, default)


def _one(value):
    return value is True or value == 1 or value == "1"


def _flag_valid(value):
    return value is True or value is False or value in (0, 1, "0", "1")


def _number(value):
    try:
        if isinstance(value, bool) or value is None:
            return None
        d = Decimal(str(value))
        return d if d.is_finite() else None
    except (ValueError, InvalidOperation):
        return None


def _valid_url(value):
    if not isinstance(value, str) or not value.strip():
        return False
    u = urlparse(value)
    return u.scheme in {"http", "https"} and bool(u.netloc)


def _valid_date(value):
    if isinstance(value, date):
        d = value.date() if hasattr(value, "date") else value
    else:
        try:
            d = date.fromisoformat(str(value)[:10])
        except (TypeError, ValueError):
            return False
    return d <= date.today()


def _validate_profile(profile):
    skin = _read(profile, "skin_type")
    category = _read(profile, "requested_category")
    sensitivity = _read(profile, "sensitivity")
    budget = _number(_read(profile, "max_budget"))
    if skin not in SKIN_FIELDS or category not in CATEGORY_VALUES:
        raise ValueError("Invalid Beauty Profile skin_type/requested_category")
    if sensitivity not in {"Sensitive", "Not specifically sensitive"}:
        raise ValueError("Invalid Beauty Profile sensitivity")
    if budget is None or budget <= 0:
        raise ValueError("Invalid Beauty Profile max_budget")
    requested = []
    for field in CONCERNS:
        v = _read(profile, field)
        if not _flag_valid(v):
            raise ValueError(f"Invalid Beauty Profile flag: {field}")
        if _one(v):
            requested.append(field)
    if not 1 <= len(requested) <= 3:
        raise ValueError("Beauty Profile must select 1 to 3 concerns")
    for field in AVOID_MAP:
        if not _flag_valid(_read(profile, field)):
            raise ValueError(f"Invalid Beauty Profile flag: {field}")
    return skin, category, sensitivity, budget, requested


def _validate_settings(settings):
    weights = {}
    for field in WEIGHTS:
        n = _number(_read(settings, field))
        if n is None or n < 0:
            raise ValueError(f"Invalid Settings weight: {field}")
        weights[field] = n
    minimum = _number(_read(settings, "minimum_recommendation_score"))
    n_results = _number(_read(settings, "number_of_results"))
    if minimum is None or not 0 <= minimum <= 100 or n_results is None or n_results != int(n_results) or n_results < 0:
        raise ValueError("Invalid Settings threshold or result limit")
    return weights, minimum, min(3, int(n_results))


def _valid_product(p):
    # H6: mandatory fields valid. Does not infer unknown ingredient/skin claims.
    if any(not str(_read(p, f, "") or "").strip() for f in ("name", "product_code", "product_name", "brand")):
        return False
    if _read(p, "category") not in CATEGORY_VALUES:
        return False
    if (_number(_read(p, "price")) or Decimal(0)) <= 0:
        return False
    if not _valid_url(_read(p, "product_url")) or not _valid_url(_read(p, "source_url")):
        return False
    if not _valid_date(_read(p, "data_as_of")):
        return False
    flags = list(SKIN_FIELDS.values()) + ["suitable_all_skin", "suitable_sensitive"] + [v[0] for v in CONCERNS.values()]
    if any(not _flag_valid(_read(p, f)) for f in flags):
        return False
    if any(_read(p, f) not in {"Yes", "No", "Unknown"} for f in AVOID_MAP.values()):
        return False
    # Active Policy v1.1: a QC-eligible product needs at least one skin
    # claim and one concern claim.  A zero flag means "not evidenced", not
    # a verified negative suitability/claim.
    if not any(_one(_read(p, f)) for f in list(SKIN_FIELDS.values()) + ["suitable_all_skin"]):
        return False
    if not any(_one(_read(p, f)) for f, _, _ in CONCERNS.values()):
        return False
    return True


def _tags(product):
    raw = _read(product, "ingredient_concern_tags")
    if not raw:
        return set()
    if isinstance(raw, str):
        return {v.strip().lower() for v in raw.split(",") if v.strip()}
    if isinstance(raw, (list, tuple, set)):
        return {str(v).strip().lower() for v in raw if str(v).strip()}
    return set()


def match_products(profile_snapshot, products, settings):
    """Return {number_of_eligible_products, results}, no side effects.

    Eligible = passes H1-H6, before min-score cutoff. Product field is
    Product Profile.name (Frappe document primary key), never product_code.
    """
    skin, category, sensitivity, budget, requested = _validate_profile(profile_snapshot)
    weights, minimum, limit = _validate_settings(settings)
    preferred = str(_read(profile_snapshot, "preferred_brand") or "").strip().casefold()
    denominator = sum(weights.values()) - (Decimal(0) if preferred else weights["brand_weight"])
    if denominator <= 0:
        raise ValueError("Sum of applicable weights must be positive")

    eligible = 0
    scored = []
    for product in products:
        # H1, H2, H3, H4, H5, H6 (order does not change eligibility).
        if _read(product, "status") != "Active":
            continue
        if _read(product, "category") != category:
            continue
        price = _number(_read(product, "price"))
        if price is None or price <= 0 or price > budget:
            continue
        direct_skin = _one(_read(product, SKIN_FIELDS[skin]))
        all_skin = _one(_read(product, "suitable_all_skin"))
        if not (direct_skin or all_skin):
            continue
        if any(_one(_read(profile_snapshot, avoid)) and _read(product, contains) != "No"
               for avoid, contains in AVOID_MAP.items()):
            continue
        if not _valid_product(product):
            continue

        eligible += 1
        covered = [f for f in requested if _one(_read(product, CONCERNS[f][0]))]
        tags = _tags(product)
        # An ingredient tag alone without any ingredient evidence cannot earn
        # Ingredient points. Neither missing tags nor Unknown safety flags
        # are inferred from product concern claims.
        has_ingredient_evidence = bool(str(_read(product, "key_ingredients") or "").strip())
        supported_by_ingredients = [f for f in requested if has_ingredient_evidence and CONCERNS[f][1] in tags]
        concern_ratio = Decimal(len(covered)) / Decimal(len(requested))
        ingredient_ratio = Decimal(len(supported_by_ingredients)) / Decimal(len(requested))
        score = {
            "skin_score": weights["skin_weight"] * (Decimal(1) if direct_skin else Decimal("0.8")),
            "concern_score": weights["concern_weight"] * concern_ratio,
            "ingredient_score": weights["ingredient_weight"] * ingredient_ratio,
            "sensitivity_score": weights["sensitivity_weight"] *
                (Decimal(1) if sensitivity != "Sensitive" or _one(_read(product, "suitable_sensitive")) else Decimal(0)),
            "budget_score": weights["budget_weight"] * (Decimal(1) if price <= budget * Decimal("0.8") else Decimal("0.6")),
            "brand_score": weights["brand_weight"] if preferred and str(_read(product, "brand") or "").strip().casefold() == preferred else Decimal(0),
        }
        total = min(Decimal(100), max(Decimal(0), Decimal(100) * sum(score.values()) / denominator))
        if total < minimum:
            continue

        reason = ["Phù hợp loại da đã chọn" if direct_skin else "Có xác nhận phù hợp mọi loại da"]
        if covered:
            reason.append("Có thông tin hỗ trợ " + ", ".join(CONCERNS[f][2] for f in covered))
        if supported_by_ingredients:
            reason.append("Có tag thành phần liên quan đến nhu cầu đã chọn")
        if price <= budget:
            reason.append("Trong ngân sách")
        if preferred and score["brand_score"] > 0:
            reason.append("Đúng thương hiệu ưu tiên")
        warnings = []
        if len(covered) < len(requested):
            warnings.append("Chưa xác nhận đủ mọi nhu cầu đã chọn")
        if len(supported_by_ingredients) < len(requested):
            warnings.append("Bằng chứng thành phần chưa bao phủ đủ nhu cầu")
        if sensitivity == "Sensitive" and not _one(_read(product, "suitable_sensitive")):
            warnings.append("Chưa có xác nhận riêng cho da nhạy cảm")
        result = {
            "rank": 0,
            "product": _read(product, "name"),
            "skin_score": round(float(score["skin_score"]), 2),
            "concern_score": round(float(score["concern_score"]), 2),
            "ingredient_score": round(float(score["ingredient_score"]), 2),
            "sensitivity_score": round(float(score["sensitivity_score"]), 2),
            "budget_score": round(float(score["budget_score"]), 2),
            "brand_score": round(float(score["brand_score"]), 2),
            "final_match_score": round(float(total), 2),
            "concern_coverage": round(float(concern_ratio * 100), 2),
            "why_recommended": "; ".join(reason) + ".",
            "warning_partial_match": "; ".join(warnings) + "." if warnings else "",
        }
        # Sort by unrounded total to avoid reversing ties caused by 2-decimal
        # display rounding. The JSON output remains rounded for the UI.
        scored.append((result, price, str(_read(product, "product_code")), total, concern_ratio, ingredient_ratio))

    scored.sort(key=lambda row: (
        -row[3],
        -row[4],
        -row[5],
        row[1],
        row[2],
    ))
    results = [row[0] for row in scored[:limit]]
    for index, result in enumerate(results, start=1):
        result["rank"] = index
    return {"number_of_eligible_products": eligible, "results": results}
