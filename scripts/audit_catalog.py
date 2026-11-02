"""Read-only QC audit for 29-field Hasaki CSV and optional Frappe Product Profile DB.

This script never changes status or imports products.
"""
from __future__ import annotations
import argparse
import csv
import json
from collections import Counter
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

CATEGORIES = ('CLEANSER', 'TONER', 'SERUM', 'MOISTURIZER', 'SUNSCREEN')
SKIN = ('skin_oily', 'skin_dry', 'skin_combination', 'skin_normal', 'skin_all')
CONCERNS = ('concern_oil', 'concern_acne', 'concern_post_acne', 'concern_dehydration', 'concern_barrier', 'concern_dullness', 'concern_aging')
AVOIDS = ('fragrance','alcohol_denat','essential_oil')
REQUIRED_TEXT = ('product_code','product_name','brand','category','product_url','source_url','data_as_of')
DEFAULT = Path(__file__).resolve().parents[1] / 'data' / 'BeautyMatch_Hasaki_Dataset_Verified.csv'

def has_url(x):
    try:
        p = urlparse(x)
        return p.scheme in ('http','https') and bool(p.netloc)
    except (TypeError, ValueError):
        return False

def audit(path=DEFAULT):
    with Path(path).open(encoding='utf-8-sig',newline='') as f:
        rd=csv.DictReader(f)
        columns=rd.fieldnames or []
        rows=list(rd)
    if len(columns)!=29 or len(set(columns))!=29:
        raise ValueError('CSV header must have exactly 29 unique columns')
    codes=Counter(r['product_code'] for r in rows)
    issues=[]
    for i,r in enumerate(rows,2):
        reasons=[]
        for col in REQUIRED_TEXT:
            if not r[col].strip(): reasons.append(f'empty:{col}')
        if r['category'] not in CATEGORIES: reasons.append('invalid:category')
        if r['status'] not in ('Active','Inactive'): reasons.append('invalid:status')
        try:
            if int(r['price']) <= 0: reasons.append('invalid:price')
        except (ValueError,TypeError): reasons.append('invalid:price')
        try:
            if date.fromisoformat(r['data_as_of'])>date.today(): reasons.append('future:data_as_of')
        except ValueError: reasons.append('invalid:data_as_of')
        for u in ('product_url','source_url'):
            if not has_url(r[u]): reasons.append('invalid:'+u)
        if r['image_url'] and not has_url(r['image_url']): reasons.append('invalid:image_url')
        if codes[r['product_code']]!=1: reasons.append('duplicate:product_code')
        for flag in (*SKIN,'sensitive',*CONCERNS):
            if r[flag] not in ('0','1'): reasons.append('invalid:'+flag)
        for flag in AVOIDS:
            if r[flag] not in ('Yes','No','Unknown'): reasons.append('invalid:'+flag)
        if r['status']=='Active':
            if not any(r[f]=='1' for f in SKIN): reasons.append('active:no_verified_skin')
            if not any(r[f]=='1' for f in CONCERNS): reasons.append('active:no_verified_concern')
        if reasons: issues.append({'line':i,'product_code':r['product_code'],'reasons':reasons})
    return {
        'csv':str(path),'columns':len(columns),'total':len(rows),
        'status':dict(Counter(r['status'] for r in rows)),
        'by_category':{c:{'total':sum(r['category']==c for r in rows),'active':sum(r['category']==c and r['status']=='Active' for r in rows)} for c in CATEGORIES},
        'active_missing_image':sum(r['status']=='Active' and not r['image_url'] for r in rows),
        'active_unknown_flags':{x:sum(r['status']=='Active' and r[x]=='Unknown' for r in rows) for x in AVOIDS},
        'min_100_gap':max(0,100-len(rows)),
        'structurally_valid_total':len(rows)-len(issues),
        'min_100_valid_gap':max(0,100-(len(rows)-len(issues))),
        'structural_issues':issues,
        'note':'Only syntax/field QC. URL reachability, exact variant, flag evidence and real DB counts require separate verification.'
    }

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--csv',type=Path,default=DEFAULT);p.add_argument('--out',type=Path);p.add_argument('--strict',action='store_true',help='Exit nonzero for any structural issue')
    opts=p.parse_args(); res=audit(opts.csv)
    out=json.dumps(res,ensure_ascii=False,indent=2)
    if opts.out: opts.out.parent.mkdir(parents=True,exist_ok=True);opts.out.write_text(out,encoding='utf-8')
    print(out)
    if opts.strict and res['structural_issues']: raise SystemExit(1)
