"""BeautyMatch consultation intake: CRM Lead and current Beauty Profile.

Public API contract (for authenticated, authorized users):
    beautymatch.api.profile.save_beauty_profile(payload)

Form calls this API only; Recommendation Session creation belongs to the
recommendation API. Consultation Submission stores the per-request response for
idempotent retries. MariaDB advisory locks are held until transaction end.
"""

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation
from uuid import UUID

import frappe
from frappe.utils import validate_email_address


CONCERN_FIELDS = (
    "concern_oil_control",
    "concern_acne",
    "concern_post_acne",
    "concern_dehydration",
    "concern_barrier",
    "concern_dullness",
    "concern_aging",
)

AVOID_FIELDS = (
    "avoid_fragrance",
    "avoid_alcohol_denat",
    "avoid_essential_oil",
)

SKIN_TYPES = {"OILY", "DRY", "COMBINATION", "NORMAL"}
SENSITIVITY_OPTIONS = {"Sensitive", "Not specifically sensitive"}
CATEGORIES = {"CLEANSER", "TONER", "SERUM", "MOISTURIZER", "SUNSCREEN"}


class LeadConflictError(frappe.ValidationError):
    """The supplied email/phone may belong to different CRM Leads."""


class RequestConflictError(frappe.ValidationError):
    """The request_id was already used for a different normalized payload."""


class RequestBusyError(frappe.ValidationError):
    """The same request/customer is being processed by another transaction."""


def _invalid(message):
    frappe.throw(message, exc=frappe.ValidationError)


def _text(data, field, required=False, max_length=140):
    value = data.get(field)
    if value is None or value == "":
        if required:
            _invalid(f"Thiếu trường bắt buộc: {field}")
        return ""

    if not isinstance(value, str):
        _invalid(f"{field} phải là chuỗi ký tự.")

    value = value.strip()
    if required and not value:
        _invalid(f"Thiếu trường bắt buộc: {field}")
    if len(value) > max_length:
        _invalid(f"{field} vượt quá {max_length} ký tự.")
    return value


def _flag(data, field):
    value = data.get(field, 0)
    if value in (True, 1, "1"):
        return 1
    if value in (False, 0, "0", None, ""):
        return 0
    _invalid(f"{field} chỉ được nhận giá trị 0 hoặc 1.")


def _choice(data, field, allowed):
    value = _text(data, field, required=True)
    if value not in allowed:
        _invalid(f"Giá trị {field} không hợp lệ.")
    return value


def _normalize_phone(phone):
    """Normalize local Vietnamese numbers and keep other E.164-style numbers."""
    if not phone:
        return ""
    phone = re.sub(r"[\s().-]", "", phone)
    if phone.startswith("+84"):
        phone = "0" + phone[3:]
    elif phone.startswith("84") and len(phone) == 11:
        phone = "0" + phone[2:]
    if not re.fullmatch(r"\+?[0-9]{8,15}", phone):
        _invalid("Số điện thoại không hợp lệ.")
    return phone


def _validate_payload(payload):
    """Validate and normalize incoming form data, ignoring server-owned fields."""
    if isinstance(payload, str):
        try:
            payload = frappe.parse_json(payload)
        except (TypeError, ValueError):
            _invalid("Payload phải là JSON hợp lệ.")
    if not isinstance(payload, dict):
        _invalid("Payload phải là một JSON object.")

    data = {
        "full_name": _text(payload, "full_name", required=True),
        "email": _text(payload, "email").lower(),
        "phone": _normalize_phone(_text(payload, "phone")),
    }
    if not data["email"] and not data["phone"]:
        _invalid("Vui lòng nhập email hoặc số điện thoại.")
    if data["email"]:
        if validate_email_address(data["email"]) != data["email"]:
            _invalid("Địa chỉ email không hợp lệ.")

    data["skin_type"] = _choice(payload, "skin_type", SKIN_TYPES)
    data["sensitivity"] = _choice(payload, "sensitivity", SENSITIVITY_OPTIONS)
    for field in CONCERN_FIELDS:
        data[field] = _flag(payload, field)
    if not 1 <= sum(data[field] for field in CONCERN_FIELDS) <= 3:
        _invalid("Vui lòng chọn từ 1 đến 3 vấn đề da.")

    data["requested_category"] = _choice(payload, "requested_category", CATEGORIES)
    try:
        budget = Decimal(str(payload.get("max_budget", "")))
    except (InvalidOperation, ValueError):
        _invalid("Ngân sách phải là số hợp lệ.")
    if not budget.is_finite() or budget <= 0:
        _invalid("Ngân sách phải lớn hơn 0.")
    data["max_budget"] = float(budget)

    for field in AVOID_FIELDS:
        data[field] = _flag(payload, field)
    data["preferred_brand"] = _text(payload, "preferred_brand")
    data["consent"] = _flag(payload, "consent")
    if data["consent"] != 1:
        _invalid("Bạn phải đồng ý lưu thông tin tư vấn.")

    request_id = _text(payload, "request_id", required=True)
    try:
        request_id = str(UUID(request_id))
    except (ValueError, AttributeError):
        _invalid("request_id phải là UUID hợp lệ.")
    data["request_id"] = request_id
    return data


