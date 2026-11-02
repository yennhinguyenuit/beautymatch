
import csv
import uuid
from pathlib import Path

import frappe

from beautymatch.api.profile import save_beauty_profile


APP_ROOT = Path(__file__).resolve().parents[2]

SOURCE = APP_ROOT / "data" / "simulated" / "Customer Profiles.csv"

OUTPUT = (
    APP_ROOT
    / "data"
    / "simulated"
    / "customer_seed_mapping.csv"
)

NAMESPACE = uuid.UUID("c1a36a37-3b49-4a3a-8f79-bfd53dfce210")

CONCERN_FIELDS = [
    "concern_oil_control",
    "concern_acne",
    "concern_post_acne",
    "concern_dehydration",
    "concern_barrier",
    "concern_dullness",
    "concern_aging",
]

AVOID_FIELDS = [
    "avoid_fragrance",
    "avoid_alcohol_denat",
    "avoid_essential_oil",
]


def make_payload(row):
    key = row["fixture_customer_key"].strip()

    payload = {
        "full_name": row["full_name"],
        "email": row["email"],
        "phone": row["phone"],
        "skin_type": row["skin_type"],
        "sensitivity": row["sensitivity"],
        "requested_category": row["requested_category"],
        "max_budget": row["max_budget"],
        "preferred_brand": row["preferred_brand"],
        "consent": row["consent"],
        "request_id": str(uuid.uuid5(NAMESPACE, key)),
    }

    for field in CONCERN_FIELDS + AVOID_FIELDS:
        payload[field] = row[field]

    return payload


def seed():
    print("=== BEAUTYMATCH CUSTOMER SEED ===")

    if not SOURCE.exists():
        raise FileNotFoundError(SOURCE)

    with SOURCE.open(
        "r", encoding="utf-8-sig", newline=""
    ) as file:
        rows = list(csv.DictReader(file))

    print("Source rows:", len(rows))

    if len(rows) != 40:
        raise ValueError("Expected exactly 40 customer profiles.")

    original_user = frappe.session.user

    # Fixture setup chỉ dùng trên CRM local
    frappe.set_user("Administrator")

    mapping = []
    errors = []

    try:
        for index, row in enumerate(rows, start=1):
            key = row["fixture_customer_key"].strip()

            try:
                payload = make_payload(row)

                response = save_beauty_profile(payload)

                mapping.append({
                    "fixture_customer_key": key,
                    "crm_lead": response["crm_lead"],
                    "beauty_profile": response["beauty_profile"],
                    "request_id": response["request_id"],
                    "profile_version": response["profile_version"],
                })

                print(f"[{index}/40] OK: {key}")

            except Exception as error:
                errors.append((key, str(error)))
                print(f"[{index}/40] ERROR: {key} - {error}")
                break

        if errors:
            frappe.db.rollback()
            print("SEED ROLLED BACK")
            print("Errors:", errors)
            return

        # Chỉ commit khi tất cả 40 dòng thành công
        frappe.db.commit()

        with OUTPUT.open(
            "w", encoding="utf-8-sig", newline=""
        ) as file:
            writer = csv.DictWriter(
                file,
                fieldnames=list(mapping[0].keys()),
            )
            writer.writeheader()
            writer.writerows(mapping)

        print("=== SEED COMPLETED ===")
        print("Imported:", len(mapping))
        print("Mapping file:", OUTPUT)

    finally:
        frappe.set_user(original_user)
