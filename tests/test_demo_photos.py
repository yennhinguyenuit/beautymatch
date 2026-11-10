"""Demo photos must retain exact catalog identity and never alter research input."""
import importlib.util
from pathlib import Path
from types import ModuleType
from unittest import TestCase
from unittest.mock import patch


class DemoPhotoTest(TestCase):
    @classmethod
    def setUpClass(cls):
        fake = ModuleType("frappe")
        fake.whitelist = lambda **kwargs: lambda fn: fn
        profile = ModuleType("beautymatch.api.profile")
        profile._check_consultation_role = lambda: None
        recommendation = ModuleType("beautymatch.api.recommendation")
        recommendation.PROFILE_FIELDS = ()
        spec = importlib.util.spec_from_file_location(
            "demo_photos_under_test", Path(__file__).parents[1] / "beautymatch/scripts/local_demo.py"
        )
        cls.module = importlib.util.module_from_spec(spec)
        with patch.dict("sys.modules", {
            "frappe": fake, "beautymatch.api.profile": profile,
            "beautymatch.api.recommendation": recommendation,
        }):
            spec.loader.exec_module(cls.module)

    def test_missing_garnier_photo_uses_verified_exact_product_without_mutating_csv(self):
        fields = next(row for row in self.module.read_and_validate() if row["product_code"] == "HASAKI-SER-013")
        self.assertEqual(fields["image_url"], "")
        result = self.module._with_verified_image(fields)
        self.assertIn("tinh-chat-garnier-giam-mun-mo-tham-cho-da-dau-mun-30ml", result["image_url"])
        self.assertEqual(fields["image_url"], "")
        self.assertEqual({k: v for k, v in fields.items() if k != "image_url"},
                         {k: v for k, v in result.items() if k != "image_url"})

    def test_wrong_product_page_cannot_borrow_a_catalog_photo(self):
        with self.assertRaises(ValueError):
            self.module._with_verified_image({
                "product_code": "HASAKI-SER-013", "image_url": "",
                "product_url": "https://hasaki.vn/san-pham/a-different-product.html",
            })

    def test_unknown_product_still_has_no_photo_and_existing_source_is_preserved(self):
        for fields in (
            {"product_code": "NOT-IN-MANIFEST", "image_url": "", "product_url": ""},
            {"product_code": "HASAKI-SER-013", "image_url": "https://example.org/existing.png"},
        ):
            self.assertEqual(self.module._with_verified_image(fields), fields)
