"""Offline tests of frontend projections; these do not replace Frappe acceptance tests."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch


class TestFrontendProjection(unittest.TestCase):
	def setUp(self):
		self.frappe = ModuleType("frappe")
		self.frappe.whitelist = lambda **kwargs: lambda fn: fn
		self.frappe.ValidationError = ValueError
		self.frappe.throw = Mock(side_effect=lambda message, exc: (_ for _ in ()).throw(exc(message)))
		self.frappe.get_all = Mock()
		self.frappe.get_list = Mock(return_value=["LEAD-1"])
		self.frappe.get_doc = Mock()
		self.frappe.parse_json = json.loads
		self.dashboard = ModuleType("beautymatch.api.dashboard")
		self.dashboard.get_dashboard = Mock(return_value={
			"start_date": "2026-11-01", "end_date": "2026-11-05",
			"kpis": {"total_sessions": 2, "interested_rate": 50}, "charts": {},
		})
		self.profile = ModuleType("beautymatch.api.profile")
		self.profile.CONCERN_FIELDS = ("concern_acne", "concern_barrier")
		self.profile._check_consultation_role = Mock()
		self.profile._check_lead_access = Mock()
		self.recommendation = ModuleType("beautymatch.api.recommendation")
		self.recommendation.PROFILE_FIELDS = ("skin_type", "concern_acne")
		self.recommendation.get_consultation_history = Mock(return_value={"sessions": []})
		self.recommendation.get_recommendation_result = Mock(return_value={"results": []})
		modules = {"frappe": self.frappe, "beautymatch.api.dashboard": self.dashboard,
			"beautymatch.api.profile": self.profile, "beautymatch.api.recommendation": self.recommendation}
		with patch.dict(sys.modules, modules):
			spec = importlib.util.spec_from_file_location("frontend_under_test", Path(__file__).parents[1] / "beautymatch/api/frontend.py")
			self.module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(self.module)

	def test_context_checks_access_before_catalog_and_excludes_contacts(self):
		self.frappe.get_doc.return_value = SimpleNamespace(crm_lead="LEAD-1", profile_snapshot=json.dumps({"skin_type": "DRY", "email": "private", "full_name": "private"}), recommendation_items=[SimpleNamespace(product="P1")])
		self.frappe.get_all.return_value = [{"name": "P1", "image_url": "/files/p.png"}]
		result = self.module.get_result_context("SESSION")
		self.profile._check_lead_access.assert_called_once_with("LEAD-1")
		self.assertEqual(result["profile"], {"skin_type": "DRY", "concern_acne": None})
		self.assertNotIn("private", json.dumps(result))
		self.profile._check_lead_access.side_effect = PermissionError
		self.frappe.get_all.reset_mock()
		with self.assertRaises(PermissionError):
			self.module.get_result_context("SESSION")
		self.frappe.get_all.assert_not_called()

	def test_read_bridge_rejects_arbitrary_dispatch_and_extra_parameters(self):
		for operation in ("delete", "frappe.client.get", "submit_feedback"):
			with self.assertRaises(ValueError):
				self.module.read(operation, {})
		with self.assertRaises(ValueError):
			self.module.read("get_customer_history", {"crm_lead": "L", "ignore_permissions": True})
		self.module.read("get_customer_history", {"crm_lead": "L", "start": 20, "limit": 20})
		self.recommendation.get_consultation_history.assert_called_once_with(crm_lead="L", start=20, limit=20)

	def test_dashboard_aggregates_scoped_snapshots_scores_and_feedback(self):
		self.frappe.get_all.side_effect = [
			[SimpleNamespace(name="S1", crm_lead="LEAD-1", profile_snapshot='{"concern_acne":1}'), SimpleNamespace(name="S2", crm_lead="LEAD-1", profile_snapshot='{"concern_acne":1,"concern_barrier":1}')],
			[SimpleNamespace(crm_lead="LEAD-1"), SimpleNamespace(crm_lead="LEAD-1")],
			[SimpleNamespace(rank=1, final_match_score=90, customer_feedback="Interested", product="P", product_name_snapshot="Product"), SimpleNamespace(rank=1, final_match_score=80, customer_feedback="Not Interested", product="P", product_name_snapshot="Product"), SimpleNamespace(rank=2, final_match_score=50, customer_feedback="None", product="Q", product_name_snapshot="Other")],
		]
		result = self.module.get_dashboard_data("2026-11-01", "2026-11-05")
		self.assertEqual(result["kpis"]["leads_with_profile"], 1)
		self.assertEqual(result["kpis"]["interest_rate"], 50)
		self.assertEqual(result["kpis"]["average_top1_score"], 85)
		self.assertEqual(result["charts"]["top_skin_concerns"][0], {"concern": "concern_acne", "count": 2})
		self.assertEqual(result["charts"]["top_interested_products"], [{"product": "P", "product_name": "Product", "count": 1}])
		filters = self.frappe.get_all.call_args_list[0].kwargs["filters"]
		self.assertEqual(filters["crm_lead"], ["in", ["LEAD-1"]])
		self.assertEqual(filters["creation"][1][1], "2026-11-05 23:59:59.999999")

	def test_dashboard_with_no_visible_leads_does_not_query_private_tables(self):
		self.frappe.get_list.return_value = []
		result = self.module.get_dashboard_data()
		self.frappe.get_all.assert_not_called()
		self.assertIsNone(result["kpis"]["average_top1_score"])
		self.assertEqual(result["charts"]["top_interested_products"], [])


if __name__ == "__main__":
	unittest.main()
