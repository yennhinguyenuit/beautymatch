# BeautyMatch — Product Profile: Mapping & Import Guide

**Phạm vi:** TASK 2 của Nghi — DocType Product Profile và snapshot Hasaki 65 sản phẩm. Đây là dữ liệu demo, không kết nối API Hasaki thời gian thực.

## 1. Tệp trong repository

- DocType: `beautymatch/beautymatch/doctype/product_profile/product_profile.json`
- Script: `beautymatch/scripts/import_hasaki.py`
- CSV: `data/BeautyMatch_Hasaki_Dataset_Verified.csv`
- Tài liệu này: `docs/product-profile/IMPORT_GUIDE.md`

## 2. Mapping chính xác 29 cột

Nguồn chân lý cho ánh xạ là biến `CSV_TO_FRAPPE` trong script import. Các giá trị Check là `0`/`1` (0 = chưa xác nhận phù hợp, không phải chứng cứ không phù hợp).

| STT | CSV | Product Profile fieldname | Loại / quy tắc |
|---:|---|---|---|
| 1 | `product_code` | `product_code` | Data · Required · Unique |
| 2 | `product_name` | `product_name` | Data · Required |
| 3 | `brand` | `brand` | Data · Required |
| 4 | `category` | `category` | Select · Required |
| 5 | `price` | `price` | Currency · Required |
| 6 | `product_url` | `product_url` | Data (URL) |
| 7 | `image_url` | `image_url` | Data (URL, length 500) |
| 8 | `skin_oily` | `suitable_oily` | Check |
| 9 | `skin_dry` | `suitable_dry` | Check |
| 10 | `skin_combination` | `suitable_combination` | Check |
| 11 | `skin_normal` | `suitable_normal` | Check |
| 12 | `skin_all` | `suitable_all_skin` | Check |
| 13 | `sensitive` | `suitable_sensitive` | Check |
| 14 | `concern_oil` | `concern_oil_control` | Check |
| 15 | `concern_acne` | `concern_acne` | Check |
| 16 | `concern_post_acne` | `concern_post_acne` | Check |
| 17 | `concern_dehydration` | `concern_dehydration` | Check |
| 18 | `concern_barrier` | `concern_barrier` | Check |
| 19 | `concern_dullness` | `concern_dullness` | Check |
| 20 | `concern_aging` | `concern_aging` | Check |
| 21 | `key_ingredients` | `key_ingredients` | Small Text |
| 22 | `ingredient_concern_tags` | `ingredient_concern_tags` | Small Text |
| 23 | `fragrance` | `contains_fragrance` | Select |
| 24 | `alcohol_denat` | `contains_alcohol_denat` | Select |
| 25 | `essential_oil` | `contains_essential_oil` | Select |
| 26 | `source_url` | `source_url` | Data (URL) |
| 27 | `data_as_of` | `data_as_of` | Date |
| 28 | `data_completeness` | `data_completeness` | Percent |
| 29 | `status` | `status` | Select |

### Quy ước dữ liệu

- `category`: `CLEANSER`, `TONER`, `SERUM`, `MOISTURIZER`, `SUNSCREEN`.
- `status`: `Active`, `Inactive`. Giữ nguyên trạng thái CSV, không tự nâng sản phẩm Inactive thành Active.
- `fragrance`, `alcohol_denat`, `essential_oil`: chỉ `Yes`, `No`, `Unknown` → ba field `contains_*` tương ứng. **Không đổi Unknown thành No.**
- `skin_all=1` chỉ khi có bằng chứng sản phẩm phù hợp mọi loại da; `sensitive` là một cờ riêng.
- `ingredient_concern_tags` chỉ phản ánh chứng cứ thành phần, không tự sao chép cờ công dụng `concern_*`.
- `data_completeness` là tỷ lệ kiểm tra đầy đủ theo 17 tiêu chí của nhóm; không phải xác suất sản phẩm an toàn hoặc độ đúng tuyệt đối.
- Các URL có thể trống nếu chưa kiểm chứng; không tự sáng tác URL hay rút ngắn URL dài. `image_url` trong DocType đã đặt `length = 500` để chứa URL ảnh dài.
- `product_code` là mã **nội bộ nhóm tạo**, không phải ID sản phẩm thật trên Hasaki.

## 3. Cài đặt và đồng bộ DocType

Chạy trong terminal của container Docker `crm-frappe-1`, tại `~/frappe-bench`:

```bash
bench --site crm.localhost migrate
bench --site crm.localhost clear-cache
```

Xác nhận app `beautymatch` đã được cài và developer mode đã bật. **Không** chạy `bench new-app` hoặc xóa database/volume.

## 4. Dry-run và import thật

```bash
# Kiểm tra CSV, KHÔNG ghi database
bench --site crm.localhost execute beautymatch.scripts.import_hasaki.import_products

# Import thật: True/False theo cú pháp Python của bench execute
bench --site crm.localhost execute beautymatch.scripts.import_hasaki.import_products --kwargs '{"dry_run": False}'
```

Script validate đủ 29 cột, bắt lỗi product_code trùng trong CSV, giá/Category/Check/Avoid Tags/Date không hợp lệ; khi ghi sẽ tìm theo `product_code` để insert, update hoặc bỏ qua không thay đổi. Script dùng commit một lần và rollback khi gặp ngoại lệ.

## 5. Kiểm thử & kết quả quan sát

- CSV đã được thử dry-run: **65 hợp lệ, 2 Active, 63 Inactive**.
- Lần import thành công tại môi trường local: `inserted=65, updated=0, unchanged=0, db_total=65`.
- **Kiểm tra idempotency:** chạy lại chính lệnh import thật; mong đợi `inserted=0, updated=0, unchanged=65, db_total=65` khi không thay đổi CSV. Lưu output thật làm evidence.
- Kiểm tra trên Desk: `http://crm.localhost:8000/app/product-profile`.
- Ví dụ `HASAKI-CLN-007`: Cetaphil cleanser 125ml, `CLEANSER`, 135000 VND, `Active`, data_completeness 94.1, 3 Avoid Tags = `No`.
- Ví dụ sản phẩm `HASAKI-SUN-011`: `SUNSCREEN`, 315000 VND, `Inactive`.

## 6. Giới hạn, bằng chứng, bàn giao

- Script kiểm tra định dạng URL, **không** tự chứng minh URL mở được hay thông tin thành phần trên website còn đúng. Những mục đó cần QC thủ công; không suy diễn từ `CSV OK` rằng toàn bộ URL đã được xác minh.
- Snapshot ghi `data_as_of = 2026-10-12` trong CSV, không phải giá realtime. Giá trị snapshot cần giữ nguyên nếu chưa có xác minh mới.
- Bàn giao PR gồm `product_profile.json` / Python, script import, CSV, tài liệu mapping này, log số bản ghi, và ảnh Desk minh chứng. **Không** đẩy mật khẩu, token, `.env`, `site_config.json`, hoặc dữ liệu khách hàng thật.
- Chỉ làm Product Profile và dataset ở TASK 2. Hard Filter, Scoring, Ranking thuộc TASK 3.
