# BeautyMatch — Task 3 | Bàn giao Product Catalog & Matching Engine (demo)

**Ngày cập nhật:** 02/11/2026  
**Người phụ trách:** Nghi — Task 3  
**Nhánh phát triển:** `feat/matching-engine`  
**Đích Pull Request:** `yennhinguyenuit/beautymatch:develop`

## 1. Phạm vi bàn giao

- Danh mục Product Profile dùng minh họa: 5 nhóm `CLEANSER`, `TONER`, `SERUM`, `MOISTURIZER`, `SUNSCREEN`.
- Thuật toán content-based + rule-based thuần Python: `beautymatch.services.matching_engine.match_products(profile_snapshot, products, settings)`.
- H1–H6, chấm điểm theo Settings, lọc ngưỡng, xếp hạng Top 3, giải thích lý do và cảnh báo một phần.
- Bộ unit tests và fixtures 40 hồ sơ/50 lượt tư vấn đã loại thông tin định danh; script audit read-only với Frappe.
- **Không** tạo Recommendation Session/Recommendation Item/CRM Task, không mở API public, không ghi database trong `match_products`.

## 2. Kết quả kiểm thử đã xác nhận

### 2.1. Catalog trên Frappe (lệnh `audit_database`)

| Chỉ số | Kết quả |
|---|---:|
| Product Profile trong database | 69 |
| Active | 25 |
| Inactive | 44 |
| Active / danh mục | 5 |
| H6 valid (toàn bộ) | 37 |
| Active đồng thời vượt H1 + H6 | 25 |
| Trùng `product_code` | 0 |
| Active thiếu `image_url` | 12 |

Kết quả import thành công đã ghi nhận: `validated=69; inserted=4; updated=19; unchanged=46; db_total=69` (đây **chưa** phải bằng chứng kiểm thử re-import lặp lại).

Đánh giá H6 theo các trường cấu trúc và cờ bằng chứng; chưa kiểm tra độ truy cập URL ngoài, biến thể sản phẩm hay độ chính xác các claim trên Hasaki.

### 2.2. Thuật toán

- Unit tests: **27/27 PASS** theo kết quả chạy trên máy Nghi; bộ mã đã được kiểm thử offline cùng fixture.
- Frappe `BeautyMatch Settings` được đăng ký vào site local và `audit_scenarios` đã chạy thành công với `Product Profile` thực.
- Kết quả 50 kịch bản Frappe: **37** trường hợp trả 0; **8** trả 1; **0** trả 2; **5** trả 3.
- Kịch bản thực `BM-REQ-001`: 1 sản phẩm eligible trước ngưỡng, 0 sản phẩm đạt ngưỡng; `BM-REQ-011`: 1 kết quả; `BM-REQ-003`: 3 kết quả.
- Trường hợp **2 kết quả** đã được kiểm thử riêng bằng biến thể hồ sơ/ngân sách trong unit tests; không xuất hiện trong 50 kịch bản gốc.
- Audit chạy bằng dữ liệu `Product Profile.name` thực từ Frappe và **không tạo Session/Task**; không phải kiểm thử API end-to-end.

## 3. Hợp đồng kỹ thuật bàn giao cho Task 4 (Tường)

```python
match_products(profile_snapshot, products, settings)
# → {"number_of_eligible_products": int, "results": [...]}
```

- `profile_snapshot`: các field `skin_type`, bảy `concern_*`, `sensitivity`, `requested_category`, `max_budget`, ba `avoid_*`, `preferred_brand` theo Beauty Profile; **không truyền** tên/email/phone.
- `products`: bản ghi `Product Profile` của Frappe, giữ `name` (khóa Link thực tế) và các field theo schema Frappe; không truyền tên cột CSV trực tiếp khi chưa mapping.
- `settings`: `frappe.get_doc("BeautyMatch Settings")` hoặc settings snapshot hợp lệ.
- `number_of_eligible_products` là số sản phẩm vượt H1–H6 **trước** khi áp ngưỡng điểm.
- Mỗi `results[]` trả `rank`, `product` (bằng `Product Profile.name`), 6 điểm thành phần, `final_match_score`, `concern_coverage`, `why_recommended`, `warning_partial_match`. Điểm là số, không gắn `%` trong JSON.
- Task 4 chịu trách nhiệm gọi engine, tạo Session/Item, lưu snapshot, xử lý feedback, CRM Task và API. Engine không thay thế logic kiểm tra quyền ở API.

