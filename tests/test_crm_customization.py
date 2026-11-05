"""Offline safeguards for additive CRM customization metadata."""

import importlib.util
import json
import sys
import unittest
from copy import deepcopy
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch


class TestCRMCustomization(unittest.TestCase):
	def setUp(self):
		self.frappe = ModuleType("frappe")
		self.frappe.db = Mock()
		self.frappe.db.exists.return_value = "present"
		self.meta = Mock()
		self.meta.has_field.return_value = True
		self.meta.get_field.return_value = None
		self.frappe.get_meta = Mock(return_value=self.meta)
		self.frappe.get_doc = Mock()
		self.frappe.get_single = Mock()
		self.frappe.throw = Mock(side_effect=ValueError)
		with patch.dict(sys.modules, {"frappe": self.frappe}):
			spec = importlib.util.spec_from_file_location(
				"crm_customization_under_test",
				Path(__file__).parents[1] / "beautymatch/config/crm_customization.py",
			)
			self.module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(self.module)
		self.native_sections = [{
			"name": "customer_details", "label": "Customer details", "opened": False,
			"custom_flag": {"untouched": True},
			"columns": [{"name": "original", "fields": ["first_name", "email"]}],
		}]

	def test_sidebar_merge_preserves_every_native_value_and_is_idempotent(self):
		original = deepcopy(self.native_sections)
		merged, changed = self.module._merge_side_panel(self.native_sections)
		self.assertTrue(changed)
		self.assertEqual(merged[1:], original)
		self.assertEqual(self.native_sections, original)
		self.assertEqual(merged[0]["name"], "beautymatch_insights")
		self.assertTrue(merged[0]["opened"])
		again, changed = self.module._merge_side_panel(merged)
		self.assertFalse(changed)
		self.assertEqual(again, merged)

	def test_sidebar_respects_existing_admin_placement(self):
		self.native_sections[0]["columns"][0]["fields"].append("beautymatch_insights")
		merged, changed = self.module._merge_side_panel(self.native_sections)
		self.assertFalse(changed)
		self.assertEqual(merged, self.native_sections)
		with self.assertRaises(ValueError):
			self.module._merge_side_panel([])

	def test_dropdown_preserves_rows_flags_and_existing_hidden_entry(self):
		items = [{"name": "native-row", "label": "Settings", "is_standard": 1, "hidden": 0}, {"label": "Company", "route": "/company", "open_in_new_window": 1}]
		original = deepcopy(items)
		merged, changed = self.module._merge_dropdown_items(items)
		self.assertTrue(changed)
		self.assertEqual(merged[:-1], original)
		self.assertEqual(items, original)
		self.assertNotIn("name1", merged[-1])
		merged[-1].update(hidden=1, label="Admin preference", route="/beautymatch/")
		again, changed = self.module._merge_dropdown_items(merged)
		self.assertFalse(changed)
		self.assertEqual(again, merged)

	def test_custom_company_identity_is_preserved(self):
		self.assertEqual(self.module._brand_changes("My Spa", None), {})
		self.assertEqual(self.module._brand_changes("My Spa", "/files/spa.svg"), {})
		self.assertEqual(self.module._brand_changes("BeautyMatch CRM", "/files/custom.svg"), {})
		self.assertEqual(self.module._brand_changes("Frappe CRM", "/files/custom.svg"), {"brand_name": "BeautyMatch CRM"})
		self.assertEqual(self.module._brand_changes(None, None), {"brand_name": "BeautyMatch CRM", "brand_logo": self.module.LOGO})
		self.assertEqual(self.module._brand_changes("BeautyMatch", None), {"brand_logo": self.module.LOGO})

	def test_missing_crm_features_report_unsupported_without_writes(self):
		self.frappe.db.exists.return_value = None
		report = self.module.install()
		self.assertFalse(report["installed"])
		self.assertFalse(report["changed"])
		self.frappe.get_doc.assert_not_called()
		self.frappe.get_single.assert_not_called()

	def test_conflicting_field_type_fails_before_any_write(self):
		self.meta.get_field.return_value = SimpleNamespace(fieldtype="Data")
		with self.assertRaises(ValueError):
			self.module.install()
		self.frappe.get_doc.assert_not_called()
		self.frappe.get_single.assert_not_called()

	def test_missing_native_sidebar_is_not_replaced_with_an_incomplete_layout(self):
		self.frappe.db.exists.side_effect = lambda dt, value: None if dt == "CRM Fields Layout" else "present"
		report = self.module._install_side_panel({"side_panel": True}, True)
		self.assertFalse(report["supported"])
		self.frappe.get_doc.assert_not_called()

	def test_existing_sidebar_saves_only_when_owned_field_is_missing(self):
		doc = SimpleNamespace(layout=json.dumps(self.native_sections), save=Mock())
		self.frappe.get_doc.return_value = doc
		self.assertTrue(self.module._install_side_panel({"side_panel": True}, True)["changed"])
		self.assertEqual(json.loads(doc.layout)[1:], self.native_sections)
		doc.save.assert_called_once_with(ignore_permissions=True)
		self.assertFalse(self.module._install_side_panel({"side_panel": True}, True)["changed"])
		doc.save.assert_called_once()


if __name__ == "__main__":
	unittest.main()
