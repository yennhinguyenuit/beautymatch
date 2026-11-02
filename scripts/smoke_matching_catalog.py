"""Read-only matching simulation against the 69-row catalog and anonymized Drive fixtures.

Does not connect to Frappe or create Session/Task; CSV products lack real
Product Profile.name so returned offline test IDs MUST NOT be sent to Tường API.
"""
from __future__ import annotations
import csv
import json
import sys
from collections import Counter
from copy import deepcopy
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from beautymatch.services.matching_engine import match_products, CONCERNS  # noqa: E402

CSV_TO_FRAPPE={
    'skin_oily':'suitable_oily','skin_dry':'suitable_dry',
    'skin_combination':'suitable_combination','skin_normal':'suitable_normal',
    'skin_all':'suitable_all_skin','sensitive':'suitable_sensitive',
    'concern_oil':'concern_oil_control',
    'fragrance':'contains_fragrance','alcohol_denat':'contains_alcohol_denat',
    'essential_oil':'contains_essential_oil',
}
SETTINGS={
    'skin_weight':30,'concern_weight':30,'ingredient_weight':20,
    'sensitivity_weight':10,'budget_weight':5,'brand_weight':5,
    'minimum_recommendation_score':60,'number_of_results':3,
}

def records(path):
    with Path(path).open(encoding='utf-8-sig',newline='') as f:
        return list(csv.DictReader(f))

def product_from_csv(raw):
    prod={CSV_TO_FRAPPE.get(k,k):v for k,v in raw.items()}
    # These are explicitly synthetic offline identifiers; CRM document names
    # depend on actual Frappe database allocation.
    prod['name']='OFFLINE-ONLY-'+raw['product_code']
    return prod

def load_catalog(path=ROOT/'data/BeautyMatch_Hasaki_Dataset_Verified.csv'):
    return [product_from_csv(r) for r in records(path)]

def load_profiles(path=ROOT/'tests/fixtures/customer_profiles_matching_only.csv'):
    return {p['fixture_customer_key']:{k:v for k,v in p.items() if k!='fixture_customer_key'} for p in records(path)}

def simulate_requests(catalog=None):
    catalog=catalog if catalog is not None else load_catalog()
    profiles=load_profiles()
    scenarios=records(ROOT/'tests/fixtures/request_scenarios_matching_only.csv')
    report=[]
    for req in scenarios:
        profile=deepcopy(profiles[req['fixture_customer_key']])
        profile['requested_category']=req['requested_category']
        profile['max_budget']=req['max_budget']
        result=match_products(profile,catalog,SETTINGS)
        report.append({'fixture_session_key':req['fixture_session_key'],
                       'fixture_customer_key':req['fixture_customer_key'],
                       'requested_category':req['requested_category'],
                       'number_of_eligible_products':result['number_of_eligible_products'],
                       'number_of_recommendations':len(result['results']),
                       'matched_product_codes':[r['product'].removeprefix('OFFLINE-ONLY-') for r in result['results']],
                       'results':result['results']})
    return report

def main():
    report=simulate_requests()
    distribution=dict(sorted(Counter(r['number_of_recommendations'] for r in report).items()))
    output={'data_source':'69-product CSV, anonymized 40 profiles + 50 scenarios',
            'offline_only':True,'CRM_database_test':False,
            'note':'Returns offline proxy Product Profile names, not real CRM IDs. Counts from snapshot/selected fields; returning customer updates are not inferred.',
            'total_request_scenarios':len(report),'distribution_0_1_2_3':distribution,
            'scenarios':report}
    dest=ROOT/'docs/offline_matching_50_scenarios.json'
    dest.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Offline scenario count:',len(report))
    print('Number-of-results distribution:',distribution)
    for n in range(4):
        cases=[r for r in report if r['number_of_recommendations']==n]
        print(f'{n} results: {len(cases)} scenarios; example:', cases[0]['fixture_session_key'] if cases else 'not observed')

if __name__=='__main__': main()