### Quy tắc bắt buộc

1. H1 Active; H2 category; H3 `0 < price <= max_budget`; H4 đúng skin hoặc xác thực all-skin; H5 tránh thành phần thì chỉ chấp nhận cờ `No` (loại cả `Yes` và `Unknown`); H6 dữ liệu matching đầy đủ và hợp lệ.
2. Settings mặc định `30/30/20/10/5/5`, `minimum_recommendation_score=60`, `number_of_results=3`. Da khớp trực tiếp nhận 100% skin_weight, chỉ all-skin nhận 80%.
3. Concern và ingredient dựa trên tỉ lệ có bằng chứng; không suy diễn công dụng từ tên thành phần.
4. Budget `price <= 80% max_budget`: đủ budget_weight; còn lại dưới/trong ngân sách: 60% budget_weight.
5. Không có preferred_brand: không dùng brand_weight trong mẫu số. `final_match_score = 100 * earned_applicable_points / max_applicable_points`.
6. Xếp hạng: final score giảm → concern coverage giảm → ingredient score giảm → price tăng → product_code tăng. Chỉ trả sản phẩm >=60, tối đa 3. Không nới hard filter khi không có kết quả.

**Cần chốt với Tường trước khi merge:** cách biểu diễn `concern_coverage` là số 0–100, và quy ước sensitivity khi khách chọn `Not specifically sensitive` nhận đủ điểm. Hai diễn giải này đang được dùng trong engine/test.

## 4. Cách kiểm tra lại khi review PR

Tại thư mục gốc repository trên máy Windows:

```powershell
python -m unittest discover -s tests -p "test_*.py" -v
python scripts/audit_catalog.py --out docs/catalog_qc_report.json
python scripts/smoke_matching_catalog.py
```

Trong Docker container (`~/frappe-bench`), với app `beautymatch` và `BeautyMatch Settings` đã đồng bộ:

```bash
bench --site crm.localhost execute beautymatch.scripts.task3_audit.audit_database
bench --site crm.localhost execute beautymatch.scripts.task3_audit.audit_scenarios
```

## 5. Giới hạn demo và hạng mục chưa nghiệm thu

- Theo phạm vi demo rút gọn do thành viên thực hiện lựa chọn: **dùng 69 sản phẩm hiện có, 25 Active để minh họa; không bổ sung đủ 100 sản phẩm trong PR này.** SRS/Task 1 ban đầu quy định AC15 >=100 sản phẩm hợp lệ; **AC15 chưa đạt và phải được nhóm xác nhận chấp nhận ngoại lệ**, không ghi là đã hoàn tất AC15.
- 32/69 sản phẩm chưa đạt kiểm tra H6, hiện không ảnh hưởng đến 25 sản phẩm Active đã vượt H1+H6; không tự bật Active cho sản phẩm thiếu bằng chứng.
- 12 Active thiếu ảnh nên giao diện cần placeholder; dữ liệu Hasaki là snapshot demo, không phản ánh giá/tồn kho realtime.
- Chưa có kiểm thử end-to-end Consultation → API → Session/Feedback → Task → Result UI; phần này thuộc Task 2/4/5.
- Chưa có log xác nhận chạy **re-import lần hai** ra `inserted=0` và không đổi dữ liệu; nếu cần bằng chứng idempotence, kiểm tra riêng.
- Độ truy cập URL và nội dung công bố thành phần/suitability của nguồn bên ngoài chưa được xác minh bằng kiểm tra nguồn trực tiếp.

## 6. Danh sách file thuộc PR

- `beautymatch/services/__init__.py`
- `beautymatch/services/matching_engine.py`
- `beautymatch/scripts/task3_audit.py`
- `data/BeautyMatch_Hasaki_Dataset_Verified.csv`
- `scripts/audit_catalog.py`
- `scripts/smoke_matching_catalog.py`
- `tests/test_matching_engine.py`
- `tests/test_matching_catalog.py`
- `tests/fixtures/customer_profiles_matching_only.csv`
- `tests/fixtures/request_scenarios_matching_only.csv`
- `tests/fixtures/test_cases_matching_only.csv`
- `tests/fixtures/matching_results_0_1_2_3.json`
- `tests/fixtures/offline_examples_0_1_2_3.json`
- `docs/TASK3_HANDOFF_DEMO.md`

Không đưa `add_product_profile_fields.py`, thông tin liên hệ khách hàng, `.env`, mật khẩu hoặc database vào PR.
