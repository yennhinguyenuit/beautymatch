"""Regression: Administrator inherits all roles, including the customer role."""
import importlib.util
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest import TestCase
from unittest.mock import patch


class PortalAccessTest(TestCase):
    def setUp(self):
        self.user = "Administrator"
        self.kind = "System User"
        self.path = "/crm/beautymatch"
        self.fake = ModuleType("frappe")
        self.fake.whitelist = lambda **kwargs: lambda fn: fn
        self.fake.session = SimpleNamespace(user=self.user)
        self.fake.local = SimpleNamespace(request=SimpleNamespace(path=self.path))
        self.fake.get_roles = lambda *args: ["BeautyMatch Customer", "System Manager"]
        self.fake.db = SimpleNamespace(get_value=lambda *args: self.kind)
        self.fake.PermissionError = PermissionError
        def throw(message, exc):
            raise exc(message)
        self.fake.throw = throw
        recommendation = ModuleType("beautymatch.api.recommendation")
        recommendation.PROFILE_FIELDS = ()
        profile = ModuleType("beautymatch.api.profile")
        spec = importlib.util.spec_from_file_location("portal_guard_regression", Path(__file__).parents[1] / "beautymatch/api/portal.py")
        self.module = importlib.util.module_from_spec(spec)
        with patch.dict("sys.modules", {"frappe": self.fake, "beautymatch.api.recommendation": recommendation, "beautymatch.api.profile": profile}):
            spec.loader.exec_module(self.module)

    def test_administrator_is_allowed_even_with_customer_role(self):
        self.module.restrict_customer_crm()

    def test_authenticated_website_customer_is_denied_crm(self):
        self.fake.session.user = "customer.demo@example.invalid"
        self.kind = "Website User"
        with self.assertRaises(PermissionError):
            self.module.restrict_customer_crm()

    def test_customer_portal_is_allowed(self):
        self.fake.session.user = "customer.demo@example.invalid"
        self.kind = "Website User"
        self.fake.local.request.path = "/beautymatch/portal"
        self.module.restrict_customer_crm()

    def test_guest_uses_existing_crm_auth_flow(self):
        self.fake.session.user = "Guest"
        self.module.restrict_customer_crm()
