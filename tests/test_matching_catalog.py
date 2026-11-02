"""Regression tests against real (but offline CSV) 69-product catalog and anonymized Drive fixtures."""
from __future__ import annotations
import importlib.util
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/smoke_matching_catalog.py'
spec=importlib.util.spec_from_file_location('catalog_smoke',SCRIPT)
smoke=importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)

class TestCatalog(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=smoke.load_catalog()
        cls.profiles=smoke.load_profiles()
        cls.scenarios=smoke.simulate_requests(cls.catalog)

    def test_catalog_is_69_with_25_active(self):
        self.assertEqual(len(self.catalog),69)
        active=[p for p in self.catalog if p['status']=='Active']
        self.assertEqual(len(active),25)
        for cat in ('CLEANSER','TONER','SERUM','MOISTURIZER','SUNSCREEN'):
            self.assertEqual(sum(p['category']==cat for p in active),5)

    def test_50_real_fixture_scenarios(self):
        self.assertEqual(len(self.profiles),40)
        self.assertEqual(len(self.scenarios),50)
        self.assertTrue(all(len(x['results'])<=3 for x in self.scenarios))
        self.assertTrue(all(x['number_of_recommendations']<=x['number_of_eligible_products'] for x in self.scenarios))

    def test_0_from_fixture_request_001(self):
        case=next(r for r in self.scenarios if r['fixture_session_key']=='BM-REQ-001')
        self.assertEqual(case['number_of_eligible_products'],1)
        self.assertEqual(case['number_of_recommendations'],0)

    def test_1_from_fixture_request_011_and_hand_score(self):
        case=next(r for r in self.scenarios if r['fixture_session_key']=='BM-REQ-011')
        self.assertEqual(case['number_of_eligible_products'],1)
        self.assertEqual(case['matched_product_codes'],['HASAKI-CLN-007'])
        r=case['results'][0]
        self.assertEqual(r['skin_score'],24)
        self.assertEqual(r['concern_score'],15)
        self.assertEqual(r['ingredient_score'],10)
        self.assertEqual(r['sensitivity_score'],10)
        self.assertEqual(r['budget_score'],3)
        self.assertEqual(r['brand_score'],0)
        self.assertEqual(r['final_match_score'],65.26)  # (24+15+10+10+3)/95 * 100

    def test_2_from_existing_profile_with_budget_variant(self):
        # BM-CUS-003 is an actual fixture; only category and budget are varied
        # using the Task 1 fields. Product records remain the real catalog.
        p=dict(self.profiles['BM-CUS-003'],requested_category='CLEANSER',max_budget='500000')
        result=smoke.match_products(p,self.catalog,smoke.SETTINGS)
        self.assertEqual(result['number_of_eligible_products'],3)
        self.assertEqual(len(result['results']),2)
        self.assertEqual([r['product'] for r in result['results']],
                         ['OFFLINE-ONLY-HASAKI-CLN-008','OFFLINE-ONLY-HASAKI-CLN-004'])

    def test_3_from_fixture_request_003_and_hand_score(self):
        case=next(r for r in self.scenarios if r['fixture_session_key']=='BM-REQ-003')
        self.assertEqual(case['number_of_eligible_products'],3)
        self.assertEqual(case['matched_product_codes'],[
            'HASAKI-SER-013','HASAKI-SER-008','HASAKI-SER-001'])
        r=case['results'][0]
        self.assertEqual(r['skin_score'],30)
        self.assertEqual(r['concern_score'],20)    # 2/3 verified concerns
        self.assertEqual(r['ingredient_score'],13.33) # 2/3 supported ingredient tags
        self.assertEqual(r['sensitivity_score'],10)
        self.assertEqual(r['budget_score'],5)
        self.assertEqual(r['brand_score'],0)
        self.assertEqual(r['final_match_score'],82.46) # (30+20+40/3+10+5)/95*100

    def test_invalid_cases_from_test_cases_sheet(self):
        sheet={r['test_case']:r for r in smoke.records(ROOT/'tests/fixtures/test_cases_matching_only.csv')}
        for tag in ('NO_CONCERNS','FOUR_CONCERNS','NEGATIVE_BUDGET','UNKNOWN_SKIN_TYPE'):
            raw=sheet[tag];p={k:v for k,v in raw.items() if k in self.profiles['BM-CUS-001']}
            with self.subTest(tag=tag),self.assertRaises(ValueError):
                smoke.match_products(p,self.catalog,smoke.SETTINGS)

    def test_no_personal_identifiers_in_output(self):
        import json
        text=json.dumps(self.scenarios,ensure_ascii=False).lower()
        for private in ('email','phone','full_name','crm_lead','@example.com'):
            self.assertNotIn(private,text)

if __name__=='__main__': unittest.main()
