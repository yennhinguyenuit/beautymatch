"""Add isolated, labeled catalog examples only on a local developer site.

Never runs from an install/migrate hook, never updates existing products.
"""

import csv
from pathlib import Path

import frappe

from beautymatch.api.profile import _check_consultation_role
from beautymatch.api.recommendation import PROFILE_FIELDS
from beautymatch.scripts.import_hasaki import read_and_validate
from beautymatch.services.matching_engine import match_products


def prepare():
	if not frappe.conf.developer_mode or not frappe.local.site.endswith(".localhost"):
		frappe.throw("Chỉ được chuẩn bị dữ liệu demo trên site .localhost có developer_mode.", frappe.PermissionError)
	frappe.only_for("System Manager")
	selected = {"HASAKI-SER-001", "HASAKI-SER-008", "HASAKI-SER-013"}
	inserted = []
	for fields in read_and_validate():
		if fields["product_code"] not in selected:
			continue
		fields = dict(fields)
		fields["product_code"] = "BM-DEMO-" + fields["product_code"]
		if frappe.db.exists("Product Profile", {"product_code": fields["product_code"]}):
			continue
		fields["product_name"] += " · Mẫu trình diễn"
		frappe.get_doc({"doctype": "Product Profile", **fields}).insert()
		inserted.append(fields["product_code"])
	return {"inserted": inserted, "existing_catalog_updated": 0, "site": frappe.local.site}


@frappe.whitelist(methods=["POST"])
def get_scenarios():
	"""Find actual affordable 0/1/2/3-result profiles; these are input presets only."""
	_check_consultation_role()
	path = Path(__file__).resolve().parents[2] / "tests/fixtures/customer_profiles_matching_only.csv"
	with path.open(encoding="utf-8-sig") as source:
		base = next(row for row in csv.DictReader(source) if row["fixture_customer_key"] == "BM-CUS-003")
	products = frappe.get_all("Product Profile", filters={"status": "Active"}, fields=["*"], limit_page_length=0)
	settings = frappe.get_doc("BeautyMatch Settings")
	budgets = sorted({1, 2000000, *(int(row.price) for row in products if row.category == "SERUM")})
	scenarios = {}
	for budget in budgets:
		candidate = {**base, "max_budget": budget, "requested_category": "SERUM"}
		count = len(match_products(candidate, products, settings)["results"])
		if str(count) not in scenarios:
			scenarios[str(count)] = {key: candidate.get(key) for key in PROFILE_FIELDS}
	return {"scenarios": scenarios, "notice": "Thông số mẫu được kiểm tra với catalog hiện tại; kết quả vẫn được tạo và lưu qua API thật."}
