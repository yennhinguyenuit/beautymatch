import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  catalogImage,
  catalogCrop,
} from "../../beautymatch/public/js/catalog-images.mjs";

test("self-hosted photos retain exact source identity, bytes and bounded display crops", async () => {
  const manifest = JSON.parse(
    await readFile("beautymatch/public/images/catalog/manifest.json", "utf8"),
  );
  const csv = await readFile(
    "data/BeautyMatch_Hasaki_Dataset_Verified.csv",
    "utf8",
  );
  for (const row of manifest) {
    if (!csv.includes(row.source_url)) {
      assert.equal(row.product_code, "HASAKI-SER-013");
      assert(
        csv.includes(row.source_page),
        "New demo photo must use the existing product page.",
      );
      assert.equal(new URL(row.source_url).hostname, "media.hcdn.vn");
      assert.equal(row.verified_at, "2026-11-08");
    }
    assert.equal(catalogImage(row.source_url), row.local_url);
    const file = await readFile(
      "beautymatch/public/" +
        row.local_url.slice("/assets/beautymatch/".length),
    );
    assert.equal(createHash("sha256").update(file).digest("hex"), row.sha256);
    const crop = catalogCrop(row.source_url);
    assert(crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0);
    assert(crop.x + crop.width <= 1200 && crop.y + crop.height <= 630);
  }
  assert.equal(
    catalogImage("https://example.org/another-snapshot.png"),
    "https://example.org/another-snapshot.png",
  );
  assert.equal(
    catalogCrop("https://example.org/another-snapshot.png"),
    undefined,
  );
});
