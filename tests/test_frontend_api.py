"""Offline tests of frontend projections; these do not replace Frappe acceptance tests."""

import importlib.util
import ast
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
		self.frappe.db = Mock()
		self.frappe.db.exists.return_value = False
		self.frappe.db.get_single_value.return_value = "Asia/Ho_Chi_Minh"
		self.dashboard = ModuleType("beautymatch.api.dashboard")
		self.dashboard.get_dashboard_data = Mock(return_value={
			"kpis": {"total_sessions": 2, "leads_with_profile": 1, "interest_rate": 50, "average_top1_score": 81},
			"charts": {"top_skin_concerns": [{"skin_concern": "Acne", "count": 1}], "top_interested_products": []},
		})
		self.profile = ModuleType("beautymatch.api.profile")
		self.profile.CONCERN_FIELDS = ("concern_acne", "concern_barrier")
		self.profile._check_consultation_role = Mock()
		self.profile._check_lead_access = Mock()
		self.profile._check_lead_access.return_value = SimpleNamespace(name="LEAD-1",get=lambda key: "Test Customer" if key=="first_name" else None)
		self.summary = ModuleType("beautymatch.api.lead_summary")
		self.summary.get_lead_summary = Mock(return_value={"history": []})
		self.recommendation = ModuleType("beautymatch.api.recommendation")
		self.recommendation.PROFILE_FIELDS = ("skin_type", "concern_acne")
		self.recommendation.get_customer_history = Mock(return_value={"sessions": []})
		self.recommendation.get_recommendation_result = Mock(return_value={"results": []})
		modules = {"frappe": self.frappe, "beautymatch.api.dashboard": self.dashboard, "beautymatch.api.lead_summary": self.summary,
			"beautymatch.api.profile": self.profile, "beautymatch.api.recommendation": self.recommendation}
		with patch.dict(sys.modules, modules):
			spec = importlib.util.spec_from_file_location("frontend_under_test", Path(__file__).parents[1] / "beautymatch/api/frontend.py")
			self.module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(self.module)

	def test_context_checks_access_before_catalog_and_excludes_contacts(self):
		self.frappe.get_doc.return_value = SimpleNamespace(crm_lead="LEAD-1",creation="2026-11-05T10:00:00+07:00", profile_snapshot=json.dumps({"skin_type": "DRY", "email": "private", "full_name": "private"}), recommendation_items=[SimpleNamespace(name="ITEM-1",product="P1",customer_feedback="None",follow_up_task=None)])
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
		self.recommendation.get_customer_history.assert_called_once_with(crm_lead="L", start=20, limit=20)

	def test_feedback_filter_precedes_pagination_and_uses_filtered_count(self):
		self.module.get_customer_context = Mock(return_value={"crm_lead": "LEAD-1"})
		self.frappe.db.sql.side_effect = [[(31,)], [SimpleNamespace(name="OLD-FEEDBACK")]]
		self.recommendation.get_recommendation_result.return_value = {"session_id": "OLD-FEEDBACK", "results": []}
		self.frappe.get_doc.return_value = SimpleNamespace(creation="2026-11-05T10:00:00+07:00", recommendation_items=[])
		history = self.module.get_customer_view("LEAD-1", start=20, feedback_only=True)["history"]
		self.assertEqual(history["total"], 31)
		self.assertEqual(history["sessions"][0]["session_id"], "OLD-FEEDBACK")
		query, params = self.frappe.db.sql.call_args.args
		self.assertLess(query.index("EXISTS"), query.index("LIMIT"))
		self.assertEqual(params, ("LEAD-1", 10, 20))
		self.recommendation.get_customer_history.assert_not_called()

	def test_feedback_history_checks_lead_access_before_sql(self):
		self.profile._check_lead_access.side_effect = PermissionError
		with self.assertRaises(PermissionError):
			self.module.get_customer_view("OTHER", feedback_only=True)
		self.frappe.db.sql.assert_not_called()

	def test_dashboard_delegates_task4_metrics_without_changing_semantics(self):
		result = self.module.get_dashboard_data()
		self.assertIs(result, self.dashboard.get_dashboard_data.return_value)
		self.dashboard.get_dashboard_data.assert_called_once_with()
		self.frappe.get_all.assert_not_called()

	def test_dashboard_retains_backend_permission_errors(self):
		self.dashboard.get_dashboard_data.side_effect = PermissionError
		with self.assertRaises(PermissionError):
			self.module.get_dashboard_data()

	def test_numeric_crm_task_identifier_has_a_safe_authorized_link(self):
		self.frappe.db.exists.return_value = True
		self.frappe.has_permission = Mock(return_value=True)
		self.frappe.get_doc.return_value = SimpleNamespace(name=42,status="Todo")
		session = SimpleNamespace(recommendation_items=[SimpleNamespace(name="ITEM",follow_up_task="42",customer_feedback="Interested")])
		result = self.module._item_context(session)[0]
		self.assertEqual(result["task"]["url"], "/app/crm-task/42")
		self.assertEqual(result["follow_up_status"], "CREATED")
		self.frappe.has_permission.return_value=False
		self.assertIsNone(self.module._item_context(session)[0]["task"])

	def test_bridge_uses_actual_backend_export_names_and_signatures(self):
		root = Path(__file__).parents[1] / "beautymatch/api"
		for filename, expected in {
			"recommendation.py": {"get_customer_history": ["crm_lead", "limit", "start"], "get_recommendation_result": ["session_id"]},
			"feedback.py": {"submit_feedback": ["session_id", "item_id", "customer_feedback", "rejection_reason"]},
			"dashboard.py": {"get_dashboard_data": []},
		}.items():
			tree = ast.parse((root / filename).read_text(encoding="utf-8"))
			functions = {node.name: [arg.arg for arg in node.args.args] for node in tree.body if isinstance(node, ast.FunctionDef)}
			for name, arguments in expected.items():
				self.assertEqual(functions[name], arguments)
		self.module.read("get_recommendation_result", {"session_id": "SESSION"})
		self.recommendation.get_recommendation_result.assert_called_once_with(session_id="SESSION")


if __name__ == "__main__":
	unittest.main()
