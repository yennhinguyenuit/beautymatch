"""Add isolated, labeled catalog examples only on a local developer site.

Never runs from an install/migrate hook, never updates research products.
Only missing photos on the exact labeled demo copies can be backfilled.
"""

import csv
import hashlib
import json
from pathlib import Path

import frappe

from beautymatch.api.profile import _check_consultation_role
from beautymatch.api.recommendation import PROFILE_FIELDS
from beautymatch.scripts.import_hasaki import read_and_validate
from beautymatch.services.matching_engine import match_products


def _with_verified_image(fields):
	"""Resolve a missing demo image only from an exact-product cached source.

	The research CSV stays untouched. The manifest records the product page
	where its og:image was verified and the SHA256 of the unchanged PNG.
	"""
	fields = dict(fields)
	if fields.get("image_url"):
		return fields
	public = Path(__file__).resolve().parents[1] / "public"
	manifest = json.loads((public / "images/catalog/manifest.json").read_text(encoding="utf-8"))
	for image in manifest:
		if image["product_code"] != fields["product_code"]:
			continue
		if not image.get("source_page") or image["source_page"] != fields["product_url"]:
			raise ValueError("Demo photo provenance does not match the catalog product page.")
		asset = public / image["local_url"].removeprefix("/assets/beautymatch/")
		if hashlib.sha256(asset.read_bytes()).hexdigest() != image["sha256"]:
			raise ValueError("Demo photo bytes do not match the verified source.")
		fields["image_url"] = image["source_url"]
		break
	return fields


def prepare():
	if not frappe.conf.developer_mode or not frappe.local.site.endswith(".localhost"):
		frappe.throw("Chỉ được chuẩn bị dữ liệu demo trên site .localhost có developer_mode.", frappe.PermissionError)
	frappe.only_for("System Manager")
	selected = {"HASAKI-SER-001", "HASAKI-SER-008", "HASAKI-SER-013"}
	inserted = []
	images_updated = []
	for fields in read_and_validate():
		if fields["product_code"] not in selected:
			continue
		fields = _with_verified_image(fields)
		fields["product_code"] = "BM-DEMO-" + fields["product_code"]
		fields["product_name"] += " · Mẫu trình diễn"
		existing = frappe.db.get_value("Product Profile", {"product_code": fields["product_code"]}, "name")
		if existing:
			doc = frappe.get_doc("Product Profile", existing)
			if not doc.image_url and fields.get("image_url"):
				if any(doc.get(key) != fields[key] for key in ("product_name", "product_url", "brand", "category")):
					frappe.throw("Sản phẩm demo không khớp nguồn; không tự bổ sung ảnh.")
				doc.image_url = fields["image_url"]
				doc.save()
				images_updated.append(fields["product_code"])
			continue
		frappe.get_doc({"doctype": "Product Profile", **fields}).insert()
		inserted.append(fields["product_code"])
	return {"inserted": inserted, "demo_images_updated": images_updated, "existing_catalog_updated": 0, "site": frappe.local.site}


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
