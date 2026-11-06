"""Idempotent seminar setup: local-only, synthetic identities, real APIs.

Credentials are generated once into .local/, never printed or whitelisted.
No existing research product is changed. No email is sent.
"""
import json
import secrets
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

import frappe
from frappe.utils.password import update_password

from beautymatch.api import profile, frontend, recommendation, feedback, portal
from beautymatch.scripts.import_hasaki import read_and_validate
from beautymatch.services.matching_engine import match_products, _valid_product

ROOT = Path(__file__).resolve().parents[2]
LOCAL = ROOT / ".local"
USERS = {
    "manager": ("sales.manager.demo@example.invalid", "Sales Manager Demo", "Sales Manager", "System User"),
    "staff": ("sales.user.demo@example.invalid", "Sales User Demo", "Sales User", "System User"),
    "customer": ("customer.demo@example.invalid", "Nguyễn Minh Anh", "BeautyMatch Customer", "Website User"),
}


def _guard():
    if frappe.local.site != "crm.localhost" or not frappe.conf.developer_mode or frappe.session.user != "Administrator":
        frappe.throw("Seminar setup chỉ chạy bằng Administrator trên crm.localhost có developer_mode.", frappe.PermissionError)


def _write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")
    path.chmod(0o600)


def prepare_users():
    _guard()
    from beautymatch.config.portal import install
    install()
    LOCAL.mkdir(exist_ok=True)
    path = LOCAL / "seminar-credentials.json"
    credentials = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for key, (email, name, role, kind) in USERS.items():
        if frappe.db.exists("User", email):
            doc = frappe.get_doc("User", email)
            if key not in credentials or doc.full_name != name or role not in frappe.get_roles(email) or doc.user_type != kind:
                frappe.throw("Tài khoản demo đã tồn tại ngoài bộ seed này; không tự thay mật khẩu/quyền.")
            if not doc.enabled:
                frappe.throw("Tài khoản demo đã bị tắt. Cần quản trị viên xác minh trước khi bật lại.")
            continue
        credentials.setdefault(key, {"username": email, "password": secrets.token_urlsafe(30), "role": role})
        # Save newly generated secrets before touching password storage. Re-runs
        # reuse this local file; no existing account password is rotated.
        _write(path, credentials)
        doc = frappe.get_doc({
            "doctype": "User", "email": email, "first_name": name,
            "enabled": 1, "user_type": kind, "language": "en", "send_welcome_email": 0,
            "roles": [{"role": role}],
        })
        doc.flags.no_welcome_mail = True
        doc.insert()
        update_password(email, credentials[key]["password"], logout_all_sessions=True)
    # Equivalent to CRM's Skip All onboarding action, only for these demo
    # accounts. This changes a user preference, not Lead/Deal business records.
    from frappe.onboarding import update_user_onboarding_status
    actor = frappe.session.user
    try:
        for key in ("manager", "staff"):
            user = USERS[key][0]
            steps = ["setup_your_password", "create_first_lead"]
            if key == "manager":
                steps += ["create_first_web_form", "invite_your_team"]
            steps += ["convert_lead_to_deal", "create_first_task", "create_first_note", "add_first_comment", "send_first_email", "change_deal_status"]
            if not frappe.db.get_value("User", user, "onboarding_status"):
                frappe.db.set_value("User", user, "onboarding_status", "{}", update_modified=False)
            frappe.set_user(user)
            update_user_onboarding_status(json.dumps([{"name": name, "completed": True} for name in steps]), "frappecrm")
    finally:
        frappe.set_user(actor)
    settings = frappe.get_doc("BeautyMatch Settings")
    backup = LOCAL / "seminar-settings-before.json"
    if not backup.exists():
        _write(backup, {"default_follow_up_assignee": settings.default_follow_up_assignee, "default_follow_up_due_days": settings.default_follow_up_due_days})
    settings.default_follow_up_assignee = USERS["staff"][0]
    settings.default_follow_up_due_days = 1
    settings.save(ignore_permissions=True)
    return {"credentials_file": ".local/seminar-credentials.json", "users": {key: values[0] for key, values in USERS.items()}, "assignee": settings.default_follow_up_assignee}


