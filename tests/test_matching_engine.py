"""Isolated TASK 3 unit tests; products are explicit TEST FIXTURES, not CRM rows."""
import importlib.util
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "beautymatch" / "services" / "matching_engine.py"
spec = importlib.util.spec_from_file_location("task3_matching_engine", MODULE)
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
match_products = engine.match_products

SETTINGS = dict(skin_weight=30, concern_weight=30, ingredient_weight=20,
                sensitivity_weight=10, budget_weight=5, brand_weight=5,
                minimum_recommendation_score=60, number_of_results=3)


def profile(**changes):
    p = {"skin_type": "DRY", "requested_category": "CLEANSER", "max_budget": 200000,
         "sensitivity": "Sensitive", "preferred_brand": "", "concern_oil_control": 0,
         "concern_acne": 0, "concern_post_acne": 0, "concern_dehydration": 1,
         "concern_barrier": 0, "concern_dullness": 0, "concern_aging": 0,
         "avoid_fragrance": 1, "avoid_alcohol_denat": 0, "avoid_essential_oil": 0}
    p.update(changes)
    return p


def product(code="CLN-01", **changes):
    p = {"name": f"TEST-PRODUCT-{code}", "product_code": code,
         "product_name": f"Fixture {code}", "brand": "Cetaphil", "category": "CLEANSER",
         "price": 120000, "product_url": "https://example.com/product", "source_url": "https://example.com/product",
         "data_as_of": "2026-10-12", "status": "Active", "suitable_oily": 0, "suitable_dry": 1,
         "suitable_combination": 0, "suitable_normal": 0, "suitable_all_skin": 0,
         "suitable_sensitive": 1, "concern_oil_control": 0, "concern_acne": 0,
         "concern_post_acne": 0, "concern_dehydration": 1, "concern_barrier": 0,
         "concern_dullness": 0, "concern_aging": 0,
         "key_ingredients": "Glycerin", "ingredient_concern_tags": "dehydration",
         "contains_fragrance": "No", "contains_alcohol_denat": "Unknown",
         "contains_essential_oil": "Unknown"}
    p.update(changes)
    return p


