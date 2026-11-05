"""Add the BeautyMatch theme to the installed CRM shell without copying it.

Frappe v15's ``page_renderer`` hook selects this renderer before TemplatePage.
Everything except the two asset tags and the root scope class is rendered by
the native TemplatePage, including CRM's controller, permissions and boot data.
"""

import re
from pathlib import Path

import frappe
from frappe.website.page_renderers.template_page import TemplatePage


RELEASE = "crm-botanical-20261105"
STYLE_ID = "beautymatch-crm-theme"
SCRIPT_ID = "beautymatch-crm-runtime"

_HTML_TAG = re.compile(r"<html\b(?:[^\"'>]|\"[^\"]*\"|'[^']*')*>", re.IGNORECASE)
_HEAD_END = re.compile(r"</head\s*>", re.IGNORECASE)
_CLASS = re.compile(
	r"(?<![\w:-])(class\s*=\s*)(?:([\"'])(.*?)\2|([^\s>]+))",
	re.IGNORECASE | re.DOTALL,
)


def _inject_crm_assets(source):
	"""Return a narrowly decorated native document, or None on unknown markup.

	The source still contains Jinja boot expressions at this point. It must not
	be reparsed/serialized as HTML, because that could alter those expressions.
	"""
	root = _HTML_TAG.search(source)
	head_end = _HEAD_END.search(source)
	if root is None or head_end is None or root.end() > head_end.start():
		return None

	root_tag = root.group(0)
	class_attr = _CLASS.search(root_tag)
	if class_attr:
		class_names = class_attr.group(3) if class_attr.group(2) else class_attr.group(4)
		if "bm-crm" not in class_names.split():
			quote = class_attr.group(2) or '"'
			replacement = f"{class_attr.group(1)}{quote}{class_names} bm-crm{quote}"
			root_tag = root_tag[:class_attr.start()] + replacement + root_tag[class_attr.end():]
	else:
		root_tag = root_tag[:-1] + ' class="bm-crm">'

	assets = []
	if not re.search(rf"\bid\s*=\s*([\"']){STYLE_ID}\1", source):
		assets.append(
			f'<link id="{STYLE_ID}" rel="stylesheet" '
			f'href="/assets/beautymatch/css/crm-botanical.css?v={RELEASE}">'
		)
	if not re.search(rf"\bid\s*=\s*([\"']){SCRIPT_ID}\1", source):
		assets.append(
			f'<script id="{SCRIPT_ID}" type="module" '
			f'src="/assets/beautymatch/js/crm-botanical.mjs?v={RELEASE}"></script>'
		)
	# Insert after the native stylesheet links. Module scripts execute after the
	# document is parsed, so CRM's original inline boot script is available.
	decorated = source[:head_end.start()] + "\n".join(assets) + source[head_end.start():]
	return decorated[:root.start()] + root_tag + decorated[root.end():]


class BeautyMatchCRMPage(TemplatePage):
	"""Theme only the canonical, installed CRM shell and preserve its lifecycle."""

	def can_render(self):
		return (
			self.path == "crm"
			and getattr(self, "app", None) == "crm"
			and self.template_path.replace("\\", "/") == "www/crm.html"
			and Path(self.app_path).resolve() == Path(frappe.get_app_path("crm")).resolve()
			and super().can_render()
		)

	def get_raw_template(self):
		source = super().get_raw_template()
		decorated = _inject_crm_assets(source)
		if decorated is not None:
			return decorated
		# An upstream shell change must disable decoration instead of preventing
		# access to CRM. Do not log the source, which later carries session data.
		try:
			frappe.logger("beautymatch").warning(
				"BeautyMatch CRM theme skipped: native HTML anchors changed; CRM remains available."
			)
		except Exception:
			pass
		return source