def demo_payload(key):
    specs = {
        "A": ("Nguyễn Minh Anh", USERS["customer"][0], "COMBINATION", "SERUM", 325000, ["concern_oil_control", "concern_acne", "concern_aging"]),
        "B": ("Trần Ngọc Hà", "tran.ngoc.ha.demo@example.invalid", "DRY", "MOISTURIZER", 400000, ["concern_dehydration", "concern_barrier"]),
        "C": ("Lê Khánh Linh", "le.khanh.linh.demo@example.invalid", "OILY", "SUNSCREEN", 150000, ["concern_acne", "concern_oil_control"]),
    }
    name, email, skin, category, budget, concerns = specs[key]
    data = {
        "full_name": name, "email": email, "phone": "", "skin_type": skin,
        "sensitivity": "Sensitive" if key == "B" else "Not specifically sensitive",
        "requested_category": category, "max_budget": budget, "preferred_brand": "", "consent": 1,
        "request_id": str(uuid5(NAMESPACE_URL, f"beautymatch-seminar-v1:{key}")),
        **{field: int(field in concerns) for field in profile.CONCERN_FIELDS},
        **{field: int(key == "B" and field == "avoid_fragrance") for field in profile.AVOID_FIELDS},
    }
    return data


def catalog_report():
    products = frappe.get_all("Product Profile", fields=["*"], limit_page_length=0)
    research = [row for row in products if not row.product_code.startswith("BM-DEMO-")]
    demos = [row for row in products if row.product_code.startswith("BM-DEMO-")]
    csv = read_and_validate()
    fields = list(csv[0])
    mismatches = []
    for row in research:
        original = next((record for record in csv if record["product_code"] == row.product_code), None)
        if not original:
            mismatches.append({"code": row.product_code, "reason": "not_in_csv"})
            continue
        differing = [field for field in fields if str(row.get(field) or "").strip() != str(original.get(field) or "").strip() and field != "price"]
        if float(row.price or 0) != float(original["price"]):
            differing.append("price")
        if differing:
            mismatches.append({"code": row.product_code, "fields": differing})
    settings = frappe.get_doc("BeautyMatch Settings")
    scenarios = {}
    for key in ("A", "B", "C"):
        matched = match_products(demo_payload(key), products, settings)
        scenarios[key] = {"eligible": matched["number_of_eligible_products"], "results": len(matched["results"]), "scores": [item["final_match_score"] for item in matched["results"]], "products": [item["product"] for item in matched["results"]]}
    return {
        "csv_rows": len(csv), "research_products": len(research), "demo_products": len(demos),
        "active_research": sum(row.status == "Active" for row in research), "active_demo": sum(row.status == "Active" for row in demos),
        "matching_complete_active": sum(row.status == "Active" and _valid_product(row) for row in products),
        "research_csv_differences": mismatches, "scenarios": scenarios,
        "csv_codes_not_in_database": sorted({row["product_code"] for row in csv} - {row.product_code for row in research}),
        "threshold": settings.minimum_recommendation_score, "weights": {field: settings.get(field) for field in ("skin_weight", "concern_weight", "ingredient_weight", "sensitivity_weight", "budget_weight", "brand_weight")},
    }


