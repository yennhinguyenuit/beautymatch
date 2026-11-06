"""Reviewable, version-guarded host bridge. Run inside the Docker bench.

--check prepares a portable patch without changing CRM. --apply writes only the
four named source files after every anchor has been validated. Existing unrelated
changes are preserved. Backups/hashes allow a guarded --rollback.
"""

import argparse
import difflib
import hashlib
import json
from pathlib import Path


APP = Path(__file__).resolve().parents[1]
FILES = (
	"frontend/vite.config.js", "frontend/src/router.js",
	"frontend/src/utils/navigation.js", "frontend/src/components/Layouts/AppSidebar.vue",
)
MARKER = "@beautymatch/integration.mjs"


def change(source, before, after):
	if source.count(before) != 1:
		raise ValueError(f"Upstream anchor changed: {before[:90]!r}. CRM was not modified.")
	return source.replace(before, after, 1)


def transformed(name, text):
	if name == FILES[0]:
		text = change(text, "import path from 'path'", "import path from 'path'\nimport { realpathSync } from 'node:fs'")
		text = change(text, "  const isDev = mode === 'development'", "  const isDev = mode === 'development'\n  const beautyMatchRoot = realpathSync(path.resolve(import.meta.dirname, '../../beautymatch'))")
		text = change(text, "        '@': path.resolve(import.meta.dirname, 'src'),", "        '@': path.resolve(import.meta.dirname, 'src'),\n        '@beautymatch': path.join(beautyMatchRoot, 'frontend/crm'),")
		text = change(text, "        'vue-router',", "        'vue-router',\n        'pinia',")
		text = change(text, "allow: [path.resolve(import.meta.dirname, '../..')],", "allow: [path.resolve(import.meta.dirname, '../..'), beautyMatchRoot],")
	elif name == FILES[1]:
		text = change(text, "import { createRouter, createWebHistory } from 'vue-router'", "import { createRouter, createWebHistory } from 'vue-router'\nimport { installBeautyMatchRoutes } from '@beautymatch/integration.mjs'")
		text = change(text, "export default router", "installBeautyMatchRoutes(router, { isLoggedIn: () => sessionStore().isLoggedIn })\n\nexport default router")
	elif name == FILES[2]:
		text = change(text, "import router from '@/router'", "import router from '@/router'\nimport { beautyMatchNavigationItem, hasBeautyMatchAccess } from '@beautymatch/integration.mjs'")
		text = change(text, "  { label: 'Leads',", "  beautyMatchNavigationItem,\n  { label: 'Leads',")
		text = change(text, "router.hasRoute(item.route) && (!mobile || !item.desktopOnly),", "router.hasRoute(item.route) && (!mobile || !item.desktopOnly) &&\n      (item.route !== 'BeautyMatch' || hasBeautyMatchAccess()),")
	elif name == FILES[3]:
		text = change(text, "const links = getNavigationItems({ mobile: props.mobile })", "const links = computed(() => getNavigationItems({ mobile: props.mobile }))")
		text = change(text, "views: links.map((link)", "views: links.value.map((link)")
	return text


def main():
	parser = argparse.ArgumentParser()
	parser.add_argument("--crm-root", default="/home/frappe/frappe-bench/apps/crm")
	parser.add_argument("--apply", action="store_true")
	parser.add_argument("--rollback", action="store_true")
	parser.add_argument("--check", action="store_true")
	args = parser.parse_args()
	root = Path(args.crm_root).resolve(strict=True)
	if not (root / "crm/__init__.py").is_file() or not (root / ".git").exists():
		raise ValueError("Expected a real CRM repository.")
	if '__version__ = "1.86.0"' not in (root / "crm/__init__.py").read_text():
		raise ValueError("This bridge was reviewed for CRM 1.86.0 only. Review upstream before applying.")
	backup = APP / "test-results/native-crm-patch"
	manifest_path = backup / "manifest.json"
	sha = lambda text: hashlib.sha256(text.encode()).hexdigest()
	if args.rollback:
		manifest = json.loads(manifest_path.read_text())
		if manifest["crm_root"] != str(root):
			raise ValueError("Backup belongs to a different CRM checkout.")
		for name, hashes in manifest["files"].items():
			if name not in FILES or sha((root / name).read_text()) != hashes["after"]:
				raise ValueError("CRM source changed after installation. Refusing rollback over other work.")
		for name in FILES:
			(root / name).write_text((backup / name).read_text())
		print(json.dumps({"rolled_back": True, "files": FILES}))
		return
	before = {name: (root / name).read_text() for name in FILES}
	if all(("@beautymatch" in before[name]) if name != FILES[3] else ("const links = computed(() => getNavigationItems" in before[name]) for name in FILES):
		print(json.dumps({"installed": True, "changed": False, "files": FILES}))
		return
	for name in FILES:
		if MARKER in before[name]:
			raise ValueError("Partially installed bridge. Review the saved patch instead of applying twice.")
	after = {name: transformed(name, before[name]) for name in FILES}
	patch = "".join("".join(difflib.unified_diff(before[name].splitlines(True), after[name].splitlines(True), fromfile=f"a/{name}", tofile=f"b/{name}")) for name in FILES)
	patch_path = APP / "integration/crm-1.86.0-beautymatch.patch"
	patch_path.parent.mkdir(parents=True, exist_ok=True)
	patch_path.write_text(patch)
	if args.apply:
		if manifest_path.exists():
			raise ValueError("A prior backup exists; inspect it before replacing CRM sources.")
		for name in FILES:
			target = (root / name).resolve(strict=True)
			if not target.is_relative_to(root):
				raise ValueError("CRM target escaped the verified repository.")
		backup.mkdir(parents=True, exist_ok=True)
		for name in FILES:
			original = backup / name
			original.parent.mkdir(parents=True, exist_ok=True)
			original.write_text(before[name])
		manifest_path.write_text(json.dumps({"crm_root": str(root), "crm_version": "1.86.0", "files": {name: {"before": sha(before[name]), "after": sha(after[name])} for name in FILES}}, indent=2))
		for name in FILES:
			(root / name).write_text(after[name])
	print(json.dumps({"applied": args.apply, "files": FILES, "patch": str(patch_path), "added_lines": sum(line.startswith('+') and not line.startswith('+++') for line in patch.splitlines())}))


if __name__ == "__main__":
	main()
