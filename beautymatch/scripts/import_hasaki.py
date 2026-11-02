"""Import the verified BeautyMatch Hasaki snapshot into Frappe Product Profile.

Install this module at: <beautymatch-repo>/beautymatch/scripts/import_hasaki.py
Place CSV at: <beautymatch-repo>/data/BeautyMatch_Hasaki_Dataset_Verified.csv

From ~/frappe-bench (inside the Frappe Docker container):
    bench --site crm.localhost execute beautymatch.scripts.import_hasaki.import_products --kwargs '{"dry_run": true}'
    bench --site crm.localhost execute beautymatch.scripts.import_hasaki.import_products --kwargs '{"dry_run": false}'

Run the dry-run first. Re-running the import updates existing products by unique
product_code; it does not add a second copy of the same product.
"""

from __future__ import annotations

import csv
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path


CSV_NAME = "BeautyMatch_Hasaki_Dataset_Verified.csv"
DEFAULT_CSV = Path(__file__).resolve().parents[2] / "data" / CSV_NAME

# Map every CSV column explicitly to the field name in the Frappe DocType.
CSV_TO_FRAPPE = {
    "product_code": "product_code",
    "product_name": "product_name",
    "brand": "brand",
    "category": "category",
    "price": "price",
    "product_url": "product_url",
    "image_url": "image_url",
    "skin_oily": "suitable_oily",
    "skin_dry": "suitable_dry",
    "skin_combination": "suitable_combination",
    "skin_normal": "suitable_normal",
    "skin_all": "suitable_all_skin",
    "sensitive": "suitable_sensitive",
    "concern_oil": "concern_oil_control",
    "concern_acne": "concern_acne",
    "concern_post_acne": "concern_post_acne",
    "concern_dehydration": "concern_dehydration",
    "concern_barrier": "concern_barrier",
    "concern_dullness": "concern_dullness",
    "concern_aging": "concern_aging",
    "key_ingredients": "key_ingredients",
    "ingredient_concern_tags": "ingredient_concern_tags",
    "fragrance": "contains_fragrance",
    "alcohol_denat": "contains_alcohol_denat",
    "essential_oil": "contains_essential_oil",
    "source_url": "source_url",
    "data_as_of": "data_as_of",
    "data_completeness": "data_completeness",
    "status": "status",
}

CHECK_COLUMNS = {
    "skin_oily", "skin_dry", "skin_combination", "skin_normal", "skin_all",
    "sensitive", "concern_oil", "concern_acne", "concern_post_acne",
    "concern_dehydration", "concern_barrier", "concern_dullness", "concern_aging",
}
AVOID_COLUMNS = {"fragrance", "alcohol_denat", "essential_oil"}
CATEGORIES = {"CLEANSER", "TONER", "SERUM", "MOISTURIZER", "SUNSCREEN"}
STATUSES = {"Active", "Inactive"}
AVOID_VALUES = {"Yes", "No", "Unknown"}
REQUIRED_TEXT = {"product_code", "product_name", "brand"}
URL_COLUMNS = {"product_url", "image_url", "source_url"}


def _convert(column: str, raw: str, line: int):
    val = (raw or "").strip()
    if column in REQUIRED_TEXT:
        if not val:
            raise ValueError(f"CSV dong {line}: thieu {column}")
        if column == "product_code" and len(val) > 140:
            raise ValueError(f"CSV dong {line}: product_code qua dai")
        return val
    if column == "category":
        if val not in CATEGORIES:
            raise ValueError(f"CSV dong {line}: category khong hop le: {val!r}")
        return val
    if column == "status":
        if val not in STATUSES:
            raise ValueError(f"CSV dong {line}: status khong hop le: {val!r}")
        return val
    if column in CHECK_COLUMNS:
        if val not in {"0", "1"}:
            raise ValueError(f"CSV dong {line}: {column} phai la 0 hoac 1, nhan {val!r}")
        return int(val)
    if column in AVOID_COLUMNS:
        if val not in AVOID_VALUES:
            raise ValueError(f"CSV dong {line}: {column} phai la Yes/No/Unknown, nhan {val!r}")
        return val
    if column == "price":
        try:
            num = Decimal(val)
        except InvalidOperation as exc:
            raise ValueError(f"CSV dong {line}: gia khong phai so: {val!r}") from exc
        if not num.is_finite() or num <= 0 or num != num.to_integral_value():
            raise ValueError(f"CSV dong {line}: gia phai la so nguyen duong: {val!r}")
        return int(num)
    if column == "data_completeness":
        try:
            num = Decimal(val)
        except InvalidOperation as exc:
            raise ValueError(f"CSV dong {line}: data_completeness khong hop le: {val!r}") from exc
        if not num.is_finite() or not (0 <= num <= 100):
            raise ValueError(f"CSV dong {line}: data_completeness phai trong [0, 100]")
        return float(num)
    if column == "data_as_of":
        try:
            parsed = date.fromisoformat(val)
        except ValueError as exc:
            raise ValueError(f"CSV dong {line}: data_as_of phai co dang YYYY-MM-DD") from exc
        if parsed > date.today():
            raise ValueError(f"CSV dong {line}: ngay snapshot nam trong tuong lai")
        return parsed.isoformat()
    if column in URL_COLUMNS:
        if val and not val.startswith(("https://", "http://")):
            raise ValueError(f"CSV dong {line}: URL khong hop le trong {column}: {val!r}")
        return val
    return val  # Keep descriptive ingredient fields exactly as supplied.