class TestMatching(unittest.TestCase):
    def test_0_1_2_3_results(self):
        for n in range(4):
            result = match_products(profile(), [product(f"CLN-{i:02d}") for i in range(n)], SETTINGS)
            self.assertEqual(result["number_of_eligible_products"], n)
            self.assertEqual(len(result["results"]), n)
            self.assertEqual([row["rank"] for row in result["results"]], list(range(1, n+1)))

    def test_all_hard_filters(self):
        cases = [
            {"status": "Inactive"},                        # H1
            {"category": "SERUM"},                          # H2
            {"price": 210000},                              # H3
            {"suitable_dry": 0, "suitable_all_skin": 0},    # H4
            {"contains_fragrance": "Yes"},                  # H5
            {"contains_fragrance": "Unknown"},              # H5
            {"product_code": ""},                           # H6
            {"source_url": ""},                             # H6
        ]
        for changes in cases:
            with self.subTest(changes=changes):
                result = match_products(profile(), [product(**changes)], SETTINGS)
                self.assertEqual(result, {"number_of_eligible_products": 0, "results": []})

    def test_unknown_allowed_when_not_avoiding(self):
        a = match_products(profile(avoid_fragrance=0), [product(contains_fragrance="Unknown")], SETTINGS)
        self.assertEqual(len(a["results"]), 1)

    def test_full_points_and_no_brand_denominator(self):
        result = match_products(profile(), [product()], SETTINGS)
        r = result["results"][0]
        self.assertEqual(r["final_match_score"], 100.0)
        self.assertEqual(r["concern_coverage"], 100.0)
        self.assertEqual(r["brand_score"], 0)
        self.assertEqual(r["product"], "TEST-PRODUCT-CLN-01")

    def test_all_skin_only_80_percent_and_budget_60_percent(self):
        p = product(suitable_dry=0, suitable_all_skin=1, price=180000)
        result = match_products(profile(), [p], SETTINGS)
        r = result["results"][0]
        self.assertEqual(r["skin_score"], 24)
        self.assertEqual(r["budget_score"], 3)
        self.assertEqual(r["final_match_score"], round(100 * (24 + 30 + 20 + 10 + 3) / 95, 2))

    def test_brand_added_to_denominator(self):
        matching = match_products(profile(preferred_brand="Cetaphil"), [product()], SETTINGS)["results"][0]
        not_matching = match_products(profile(preferred_brand="La Roche-Posay"), [product()], SETTINGS)["results"][0]
        self.assertEqual(matching["brand_score"], 5)
        self.assertEqual(matching["final_match_score"], 100)
        self.assertEqual(not_matching["brand_score"], 0)
        self.assertEqual(not_matching["final_match_score"], 95)

    def test_eligible_before_score_threshold(self):
        bad = product(concern_dehydration=0, concern_acne=1, ingredient_concern_tags="", suitable_sensitive=0)
        r = match_products(profile(), [bad], SETTINGS)
        self.assertEqual(r["number_of_eligible_products"], 1)
        self.assertEqual(r["results"], [])

    def test_sorting_by_price_then_code(self):
        a = product("Z", price=120000)
        b = product("A", price=120000)
        c = product("C", price=110000)
        result = match_products(profile(), [a, b, c], SETTINGS)
        self.assertEqual([row["product"] for row in result["results"]],
                         ["TEST-PRODUCT-C", "TEST-PRODUCT-A", "TEST-PRODUCT-Z"])

    def test_cap_three(self):
        r = match_products(profile(), [product(str(i)) for i in range(5)], SETTINGS)
        self.assertEqual(r["number_of_eligible_products"], 5)
        self.assertEqual(len(r["results"]), 3)

    def test_H6_rejects_active_without_any_evidenced_concern(self):
        p = product(concern_dehydration=0)
        r = match_products(profile(), [p], SETTINGS)
        self.assertEqual(r["number_of_eligible_products"], 0)

    def test_H6_rejects_malformed_flags_and_avoid_enums(self):
        for changes in ({"suitable_dry": None}, {"concern_acne": "unknown"},
                        {"contains_alcohol_denat": "No?"}, {"data_as_of": "bad"},
                        {"product_url": "file:///tmp/fake"}):
            with self.subTest(changes=changes):
                self.assertEqual(match_products(profile(), [product(**changes)], SETTINGS)["number_of_eligible_products"], 0)

    def test_direct_match_wins_over_all_skin(self):
        p = product(suitable_dry=1, suitable_all_skin=1)
        result = match_products(profile(), [p], SETTINGS)["results"][0]
        self.assertEqual(result["skin_score"], 30)

    def test_not_sensitive_gets_sensitivity_points_without_assertion(self):
        p = product(suitable_sensitive=0)
        r = match_products(profile(sensitivity="Not specifically sensitive"), [p], SETTINGS)["results"][0]
        self.assertEqual(r["sensitivity_score"], 10)
        self.assertNotIn("da nhạy cảm", r["warning_partial_match"].lower())

    def test_budget_exact_boundary(self):
        full = match_products(profile(), [product(price=160000)], SETTINGS)["results"][0]
        partial = match_products(profile(), [product(price=160001)], SETTINGS)["results"][0]
        self.assertEqual(full["budget_score"], 5)
        self.assertEqual(partial["budget_score"], 3)

    def test_preferred_brand_casefold(self):
        r = match_products(profile(preferred_brand="cEtApHiL"), [product()], SETTINGS)["results"][0]
        self.assertEqual(r["brand_score"], 5)

    def test_pure_function_does_not_modify_product_or_profile(self):
        from copy import deepcopy
        p = profile(full_name="Should Not Leak", email="private@example.com")
        ps = [product()]
        initial = deepcopy((p, ps, SETTINGS))
        r = match_products(p, ps, SETTINGS)
        self.assertEqual((p, ps, SETTINGS), initial)
        self.assertNotIn("private@example.com", str(r))
        self.assertNotIn("Should Not Leak", str(r))

    def test_invalid_profile_fields_fail_closed(self):
        for changes in ({"skin_type": "SENSITIVE"}, {"sensitivity": "Unknown"},
                        {"max_budget": 0}, {"concern_dehydration": None},
                        {"avoid_fragrance": "Unknown"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                match_products(profile(**changes), [product()], SETTINGS)

    def test_malformed_settings_raise(self):
        for changes in ({"skin_weight": -1}, {"minimum_recommendation_score": 101},
                        {"number_of_results": 3.5}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                match_products(profile(), [product()], dict(SETTINGS, **changes))

    def test_warning_without_unproven_safety_claim(self):
        r = match_products(profile(), [product(suitable_sensitive=0)], SETTINGS)
        if r["results"]:
            self.assertIn("chưa có xác nhận", r["results"][0]["warning_partial_match"].lower())


if __name__ == "__main__":
    unittest.main()
