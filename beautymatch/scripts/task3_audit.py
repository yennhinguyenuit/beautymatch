"""Read-only Frappe database QC for BeautyMatch TASK 3.

Run: bench --site crm.localhost execute beautymatch.scripts.task3_audit.audit_database
Never writes, creates Session, or creates CRM Task.
"""
from __future__ import annotations
from collections import Counter
from beautymatch.services.matching_engine import _valid_product

FIELDS = (
    'name','product_code','product_name','brand','category','price','product_url',
    'source_url','data_as_of','status',
    'suitable_oily','suitable_dry','suitable_combination','suitable_normal',
    'suitable_all_skin','suitable_sensitive',
    'concern_oil_control','concern_acne','concern_post_acne',
    'concern_dehydration','concern_barrier','concern_dullness','concern_aging',
    'contains_fragrance','contains_alcohol_denat','contains_essential_oil',
    'image_url','key_ingredients','ingredient_concern_tags',
)
CATEGORIES = ('CLEANSER','TONER','SERUM','MOISTURIZER','SUNSCREEN')

def audit_database():
    import frappe
    rows=frappe.get_all('Product Profile',fields=list(FIELDS),limit_page_length=0)
    seen=Counter(row['product_code'] for row in rows)
    invalid=[row['product_code'] for row in rows if not _valid_product(row)]
    active=[row for row in rows if row['status']=='Active']
    report={
        'source':'Frappe Product Profile database (read-only)',
        'total':len(rows),
        'active':len(active),
        'inactive':sum(row['status']=='Inactive' for row in rows),
        'H6_valid_total':len(rows)-len(invalid),
        'H1_and_H6_active_valid':sum(_valid_product(row) for row in active),
        'active_by_category':{cat:sum(row['category']==cat for row in active) for cat in CATEGORIES},
        'invalid_H6_product_codes':invalid,
        'duplicate_product_codes':[code for code,n in seen.items() if n>1],
        'active_missing_image_url':sum(not row['image_url'] for row in active),
        'note':'H2-H5 depend on each Beauty Profile; audit H1+H6 here. External URL reachability and product claim evidence are not verified.',
    }
    print('TASK 3 DATABASE AUDIT:',frappe.as_json(report,indent=2))
    return report


def audit_scenarios():
    """Check H1-H6 and cutoff with 50 anonymized scenarios on live DB rows.

    The 50 scenarios override requested_category/max_budget of the baseline
    profiles. The API owner should separately verify returning-customer updates.
    No Session/Task/records are created.
    """
    import csv
    import frappe
    from pathlib import Path
    from beautymatch.services.matching_engine import match_products

    base=Path(__file__).resolve().parents[2] / 'tests' / 'fixtures'
    customers=base / 'customer_profiles_matching_only.csv'
    requests=base / 'request_scenarios_matching_only.csv'
    if not customers.is_file() or not requests.is_file():
        raise FileNotFoundError('Copy both anonymized test CSV fixtures to tests/fixtures before audit_scenarios')

    def read(path):
        with path.open(encoding='utf-8-sig',newline='') as f:
            return list(csv.DictReader(f))

    profiles={r['fixture_customer_key']:{k:v for k,v in r.items() if k!='fixture_customer_key'} for r in read(customers)}
    products=frappe.get_all('Product Profile',fields=list(FIELDS),limit_page_length=0)
    settings=frappe.get_doc('BeautyMatch Settings')
    distribution=Counter()
    sample_cases={}
    for scenario in read(requests):
        p=dict(profiles[scenario['fixture_customer_key']])
        p['requested_category']=scenario['requested_category']
        p['max_budget']=scenario['max_budget']
        answer=match_products(p,products,settings)
        n=len(answer['results'])
        distribution[n]+=1
        if str(n) not in sample_cases:
            sample_cases[str(n)]={
                'fixture_session_key':scenario['fixture_session_key'],
                'eligible_after_H1_H6':answer['number_of_eligible_products'],
                'returned':n,
                'products':[r['product'] for r in answer['results']],
            }
    result={
        'source':'real Frappe Product Profile rows + anonymized workbook fixture scenarios',
        'total_scenarios':sum(distribution.values()),
        'result_count_distribution':{str(i):distribution[i] for i in range(4)},
        'examples':sample_cases,
        'warning':'Test only; not an end-to-end Recommendation Session test or URL/skin source verification.',
    }
    print('TASK 3 LIVE Frappe matching scenarios:',frappe.as_json(result,indent=2))
    return result
