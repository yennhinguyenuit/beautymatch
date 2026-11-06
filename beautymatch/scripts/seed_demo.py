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


def repair_demo_assignments():
    """Repair only verified seminar records and the explicitly reported QA Lead.

    Never mass-reassign CRM records or change permission rules. Native Lead
    save/assignment APIs apply CRM's owner, ToDo and sharing behavior.
    """
    _guard()
    from frappe.desk.form.assign_to import remove
    from frappe.desk.form.assign_to import _add as assign
    staff = USERS["staff"][0]
    seeded = json.loads((LOCAL / "seminar-data.json").read_text(encoding="utf-8"))
    targets = {entry["crm_lead"]: demo_payload(key)["email"] for key, entry in seeded["customers"].items()}
    target = "CRM-LEAD-2026-00038"
    if frappe.db.exists("CRM Lead", target):
        qa = frappe.get_doc("CRM Lead", target)
        if (qa.first_name or "").startswith("BeautyMatch Native CRM QA sales-user ") and (qa.email or "").startswith("beautymatch-native-sales-user-") and qa.email.endswith("@example.invalid"):
            targets[target] = qa.email
    changed = []
    for name, expected_email in targets.items():
        lead = frappe.get_doc("CRM Lead", name, for_update=True)
        if lead.email != expected_email or not expected_email.endswith("@example.invalid"):
            frappe.throw("Lead không thuộc bộ demo đã xác minh; không tự phân công lại.")
        owner = lead.lead_owner or ""
        owned_demo = owner in {"", "Administrator", USERS["manager"][0], staff} or (owner.startswith("beautymatch-sidebar-qa-") and not frappe.db.get_value("User", owner, "enabled"))
        if not owned_demo:
            frappe.throw("Lead demo đang thuộc nhân viên ngoài bộ demo; cần kiểm tra riêng.")
        modified = False
        # CRM 1.86 clears lead_owner when ANY co-assignment is cancelled.
        # Remove retired QA assignments first, then save the intended owner.
        assigned = frappe.get_all("ToDo", filters={"reference_type": "CRM Lead", "reference_name": name, "status": "Open"}, pluck="allocated_to")
        for user in assigned:
            if user.startswith("beautymatch-sidebar-qa-") and not frappe.db.get_value("User", user, "enabled"):
                remove("CRM Lead", name, user)
                modified = True
        lead = frappe.get_doc("CRM Lead", name, for_update=True)
        if lead.lead_owner != staff:
            lead.lead_owner = staff
            lead.save()
            modified = True
        assigned = frappe.get_all("ToDo", filters={"reference_type": "CRM Lead", "reference_name": name, "status": "Open"}, pluck="allocated_to")
        if staff not in assigned:
            assign({"assign_to": [staff], "doctype": "CRM Lead", "name": name})
            modified = True
        if modified:
            changed.append(name)
        assert all(frappe.has_permission("CRM Lead", kind, doc=frappe.get_doc("CRM Lead", name), user=staff) for kind in ("read", "write"))
    return {"verified_demo_leads": list(targets), "changed": changed, "assignee": staff}