def _payload_hash(data):
    """SHA-256 of canonical normalized input; same request + changes conflict."""
    canonical_json = json.dumps(
        data, sort_keys=True, ensure_ascii=False,
        separators=(",", ":"), allow_nan=False,
    )
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def _phone_variants(phone):
    """Equivalent common storage formats for normalized Vietnamese numbers."""
    variants = {phone}
    if phone.startswith("0"):
        variants.add("+84" + phone[1:])
        variants.add("84" + phone[1:])
    return sorted(variants)


def _lock_name(kind, value):
    """Short MariaDB named lock; do not expose contact data in lock names."""
    digest = hashlib.sha256(str(value).encode("utf-8")).hexdigest()[:40]
    return f"bm:{kind}:{digest}"


def _acquire_lock(kind, value):
    """Hold advisory lock until the surrounding Frappe transaction finishes.

    Locking is connection-scoped, so COMMIT/ROLLBACK alone cannot release it.
    Frappe v15 transaction callbacks release it on either transaction outcome.
    """
    name = _lock_name(kind, value)
    result = frappe.db.sql("SELECT GET_LOCK(%s, %s)", (name, 5))[0][0]
    if result != 1:
        raise RequestBusyError(
            "REQUEST_BUSY: Yêu cầu với cùng thông tin đang được xử lý. "
            "Vui lòng thử lại sau."
        )

    released = False

    def release():
        nonlocal released
        if released:
            return
        frappe.db.sql("SELECT RELEASE_LOCK(%s)", (name,))
        released = True

    frappe.db.after_commit.add(release)
    frappe.db.after_rollback.add(release)


def _lock_submission(data):
    """Acquire locks in consistent order for the request and contact keys."""
    _acquire_lock("request", data["request_id"])
    identities = []
    if data["email"]:
        identities.append(("email", data["email"]))
    if data["phone"]:
        identities.append(("phone", data["phone"]))
    for kind, value in sorted(identities):
        _acquire_lock(kind, value)


def _find_existing_lead(data):
    """Find at most one CRM Lead by normalized email or phone.

    Called only by authorized server code. SELECT FOR UPDATE locks matching
    records until the transaction finishes to avoid lost updates.
    """
    conditions = []
    values = []
    if data["email"]:
        conditions.append("LOWER(TRIM(email)) = %s")
        values.append(data["email"])
    if data["phone"]:
        variants = _phone_variants(data["phone"])
        placeholders = ", ".join(["%s"] * len(variants))
        conditions.append(
            f"(mobile_no IN ({placeholders}) OR phone IN ({placeholders}))"
        )
        values.extend(variants)
        values.extend(variants)

    if not conditions:
        return None

    rows = frappe.db.sql(
        "SELECT name FROM `tabCRM Lead` WHERE "
        + " OR ".join(conditions)
        + " FOR UPDATE",
        tuple(values),
        as_dict=True,
    )
    matches = {row.name for row in rows}
    if len(matches) > 1:
        raise LeadConflictError(
            "LEAD_CONFLICT: Email hoặc số điện thoại khớp với nhiều "
            "CRM Lead. Cần kiểm tra thủ công."
        )
    return next(iter(matches)) if matches else None


def _check_lead_identity(lead, data):
    """Do not overwrite conflicting contact identifiers on an existing Lead."""
    if data["email"] and lead.email:
        if lead.email.strip().lower() != data["email"]:
            raise LeadConflictError(
                "LEAD_CONFLICT: Email khác với CRM Lead hiện có."
            )
    existing_phones = set()
    for field in ("mobile_no", "phone"):
        value = lead.get(field)
        if value:
            existing_phones.add(_normalize_phone(value))
    if data["phone"] and existing_phones and data["phone"] not in existing_phones:
        raise LeadConflictError(
            "LEAD_CONFLICT: Số điện thoại khác với CRM Lead hiện có."
        )


def _check_lead_access(lead_name):
    """Enforce CRM's record-level hierarchy/assignment permissions.

    This check deliberately does not grant read access to Beauty Profile or
    Consultation Submission themselves. Their records are reachable only
    through this API after verifying the associated CRM Lead.
    """
    lead = frappe.get_doc("CRM Lead", lead_name)
    lead.check_permission("read")
    lead.check_permission("write")
    return lead


def _check_consultation_role():
    """Consultation is for authenticated CRM staff, never Guest/self-service."""
    user = frappe.session.user
    roles = set(frappe.get_roles(user))
    if user == "Guest" or not roles.intersection(
        {"System Manager", "Sales Manager", "Sales User"}
    ) and user != "Administrator":
        frappe.throw("Bạn không có quyền thực hiện tư vấn.", frappe.PermissionError)