def seed_demo():
    _guard()
    users = prepare_users()
    from beautymatch.scripts.local_demo import prepare
    prepare()  # Existing clearly labeled serum copies from verified CSV.
    products = frappe.get_all("Product Profile", fields=["*"], limit_page_length=0)
    settings = frappe.get_doc("BeautyMatch Settings")
    # Add only a catalog-derived, labeled moisturizer copy if B currently has
    # no result. Never infer ingredient flags or change matching rules.
    if not match_products(demo_payload("B"), products, settings)["results"]:
        for row in read_and_validate():
            candidate = {**row, "status": "Active", "name": row["product_code"]}
            if row["category"] != "MOISTURIZER" or not match_products(demo_payload("B"), [candidate], settings)["results"]:
                continue
            code = "BM-DEMO-" + row["product_code"]
            if not frappe.db.exists("Product Profile", {"product_code": code}):
                frappe.get_doc({"doctype": "Product Profile", **row, "product_code": code, "product_name": row["product_name"] + " · DEMO", "status": "Active"}).insert()
            break
    result = {"users": users, "customers": {}, "catalog": catalog_report()}
    actor = frappe.session.user
    try:
        frappe.set_user(USERS["staff"][0])
        for key in ("A", "B", "C"):
            data = demo_payload(key)
            receipt = frontend.save_consultation(data)
            session = recommendation.generate_recommendations(**{field: receipt[field] for field in ("crm_lead", "beauty_profile", "profile_version", "request_id")})
            if key == "A" and session["results"]:
                feedback.submit_feedback(session["session_id"], session["results"][0]["item_id"], "Interested")
            result["customers"][key] = {**receipt, "session_id": session["session_id"], "results": len(session["results"])}
        frappe.set_user(USERS["customer"][0])
        data = demo_payload("A")
        data["request_id"] = str(uuid5(NAMESPACE_URL, "beautymatch-seminar-v1:customer-intake"))
        result["customer_request"] = portal.submit_profile(data)
    finally:
        frappe.set_user(actor)
    _write(LOCAL / "seminar-data.json", result)
    return {"prepared": True, "data_file": ".local/seminar-data.json", "credentials_file": users["credentials_file"], "catalog": result["catalog"], "demo_customers": len(result["customers"])}


def inspect():
    _guard()
    import crm
    return {"frappe": frappe.__version__, "crm": crm.__version__, "site": frappe.local.site,
            "catalog": catalog_report(), "counts": {dt: frappe.db.count(dt) for dt in ("CRM Lead", "Beauty Profile", "BeautyMatch Customer Account", "BeautyMatch Customer Request", "Consultation Submission", "Recommendation Session", "CRM Task", "Product Profile")}}


def prepare_presentation():
    """Leave an explicit, ready-to-accept A request; never rewrite old sessions."""
    _guard()
    from uuid import uuid4
    target = demo_payload("A")
    account = frappe.db.get_value("BeautyMatch Customer Account", {"user": USERS["customer"][0]}, "crm_lead")
    current = frappe.get_doc("Beauty Profile", {"crm_lead": account})
    pending = frappe.get_all("BeautyMatch Customer Request", filters={"customer": USERS["customer"][0], "status": "Pending"}, fields=["name", "payload_json"], order_by="creation desc", limit_page_length=1)
    matching = all(current.get(field) == target[field] for field in recommendation.PROFILE_FIELDS)
    if pending and matching and all(json.loads(pending[0].payload_json).get(field) == target[field] for field in recommendation.PROFILE_FIELDS):
        return {"ready": True, "request_id": pending[0].name, "changed": False}
    actor = frappe.session.user
    try:
        frappe.set_user(USERS["customer"][0])
        target["request_id"] = str(uuid4())
        ack = portal.submit_profile(target)
    finally:
        frappe.set_user(actor)
    _write(LOCAL / "seminar-ready.json", ack)
    return {"ready": True, "request_id": ack["request_id"], "changed": True}


def verify_seed():
    """Measured idempotency and unchanged original catalog, not just a claim."""
    _guard()
    import hashlib
    def state():
        original = frappe.get_all("Product Profile", filters={"product_code": ["not like", "BM-DEMO-%"]}, fields=["*"], order_by="name asc", limit_page_length=0)
        return {"counts": {dt: frappe.db.count(dt) for dt in ("User", "CRM Lead", "Beauty Profile", "Consultation Submission", "Recommendation Session", "CRM Task", "Product Profile", "BeautyMatch Customer Account", "BeautyMatch Customer Request")}, "research_hash": hashlib.sha256(json.dumps(original, sort_keys=True, default=str).encode()).hexdigest(), "credentials_hash": hashlib.sha256((LOCAL / "seminar-credentials.json").read_bytes()).hexdigest()}
    before = state()
    seed_demo()
    after = state()
    assert before == after
    return {"passed": True, "record_counts_unchanged": True, "research_catalog_unchanged": True, "credentials_unchanged": True, **after}
