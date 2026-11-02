# TASK 2 – Consultation Form & Beauty Profile

## 1. Mục tiêu

TASK 2 triển khai luồng tiếp nhận thông tin tư vấn chăm sóc da từ khách hàng, lưu vào Frappe CRM và bàn giao dữ liệu cho Recommendation Engine.

**Phạm vi phụ trách:** Consultation Form, API lưu hồ sơ, CRM Lead, Beauty Profile, Consultation Submission và dữ liệu giả lập.

Không tạo Recommendation Session hoặc CRM Task trong API này.

## 2. Các thành phần đã triển khai

| Thành phần | Đường dẫn |
|---|---|
| Consultation Form | `beautymatch/www/beautymatch/consultation.html` |
| API lưu hồ sơ | `beautymatch/api/profile.py` |
| Consultation Submission DocType | `beautymatch/beautymatch/doctype/consultation_submission/` |
| Script seed | `beautymatch/scripts/seed_consultation_customers.py` |
| 40 hồ sơ khách hàng | `data/simulated/Customer Profiles.csv` |
| 50 kịch bản tư vấn | `data/simulated/Request Scenarios.csv` |

## 3. Luồng xử lý

1. Khách hàng truy cập `/beautymatch/consultation`.
2. Nhập thông tin liên hệ, tình trạng da, nhu cầu sản phẩm và đồng ý lưu thông tin.
3. Form gửi yêu cầu POST đến `beautymatch.api.profile.save_beauty_profile`.
4. Backend kiểm tra dữ liệu và tìm CRM Lead theo thông tin liên hệ.
5. Nếu chưa tồn tại, tạo CRM Lead và Beauty Profile mới; nếu đã tồn tại, cập nhật Beauty Profile hiện có.
6. Backend lưu Consultation Submission để nhận diện các lần gửi có cùng `request_id`.
7. API trả về thông tin Lead, Profile, Request và phiên bản hồ sơ.
8. Frontend lưu kết quả vào `sessionStorage["beautymatch_pending_v1"]`, sau đó chuyển đến `/beautymatch/result`.

## 4. API Contract

**Endpoint**

`POST /api/method/beautymatch.api.profile.save_beauty_profile`

**Các trường đầu vào**

- Thông tin khách hàng: `full_name`, `email`, `phone`.
- Loại da: `skin_type` (`OILY`, `DRY`, `COMBINATION`, `NORMAL`).
- Vấn đề da: 7 trường `concern_*`; chọn từ 1 đến 3 vấn đề.
- Độ nhạy cảm: `sensitivity`.
- Danh mục: `requested_category` (`CLEANSER`, `TONER`, `SERUM`, `MOISTURIZER`, `SUNSCREEN`).
- Ngân sách: `max_budget` lớn hơn 0.
- Thành phần cần tránh: `avoid_fragrance`, `avoid_alcohol_denat`, `avoid_essential_oil`.
- Thương hiệu ưu tiên: `preferred_brand` (không bắt buộc).
- Đồng ý lưu thông tin: `consent = 1`.
- Mã lượt tư vấn: `request_id` (UUID).

Yêu cầu cần người dùng Frappe đã đăng nhập, có quyền CRM Lead phù hợp. API không cho phép Guest.

**Các trường trả về**

```json
{
  "crm_lead": "<CRM Lead ID>",
  "beauty_profile": "<Beauty Profile ID>",
  "request_id": "<UUID>",
  "profile_version": "<Profile Version>",
  "is_existing_lead": true
}
```

Khi gọi thông qua Frappe HTTP API, dữ liệu thường nằm trong thuộc tính `message`.

**Idempotency:** Gửi lại cùng `request_id` với cùng payload trả về kết quả đã lưu; sử dụng cùng `request_id` với payload khác bị từ chối. Khách quay lại bằng thông tin liên hệ phù hợp được tái sử dụng CRM Lead và Beauty Profile.

## 5. Hợp đồng tích hợp với Result Page

Sau khi API trả về thành công, Consultation Form lưu:

`sessionStorage["beautymatch_pending_v1"]`

Nội dung gồm đúng bốn trường:

```json
{
  "crm_lead": "<CRM Lead ID>",
  "beauty_profile": "<Beauty Profile ID>",
  "request_id": "<UUID>",
  "profile_version": "<Profile Version>"
}
```

Trang `/beautymatch/result` do Nhi triển khai cần đọc bốn giá trị này để gọi Recommendation API của Tường.

API Recommendation dự kiến:

`beautymatch.api.recommendation.generate_recommendations(crm_lead, beauty_profile, request_id, profile_version)`

**Chú ý:** Consultation API không trực tiếp tạo Recommendation Session. Phần này thuộc Recommendation Engine.

## 6. Cách chạy

**Điều kiện:** Docker/Frappe hoạt động, ứng dụng BeautyMatch đã được cài vào site `crm.localhost` và DocType đã được đồng bộ.

Truy cập:

`http://crm.localhost:8085/beautymatch/consultation`

Đăng nhập bằng tài khoản được cấp quyền phù hợp, điền Form và nhấn **Xem gợi ý sản phẩm**.

Nếu chưa tích hợp trang Result của Nhi, việc chuyển hướng đến `/beautymatch/result` có thể hiển thị 404 dù Consultation API đã lưu thành công.

## 7. Dữ liệu giả lập

Bộ dữ liệu nhóm cung cấp gồm:

- 40 Customer Profiles: 40 khách hàng duy nhất.
- 50 Request Scenarios: 40 `FIRST_VISIT` và 10 `SECOND_VISIT`.

Để chạy seed trên môi trường local:

```bash
cd ~/frappe-bench
bench --site crm.localhost console
```

Trong Frappe Console:

```python
from beautymatch.scripts.seed_consultation_customers import seed
seed()
```

Script tạo file `data/simulated/customer_seed_mapping.csv`, ánh xạ customer key với CRM Lead và Beauty Profile. File mapping này được loại khỏi Git vì các ID phụ thuộc từng database.

**Lưu ý:** Chỉ chạy seed trên môi trường demo/test được phép thêm dữ liệu.

## 8. Kết quả kiểm thử thực tế

Thực hiện ngày 02/11/2026 trên site local `crm.localhost`.

| Hạng mục | Kết quả |
|---|---|
| Gửi Consultation Form qua trình duyệt | PASS |
| Lưu CRM Lead, Beauty Profile | PASS |
| Lưu bốn giá trị vào sessionStorage | PASS |
| Seed 40 khách hàng | 40/40 PASS |
| Kiểm tra mapping Lead – Profile | 40/40 hợp lệ |
| 10 kịch bản SECOND_VISIT | 10/10 PASS |
| 40 kịch bản FIRST_VISIT | 40/40 PASS |

Database sau kiểm thử:

- CRM Lead: 54.
- Beauty Profile: 42.
- Consultation Submission: 91.

Trong 50 kịch bản Request Scenarios, không phát sinh thêm CRM Lead hoặc Beauty Profile.

Do 40 khách hàng đã được seed trước khi chạy Request Scenarios, các kịch bản `FIRST_VISIT` được kiểm thử với khách đã tồn tại, không phải trên database trống.

**Chưa kiểm thử tích hợp end-to-end với Matching Engine và Result Page**, vì hai thành phần này thuộc nhiệm vụ của Tường và Nhi.

## 9. Bàn giao cho nhóm

**Nhi – Result Page:** Đọc `beautymatch_pending_v1`, gọi Recommendation API, hiển thị kết quả và xử lý trường hợp thiếu dữ liệu phiên tư vấn.

**Tường – Recommendation Engine:** Sử dụng `crm_lead`, `beauty_profile`, `request_id`, `profile_version` từ Consultation để tính gợi ý và quản lý Recommendation Session.

**Lưu ý chung:** Không đổi tên bốn trường trong hợp đồng tích hợp nếu chưa thống nhất với nhóm.