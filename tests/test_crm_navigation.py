"""The sidebar capability neither grants business permissions nor returns CRM data."""

import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock, patch


class TestCRMNavigation(unittest.TestCase):
	def setUp(self):
		self.frappe = ModuleType("frappe")
		self.frappe.PermissionError = PermissionError
		self.frappe.whitelist = lambda **kwargs: lambda fn: fn
		self.frappe.has_permission = Mock(return_value=True)
		self.profile = ModuleType("beautymatch.api.profile")
		self.profile._check_consultation_role = Mock()
		with patch.dict(sys.modules, {"frappe": self.frappe, self.profile.__name__: self.profile}):
			spec = importlib.util.spec_from_file_location(
				"navigation_under_test", Path(__file__).parents[1] / "beautymatch/api/navigation.py"
			)
			self.module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(self.module)

	def test_authorized_staff_receive_only_public_route(self):
		self.assertEqual(self.module.get_sidebar_entry(), {
			"label": "BeautyMatch", "href": "/crm/beautymatch", "icon": "leaf",
		})
		self.profile._check_consultation_role.assert_called_once_with()
		self.frappe.has_permission.assert_called_once_with("CRM Lead", "read")

	def test_denied_consultation_role_never_receives_navigation(self):
		self.profile._check_consultation_role.side_effect = PermissionError
		self.assertIsNone(self.module.get_sidebar_entry())
		self.frappe.has_permission.assert_not_called()

	def test_allowed_role_without_lead_read_permission_is_denied(self):
		self.frappe.has_permission.return_value = False
		self.assertIsNone(self.module.get_sidebar_entry())

	def test_unexpected_permission_errors_are_not_converted_into_access(self):
		self.frappe.has_permission.side_effect = RuntimeError("Unavailable")
		with self.assertRaises(RuntimeError):
			self.module.get_sidebar_entry()