def _save_lead(data, lead_name):
    """Create a CRM Lead, or update the permitted fields of an existing one."""
    if lead_name:
        lead = _check_lead_access(lead_name)
        _check_lead_identity(lead, data)

        changed = False
        if lead.first_name != data["full_name"]:
            lead.first_name = data["full_name"]
            changed = True
        if data["email"] and not lead.email:
            lead.email = data["email"]
            changed = True
        if data["phone"] and not lead.mobile_no and not lead.phone:
            lead.mobile_no = data["phone"]
            changed = True
        if changed:
            lead.save()
        return lead, True

    # Do not bypass CRM Lead permissions. CRM's per-record rule uses
    # lead_owner (not the Frappe Document.owner). Assign the new Lead to the
    # staff member who is providing this consultation.
    if not frappe.has_permission("CRM Lead", "create"):
        frappe.throw("Bạn không có quyền tạo CRM Lead.", frappe.PermissionError)

    lead = frappe.get_doc({
        "doctype": "CRM Lead",
        "first_name": data["full_name"],
        "email": data["email"],
        "mobile_no": data["phone"],
        "status": "New",
        "lead_owner": frappe.session.user,
    })
    lead.insert()
    # Ensure that the newly created Lead is visible to the caller through
    # CRM's actual ownership/organization hierarchy rules.
    _check_lead_access(lead.name)
    return lead, False


def _save_profile(data, lead_name):
    """Create or update exactly one current Beauty Profile for a CRM Lead."""
    existing_profiles = frappe.db.sql(
        "SELECT name FROM `tabBeauty Profile` WHERE crm_lead = %s FOR UPDATE",
        (lead_name,),
        as_dict=True,
    )
    profile_name = existing_profiles[0].name if existing_profiles else None

    if profile_name:
        profile = frappe.get_doc("Beauty Profile", profile_name)
        is_new = False
    else:
        profile = frappe.new_doc("Beauty Profile")
        is_new = True

    fields = (
        "full_name", "skin_type", *CONCERN_FIELDS,
        "sensitivity", "requested_category", "max_budget",
        *AVOID_FIELDS, "preferred_brand", "consent",
    )
    for field in fields:
        profile.set(field, data[field])
    profile.crm_lead = lead_name
    profile.status = "Active"

    if is_new:
        # Internal DocType permissions stay limited to System Manager.
        # Authorization has already been enforced on the backing CRM Lead.
        profile.insert(ignore_permissions=True)
    else:
        profile.save(ignore_permissions=True)
    return profile


@frappe.whitelist(methods=["POST"])
def save_beauty_profile(payload):
    """Validate, identify Lead, and save a single idempotent consultation.

    Returns {crm_lead, beauty_profile, request_id, profile_version,
    is_existing_lead}. Does not create a Recommendation Session or CRM Task.

    Authenticated Sales User / Sales Manager / System Manager roles may use
    the endpoint, but any existing Lead must pass CRM record-level read AND
    write checks; internal documents never gain broad client-side permissions.
    """
    _check_consultation_role()
    data = _validate_payload(payload)
    _lock_submission(data)

    request_id = data["request_id"]
    payload_hash = _payload_hash(data)

    existing_rows = frappe.db.sql(
        "SELECT name FROM `tabConsultation Submission` "
        "WHERE request_id = %s FOR UPDATE",
        (request_id,),
        as_dict=True,
    )
    existing_name = existing_rows[0].name if existing_rows else None
    if existing_name:
        submission = frappe.get_doc("Consultation Submission", existing_name)
        # A guessed/leaked UUID must never grant access to another user's
        # previously saved response. Check the linked Lead BEFORE returning
        # any response or revealing whether payload content matches.
        _check_lead_access(submission.crm_lead)
        if submission.payload_hash != payload_hash:
            raise RequestConflictError(
                "REQUEST_CONFLICT: request_id đã được sử dụng với dữ liệu tư vấn khác."
            )
        return json.loads(submission.response_json)

    lead_name = _find_existing_lead(data)
    lead, is_existing = _save_lead(data, lead_name)
    profile = _save_profile(data, lead.name)

    response = {
        "crm_lead": lead.name,
        "beauty_profile": profile.name,
        "request_id": request_id,
        "profile_version": str(profile.modified),
        "is_existing_lead": is_existing,
    }

    submission = frappe.get_doc({
        "doctype": "Consultation Submission",
        "request_id": request_id,
        "payload_hash": payload_hash,
        "crm_lead": lead.name,
        "beauty_profile": profile.name,
        "profile_version": response["profile_version"],
        "response_json": json.dumps(response, ensure_ascii=False),
    })
    # Backend-controlled record; never grant blanket Sales User access.
    submission.insert(ignore_permissions=True)
    return response
