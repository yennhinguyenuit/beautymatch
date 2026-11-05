"""Offline regression tests for the native CRM shell extension boundary."""

import importlib.util
import sys
import unittest
from pathlib import Path
from types import ModuleType
from unittest.mock import Mock, patch


class NativeTemplatePage:
	def __init__(self, path, http_status_code=None):
		self.path = path
		self.app = "crm"
		self.app_path = "/bench/apps/crm/crm"
		self.template_path = "www/crm.html"
		self.source = ""

	def can_render(self):
		return True

	def get_raw_template(self):
		return self.source

	def render(self):
		return "native lifecycle: authentication, context, boot, CSRF"


class TestCRMRenderer(unittest.TestCase):
	def setUp(self):
		self.frappe = ModuleType("frappe")
		self.frappe.get_app_path = Mock(return_value="/bench/apps/crm/crm")
		self.frappe.logger = Mock()
		template = ModuleType("frappe.website.page_renderers.template_page")
		template.TemplatePage = NativeTemplatePage
		with patch.dict(sys.modules, {"frappe": self.frappe, template.__name__: template}):
			spec = importlib.util.spec_from_file_location(
				"crm_renderer_under_test",
				Path(__file__).parents[1] / "beautymatch/website/crm_renderer.py",
			)
			self.module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(self.module)
		self.page = self.module.BeautyMatchCRMPage("crm")

	def test_intercepts_only_the_installed_crm_shell(self):
		self.assertTrue(self.page.can_render())
		for path in ("beautymatch", "crm-form", "crm/leads", "app", "login", ""):
			self.page.path = path
			self.assertFalse(self.page.can_render(), path)
		self.page.path = "crm"
		for attribute, changed in (("app", "other"), ("app_path", "/other/crm"), ("template_path", "www/crm_form.html")):
			original = getattr(self.page, attribute)
			setattr(self.page, attribute, changed)
			self.assertFalse(self.page.can_render(), attribute)
			setattr(self.page, attribute, original)

	def test_inherits_native_authentication_and_render_lifecycle(self):
		self.assertNotIn("render", self.module.BeautyMatchCRMPage.__dict__)
		self.assertNotIn("get_context", self.module.BeautyMatchCRMPage.__dict__)
		self.assertEqual(self.page.render(), NativeTemplatePage.render(self.page))

	def test_preserves_boot_csrf_native_assets_and_html_attributes(self):
		self.page.source = '''<!doctype html><html class="h-full" lang="vi" data-theme="light"><head>
<script type="module" crossorigin src="/assets/crm/frontend/assets/index-HASH.js"></script>
<link rel="stylesheet" href="/assets/crm/frontend/assets/index-HASH.css">
</head><body class="no-scrollbar"><div id="app"></div><script>
{% for key in boot %}window["{{ key }}"] = {{ boot[key] | tojson }};{% endfor %}
</script><!-- csrf_token --></body></html>'''
		result = self.page.get_raw_template()
		self.assertIn('class="h-full bm-crm" lang="vi" data-theme="light"', result)
		self.assertEqual(result.count('id="beautymatch-crm-theme"'), 1)
		self.assertEqual(result.count('id="beautymatch-crm-runtime"'), 1)
		self.assertIn("?v=crm-botanical-20261105", result)
		self.assertLess(result.index("index-HASH.css"), result.index("crm-botanical.css"))
		for native in (
			'/assets/crm/frontend/assets/index-HASH.js',
			'<body class="no-scrollbar"><div id="app"></div>',
			'{% for key in boot %}window["{{ key }}"] = {{ boot[key] | tojson }};{% endfor %}',
			'<!-- csrf_token -->',
		):
			self.assertIn(native, result)

	def test_decoration_is_idempotent_and_respects_class_quoting(self):
		for root in ('<html lang="vi">', "<HTML class='h-full' lang='vi'>", '<html class=h-full>', '<html data-class="keep" class="h-full bm-crm">'):
			source = f"{root}<head><title>CRM</title></head><body></body></html>"
			result = self.module._inject_crm_assets(source)
			self.assertEqual(self.module._inject_crm_assets(result), result)
			self.assertEqual(result.count("bm-crm"), 1)
			if "data-class" in source:
				self.assertIn('data-class="keep"', result)

	def test_unknown_upstream_shell_fails_open_and_logs_no_page_data(self):
		for source in ("<div>different shell {{ boot }}</div>", "<head></head><html><body>invalid</body></html>"):
			self.page.source = source
			self.assertEqual(self.page.get_raw_template(), source)
			warning = self.frappe.logger.return_value.warning.call_args.args[0]
			self.assertNotIn("boot", warning)
		self.frappe.logger.side_effect = RuntimeError("logging unavailable")
		self.assertEqual(self.page.get_raw_template(), self.page.source)


if __name__ == "__main__":
	unittest.main()