def configure_demo_logins():
    """Explicit local operator action; seed itself never resets passwords.

    Read the requested password from an ignored local file, never CLI output,
    source code or a web endpoint. Preserve canonical emails/CRM relationships.
    """
    _guard()
    path = LOCAL / "seminar-credentials.json"
    credentials = json.loads(path.read_text(encoding="utf-8"))
    password = json.loads((LOCAL / "demo-login-update.json").read_text(encoding="utf-8"))["password"]
    if not isinstance(password, str) or not password:
        frappe.throw("Thiếu mật khẩu demo do người vận hành cung cấp.")
    aliases = {"customer": "khach", "staff": "tuvan", "manager": "quanly"}
    for key, values in USERS.items():
        if credentials.get(key, {}).get("username") != values[0]:
            frappe.throw("Credentials không khớp bộ tài khoản demo hiện có.")
        duplicate = frappe.db.get_value("User", {"username": aliases[key]}, "name")
        if duplicate and duplicate != values[0]:
            frappe.throw("Tên đăng nhập ngắn đã được sử dụng bởi tài khoản khác.")
        doc = frappe.get_doc("User", values[0])
        if doc.full_name != values[1] or doc.user_type != values[3] or values[2] not in frappe.get_roles(doc.name):
            frappe.throw("Tài khoản không thuộc bộ demo đã xác minh.")
    for key, values in USERS.items():
        doc = frappe.get_doc("User", values[0])
        doc.username = aliases[key]
        doc.save()
        update_password(doc.name, password, logout_all_sessions=True)
        credentials[key].update({"password": password, "login": aliases[key]})
    # Standard Frappe login option, not a role or record permission change.
    frappe.db.set_single_value("System Settings", "allow_login_using_user_name", 1)
    frappe.db.commit()
    _write(path, credentials)
    return {"updated": list(aliases.values()), "credentials_file": ".local/seminar-credentials.json", "administrator_unchanged": True}


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
        from beautymatch.api import self_service
        data["request_id"] = str(uuid5(NAMESPACE_URL, "beautymatch-seminar-v2:self-service:A"))
        own = self_service.recommend(data)
        result["customer_result"] = {"session_id": own["session_id"], "request_id": own["request_id"]}
        previous_path = LOCAL / "seminar-data.json"
        if previous_path.exists():
            previous = json.loads(previous_path.read_text(encoding="utf-8"))
            if previous.get("customer_request"):
                result["customer_request"] = previous["customer_request"]
    finally:
        frappe.set_user(actor)
    _write(LOCAL / "seminar-data.json", result)
    repair_demo_assignments()
    return {"prepared": True, "data_file": ".local/seminar-data.json", "credentials_file": users["credentials_file"], "catalog": result["catalog"], "demo_customers": len(result["customers"])}


def inspect():
    _guard()
    import crm
    return {"frappe": frappe.__version__, "crm": crm.__version__, "site": frappe.local.site,
            "catalog": catalog_report(), "counts": {dt: frappe.db.count(dt) for dt in ("CRM Lead", "Beauty Profile", "BeautyMatch Customer Account", "BeautyMatch Customer Request", "Consultation Submission", "Recommendation Session", "CRM Task", "Product Profile")}}


def prepare_presentation():
    """Compatibility operator command uses the current self-service workflow."""
    return prepare_self_service()


def prepare_self_service():
    """Leave a fresh unreviewed real Top 3; repeat calls reuse it, never create work."""
    _guard()
    from uuid import uuid4
    from beautymatch.api import self_service
    target = demo_payload("A")
    user = USERS["customer"][0]
    lead = frappe.db.get_value("BeautyMatch Customer Account", {"user": user}, "crm_lead")
    profile = frappe.get_doc("Beauty Profile", {"crm_lead": lead})
    recent = frappe.get_all("Recommendation Session", filters={"customer_user": user}, fields=["name"], order_by="creation desc, name desc", limit_page_length=1)
    if recent:
        session = frappe.get_doc("Recommendation Session", recent[0].name)
        matches = all(profile.get(field) == target[field] and json.loads(session.profile_snapshot).get(field) == target[field] for field in recommendation.PROFILE_FIELDS)
        if matches and all(row.customer_feedback == "None" for row in session.recommendation_items) and not frappe.db.exists("BeautyMatch Contact Request", {"recommendation_session": session.name}):
            return {"ready": True, "session_id": session.name, "changed": False}
    actor = frappe.session.user
    try:
        frappe.set_user(user)
        target["request_id"] = str(uuid4())
        result = self_service.recommend(target)
    finally:
        frappe.set_user(actor)
    ready = {"ready": True, "session_id": result["session_id"], "request_id": result["request_id"], "changed": True}
    _write(LOCAL / "seminar-self-service-ready.json", ready)
    return ready


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
