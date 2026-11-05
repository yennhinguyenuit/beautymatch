"""Refresh local demo photography from the checked-in catalog and self-host Inter."""

import csv
import json
import re
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "beautymatch" / "public"
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"}


def download(url):
	if sys.platform == "win32":
		# Windows curl uses the OS certificate store; MSYS Python may lack that CA bundle.
		return subprocess.run(
			["curl.exe", "--fail", "--location", "--silent", "--show-error", "--max-time", "40",
			 "--user-agent", HEADERS["User-Agent"], url], check=True, capture_output=True,
		).stdout
	with urlopen(Request(url, headers=HEADERS), timeout=40) as response:
		return response.read()


def main():
	images = PUBLIC / "images"
	fonts = PUBLIC / "fonts"
	demo = PUBLIC / "demo"
	for directory in (images, fonts, demo):
		directory.mkdir(parents=True, exist_ok=True)
	with (ROOT / "data/BeautyMatch_Hasaki_Dataset_Verified.csv").open(encoding="utf-8-sig") as source:
		catalog = {row["product_code"]: row for row in csv.DictReader(source)}
	products = []
	crops = {
		"HASAKI-CLN-005": {"x": 85, "y": 120, "width": 200, "height": 420},
		"HASAKI-CLN-001": {"x": 40, "y": 100, "width": 330, "height": 450},
		"HASAKI-CLN-006": {"x": 120, "y": 175, "width": 180, "height": 380},
	}
	for code in ("HASAKI-CLN-005", "HASAKI-CLN-001", "HASAKI-CLN-006"):
		row = catalog[code]
		image = download(row["image_url"])
		if not image.startswith(b"\x89PNG"):
			raise ValueError(f"Unexpected image format for {code}")
		(images / f"{code}.png").write_bytes(image)
		products.append({
			"photo_crop": crops[code],
			"name": f"DEMO-{code}", "product_code": code,
			"product_name": row["product_name"], "brand": row["brand"], "price": float(row["price"]),
			"image_url": f"/assets/beautymatch/images/{code}.png",
			"product_url": row["product_url"], "key_ingredients": row.get("key_ingredients", ""),
			"data_as_of": row.get("data_as_of", ""),
		})
		print(f"Saved {code}: {len(image)} bytes")
	(demo / "products.json").write_text(json.dumps(products, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
	css = download("https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap").decode()
	for subset in ("latin", "vietnamese"):
		match = re.search(r"/\* " + subset + r" \*/\s*@font-face\s*\{([^}]+)\}", css)
		if not match:
			raise ValueError(f"Inter {subset} not found")
		url = re.search(r"url\(([^)]+)\)", match.group(1)).group(1)
		data = download(url)
		if not data.startswith(b"wOF2"):
			raise ValueError("Expected WOFF2")
		(fonts / f"inter-{subset}.woff2").write_bytes(data)
		print(f"Saved Inter {subset}: {len(data)} bytes")
	license_text = download("https://raw.githubusercontent.com/google/fonts/main/ofl/inter/OFL.txt")
	(fonts / "OFL.txt").write_bytes(license_text)


if __name__ == "__main__":
	main()
