"""Exercise recovery/rollback on copies of the actual audited host baseline.

Never changes the running CRM repository. Keeps proof artifacts in .local/.
"""
import json
import subprocess
import sys
from pathlib import Path
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
FILES = ["frontend/vite.config.js", "frontend/src/router.js", "frontend/src/utils/navigation.js", "frontend/src/components/Layouts/AppSidebar.vue"]
proof = ROOT / ".local/patch-proof" / uuid4().hex
host = proof / "host"
backup = proof / "backup"
host.joinpath(".git").mkdir(parents=True)
host.joinpath("crm").mkdir()
host.joinpath("crm/__init__.py").write_text('__version__ = "1.86.0"\n')
original = {name: (ROOT / ".local/crm-native-patch" / name).read_text() for name in FILES}
for name, source in original.items():
    (host / name).parent.mkdir(parents=True, exist_ok=True)
    (host / name).write_text(source)


def run(action, expected=0):
    result = subprocess.run([sys.executable, str(ROOT / "scripts/crm_native_patch.py"), "--crm-root", str(host), "--backup-dir", str(backup), action], capture_output=True, text=True)
    assert (result.returncode == 0) == (expected == 0), result.stderr
    return json.loads(result.stdout) if result.returncode == 0 else None


assert run("--apply")["applied"]
assert run("--apply")["changed"] is False
for name, source in original.items():
    (host / name).write_text(source)
assert run("--apply")["applied"]  # Recreated host + persistent backup.
assert run("--rollback")["rolled_back"]
assert all((host / name).read_text() == source for name, source in original.items())
run("--apply")
changed = host / FILES[0]
changed.write_text(changed.read_text() + "\n// unrelated later change\n")
run("--rollback", expected=1)
assert changed.read_text().endswith("// unrelated later change\n")
report = {"passed": True, "initial_apply": True, "idempotent_apply": True, "recreated_host_reuses_persistent_backup": True, "rollback_restores_baseline": True, "rollback_refuses_later_edits": True, "running_crm_sources_modified": False}
target = ROOT / "test-results/seminar/patch-recovery.json"
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