def read_and_validate(csv_path: str | Path = DEFAULT_CSV) -> list[dict]:
    """Read and validate entire snapshot *before* writing any database records."""
    source = Path(csv_path)
    if not source.is_file():
        raise FileNotFoundError(f"Khong tim thay CSV: {source}")

    output = []
    seen = set()
    with source.open("r", encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if reader.fieldnames is None:
            raise ValueError("CSV khong co header")
        observed = set(reader.fieldnames)
        expected = set(CSV_TO_FRAPPE)
        if len(reader.fieldnames) != 29 or observed != expected:
            raise ValueError(
                "CSV khong dung 29 cot. "
                f"Thieu: {sorted(expected - observed)}; "
                f"Thua: {sorted(observed - expected)}"
            )
        for line, raw_row in enumerate(reader, start=2):
            if None in raw_row:
                raise ValueError(f"CSV dong {line}: thua cot, can kiem tra dau phay/dau nhay")
            if not any((v or "").strip() for v in raw_row.values()):
                continue
            mapped = {
                dest: _convert(src, raw_row[src], line)
                for src, dest in CSV_TO_FRAPPE.items()
            }
            code = mapped["product_code"]
            if code in seen:
                raise ValueError(f"CSV dong {line}: trung product_code {code!r}")
            seen.add(code)
            output.append(mapped)
    if not output:
        raise ValueError("CSV khong co dong san pham")
    return output


def _equal(field: str, current, incoming) -> bool:
    if field in {"price", "data_completeness"}:
        try:
            return Decimal(str(current or 0)) == Decimal(str(incoming))
        except InvalidOperation:
            return False
    if field in {CSV_TO_FRAPPE[src] for src in CHECK_COLUMNS}:
        return str(int(current or 0)) == str(incoming)
    if field == "data_as_of":
        return str(current or "")[:10] == str(incoming)
    return str(current or "").strip() == str(incoming or "").strip()


def import_products(dry_run: bool = True, csv_path: str | None = None):
    """Validate CSV, then insert/update Product Profile by product_code.

    dry_run=True: validation and count only, database is NOT modified.
    dry_run=False: write changes and commit one transaction.
    """
    source = csv_path or str(DEFAULT_CSV)
    rows = read_and_validate(source)
    active = sum(row["status"] == "Active" for row in rows)
    inactive = len(rows) - active
    print(f"CSV OK: {len(rows)} products; {active} Active, {inactive} Inactive")
    print(f"CSV path: {source}")
    if dry_run:
        print("DRY RUN: Du lieu hop le. KHONG ghi vao database.")
        return {"validated": len(rows), "active": active, "inactive": inactive, "dry_run": True}

    import frappe

    meta = frappe.get_meta("Product Profile")
    missing = sorted(set(CSV_TO_FRAPPE.values()) - {f.fieldname for f in meta.fields})
    if missing:
        raise ValueError(f"DocType Product Profile con thieu field: {missing}")

    inserted = updated = unchanged = 0
    try:
        for fields in rows:
            code = fields["product_code"]
            existing_name = frappe.db.get_value(
                "Product Profile", {"product_code": code}, "name"
            )
            if existing_name:
                doc = frappe.get_doc("Product Profile", existing_name)
                changes = {
                    key: value for key, value in fields.items()
                    if not _equal(key, doc.get(key), value)
                }
                if changes:
                    doc.update(changes)
                    doc.save(ignore_permissions=True)
                    updated += 1
                else:
                    unchanged += 1
            else:
                doc = frappe.get_doc({"doctype": "Product Profile", **fields})
                doc.insert(ignore_permissions=True)
                inserted += 1
        frappe.db.commit()
    except Exception:
        frappe.db.rollback()
        raise

    total = frappe.db.count("Product Profile")
    print(f"DONE: inserted={inserted}, updated={updated}, unchanged={unchanged}")
    print(f"Product Profile rows currently in database: {total}")
    return {
        "validated": len(rows), "inserted": inserted, "updated": updated,
        "unchanged": unchanged, "db_total": total, "dry_run": False,
    }
