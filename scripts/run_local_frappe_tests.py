"""Container-only TASK4 regression runner; restore site config byte-for-byte."""
import json
from pathlib import Path
import subprocess

bench = Path("/home/frappe/frappe-bench")
config = bench / "sites/crm.localhost/site_config.json"
if not config.is_file() or not Path("/workspace/beautymatch/.local/seminar-credentials.json").is_file():
    raise SystemExit("Run only in the configured local seminar container.")
original = config.read_bytes()
settings = json.loads(original)
common = json.loads((bench / "sites/common_site_config.json").read_bytes())
if not (settings.get("developer_mode") or common.get("developer_mode")):
    raise SystemExit("Local developer mode is required.")
report = Path("/workspace/beautymatch/test-results/request-consistency/task4.log")
report.parent.mkdir(parents=True, exist_ok=True)
try:
    config.write_text(json.dumps({**settings, "allow_tests": True}, indent=2) + "\n")
    result = subprocess.run([
        "bench", "--site", "crm.localhost", "run-tests", "--app", "beautymatch",
        "--module", "beautymatch.tests.test_task4_api", "--skip-test-records",
        "--skip-before-tests",
    ], cwd=bench, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    report.write_text(result.stdout)
    print(result.stdout)
    if result.returncode:
        raise SystemExit(result.returncode)
    if "Ran 9 tests" not in result.stdout or "\nOK" not in result.stdout:
        raise SystemExit("TASK4 tests did not pass; see local task4.log.")
finally:
    config.write_bytes(original)
    assert config.read_bytes() == original
    print("Local site configuration restored byte-for-byte.")
