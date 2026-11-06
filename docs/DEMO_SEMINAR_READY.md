# BeautyMatch — sẵn demo mô hình khách tự nhận gợi ý

Cập nhật **07/11/2026**. Nhánh **`fix/beautymatch-final-demo`**, baseline **`31a7633a844cf7bc448558e879c41915bbeaefc6`**. Working tree chưa commit; không push/merge/force-push. Site local đã xác minh: **Frappe 15.121.3, CRM 1.86.0**, Docker `crm-frappe-1`, `crm.localhost`.

## 1. Nghiệp vụ hiện tại

**Khách đăng nhập → Beauty Profile + đồng ý lưu → CRM Lead/Current Profile → Top 3 ngay → khách tự phản hồi → xác nhận muốn liên hệ → Contact Request → CRM Task + Notification → nhân viên chăm sóc → Call Log → cập nhật Task → lịch sử → dashboard.**

Không chờ nhân viên để xem sản phẩm. Quan tâm/Không quan tâm chỉ ghi phản hồi, không tạo Task, Deal hoặc Call Log; quy tắc này áp dụng cả khi nhân viên ghi nhận và khi mở session lịch sử. Nguồn phản hồi Customer/Staff được lưu phía server. Đồng ý lưu hồ sơ và đồng ý được liên hệ là hai xác nhận riêng, không chọn sẵn.

Chi tiết dữ liệu, API, phân quyền, sơ đồ và kịch bản **10 phút** ở [BEAUTYMATCH_FINAL_BUSINESS_FLOW](BEAUTYMATCH_FINAL_BUSINESS_FLOW.md).

## 2. Đăng nhập và URL

| Vai trò     | Đăng nhập ngắn | Email gốc giữ nguyên                 |
| ----------- | -------------- | ------------------------------------ |
| Khách       | `khach`        | `customer.demo@example.invalid`      |
| Tư vấn viên | `tuvan`        | `sales.user.demo@example.invalid`    |
| Quản lý     | `quanly`       | `sales.manager.demo@example.invalid` |

Mật khẩu demo hiện có giữ nguyên, đọc tại [credentials local](../.local/seminar-credentials.json); không đưa mật khẩu/token vào Git. Administrator không đổi mật khẩu. Không đổi tài khoản hoặc cấp thêm quyền quản trị trong lần hoàn thiện self-service.

| Màn hình                            | URL                                                   |
| ----------------------------------- | ----------------------------------------------------- |
| Khách tự nhận gợi ý                 | <http://localhost:8000/beautymatch/portal/>           |
| CRM gốc                             | <http://localhost:8000/crm>                           |
| Tổng quan BeautyMatch               | <http://localhost:8000/crm/beautymatch>               |
| Chăm sóc yêu cầu đã đồng ý liên hệ  | <http://localhost:8000/crm/beautymatch/care>          |
| Hồ sơ & lịch sử nhân viên           | <http://localhost:8000/crm/beautymatch/customer>      |
| Báo cáo                             | <http://localhost:8000/crm/beautymatch/dashboard>     |
| Request tư vấn cũ, lưu trữ/tiếp tục | <http://localhost:8000/crm/beautymatch/requests>      |
| Lead QA đã sửa quyền                | <http://localhost:8000/crm/leads/CRM-LEAD-2026-00038> |

Notification mới mở `/crm/beautymatch/contact/<UUID>` bằng named route của CRM; UUID không chứa thông tin liên hệ. Header và action mở đúng Lead của request. Danh sách/số yêu cầu chờ chăm sóc lấy từ API thật, không dựa vào bell. Tổng quan ưu tiên mô hình mới; request v1 được ghi rõ là phiên bản trước.

## 3. Điều kiện dữ liệu demo

Nguyễn Minh Anh: **Combination; Oil Control/Acne/Aging; Serum; 325000; không tránh thành phần; không ưu tiên thương hiệu**. Catalog local **68 = 65 nghiên cứu + 3 mẫu có nhãn trình diễn**, **5 Active**. Engine thật trả ba sản phẩm, điểm **82,46 / 80,35 / 74,04**. B/C hiện trả 0; không ép bộ lọc, sửa claim hoặc thuật toán. [Environment thật](../test-results/self-service/environment.json).

Sản phẩm thiếu ảnh dùng fallback có nhãn; ảnh có bản sao chính xác dùng asset local theo provenance đang có. Điểm, giá và thành phần là snapshot lưu trong Session/Item, không hardcode kết quả. Số điện thoại trong QA là dữ liệu giả lập, không gọi thật.

Chuẩn bị lại một phiên chưa phản hồi, không tự tạo việc:

```powershell
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seed_demo.prepare_self_service
```

Lặp lại giữ cùng phiên nếu hồ sơ đúng và chưa feedback/contact. Sau một lượt demo đã có phản hồi hoặc profile đổi, tạo phiên mới để trình bày, giữ lịch sử cũ. Seed chạy lại không reset mật khẩu, không đổi catalog nghiên cứu. [Seed idempotency](../test-results/self-service/seed-idempotency.json), [chuẩn bị](../test-results/self-service/ready-prepared.json), [lặp lại](../test-results/self-service/ready-repeated.json).

## 4. Demo trực tiếp

1. Mở hai browser profile riêng cho khách và nhân viên; đăng nhập tài khoản đúng vai trò.
2. Khách điền hồ sơ, đồng ý lưu, bấm **Xem sản phẩm phù hợp**. Xem ngay kết quả thật hoặc empty state đã lưu. Reload không thêm session.
3. Khách chọn **Quan tâm** Top 1. Chọn **Không, cảm ơn** để chứng minh chưa có Contact Request/Task. Hồ sơ và feedback vẫn được giữ.
4. Chọn muốn liên hệ. Chọn sản phẩm Interested, Phone nếu Lead có số hợp lệ hoặc Email, kiểm tra contact, thời gian/ghi chú tùy chọn, đồng ý liên hệ riêng, bấm gửi.
5. `tuvan` nhận một notification CRM, nhấn mở đúng request; xem Lead, Task **Todo**, hồ sơ và sản phẩm. Retry đồng thời không thêm Task/notification.
6. Nhân viên thực hiện hoặc thử liên hệ ngoài hệ thống. Với seminar, chọn cờ **DEMO** và ghi rõ cuộc gọi giả lập. Ghi No Answer: Task vẫn mở; lên lịch gọi lại nếu cần.
7. Ghi DEMO Consulted; Task vẫn chưa Done. Bấm **Hoàn thành chăm sóc** riêng. Native Call Log mở được cùng Lead, Task, Note. Khách không còn nhu cầu: hủy việc, Do Not Contact và chặn gọi mới.
8. Xem lịch sử profile/session/feedback/nguồn/Contact/Task/Call. `quanly` mở bốn KPI, hai chart và sáu metric chăm sóc thật. Số DEMO calls hiển thị riêng.

Luồng tại cửa hàng vẫn có: Sales User mở Lead → **Tư vấn với BeautyMatch** → lưu hồ sơ/gợi ý thật → ghi phản hồi nguồn Staff → đồng ý liên hệ riêng mới tạo việc. Không ghi sai rằng khách tự nhấn.

## 5. Build, migrate và kiểm thử

PowerShell tại repository, Docker local đang chạy. Không reset database/volume. **Đợi từng build thành công trước restart**:

```powershell
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost migrate
docker exec -w /home/frappe/frappe-bench/apps/crm/frontend crm-frappe-1 yarn build
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench build --app beautymatch
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-cache
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-website-cache
docker restart crm-frappe-1
```

Đã triển khai thực tế. Portal dùng hashed bundle toàn bộ dependency; không còn import module tĩnh mới/cũ trộn nhau. Fetch timeout 12 giây, watchdog startup 10 giây, retry tiếng Việt. CRM build dùng bridge Custom App đã có; không thêm patch core. Chi tiết upgrade bridge: [CRM_NATIVE_INTEGRATION](CRM_NATIVE_INTEGRATION.md).

```powershell
python -m unittest discover -s tests -p 'test_*.py'
npm.cmd test
npm.cmd run check
npm.cmd run test:self-service
npm.cmd run test:crm
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.self_service_audit.verify
docker exec -w /home/frappe/frappe-bench crm-frappe-1 env/bin/python /workspace/beautymatch/scripts/run_local_frappe_tests.py
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seed_demo.verify_seed
```

Chạy browser flow và seed tuần tự vì cùng cập nhật Customer Demo. E2E dùng API/database thật, giữ bản ghi QA có nhãn làm bằng chứng. Backend audit rollback mọi test write và kiểm tra counts không đổi. TASK4 chỉ bật test tạm, khôi phục site config nguyên byte.

## 6. Kết quả và bằng chứng

| Bộ kiểm thử          | Kết quả đã thực hiện                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python offline       | **56 PASS**                                                                                                                                                                         |
| JS unit              | **25 PASS**, thêm xác nhận feedback không hứa liên hệ trước consent                                                                                                                 |
| Syntax               | **39 module PASS**                                                                                                                                                                  |
| Browser self-service | **10 nhóm PASS**, đúng khach/tuvan/quanly, không lỗi JS, desktop/390/320; [report](../test-results/self-service/report.json)                                                        |
| Backend thật         | **15 nhóm PASS**, gồm unique-key delivery failure thật, phân quyền native Task/Call, opt-out, retry và SQL dashboard; rollback; [report](../test-results/self-service/backend.json) |
| CRM native smoke     | **5 nhóm PASS**, tám module navigation, Lead filter, native Task modal, mobile/dark/Axe scope; [report](../test-results/crm-native-smoke/report.json)                               |
| TASK4                | **9 PASS**: ba test generation gốc giữ nguyên, sáu test feedback đổi sang consent riêng; [log](../test-results/request-consistency/task4.log)                                       |
| Seed                 | PASS, counts/catalog nghiên cứu/credentials không đổi; lần chuẩn bị thứ hai `changed=false`                                                                                         |
| Build                | CRM/Frappe assets thành công; có cảnh báo Browserslist/chunk upstream, không lỗi compile                                                                                            |

Không báo đạt chỉ từ API 200: browser kiểm tra form/cards/feedback/notification/deep link/modal/call timeline/Task state/dashboard thực sự hiển thị và thao tác. Call Logs trong acceptance là **DEMO có nhãn**, không phải đã gọi khách thật.

Các lượt đầu có lỗi selector/chờ nhầm phiên lịch sử trong harness và phạm vi chỉnh test sai; đã sửa, giữ đủ chín TASK4 tests và chạy lại thành công. Không bỏ assertion chức năng. Contract cũ **Interested tự tạo Task** đã bị loại bỏ theo yêu cầu mới; test TASK4 được đổi để kiểm tra không có Task trước consent, một Task sau consent, không tự mở lại việc đã hủy. Các script seminar/P0 browser v1 vẫn giữ nguyên làm lịch sử, không gắn nhãn PASS của v2.

### Đối chiếu 22 tiêu chí

| Tiêu chí                                      | Bằng chứng trong bộ v2                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1–2: nhận gợi ý ngay và lưu đúng Lead/Profile | Browser Top 3; audit first-time Website User, receipt/mapping/current profile                                   |
| 3–4: session/item đúng khách                  | Browser/API 403; audit khách khác, item khác, Lead do caller chỉ định                                           |
| 5: reload không trùng                         | Browser reload và ba generation retry đồng thời cùng UUID                                                       |
| 6: rỗng vẫn lưu session                       | Browser budget 1 và audit kiểm tra record thật                                                                  |
| 7: Interested chưa tạo Task                   | Counts Task/notice trước-sau, Customer và Staff                                                                 |
| 8–10: consent, từ chối và retry               | Browser No/Yes, một Contact/Task/notice; UUID và canonical intent dedup; missing-assignee/delivery failure thật |
| 11–12: đúng nhân viên và ngoài quyền          | Sales User mở Task/Lead thực; audit từ chối Contact/native Task/Call và list rows ngoài Lead scope              |
| 13–14: Call Log chuẩn, đúng liên kết          | Browser native Call Log modal; controller CRM Call Log, Lead, Dynamic Link Task, FCRM Note                      |
| 15–16: không tự Done, gọi lại                 | No Answer → due_date/việc mở; Consulted vẫn mở tới action hoàn thành                                            |
| 17: hồ sơ mới giữ lịch sử                     | Browser empty session mới; điểm/feedback session trước giữ nguyên                                               |
| 18: thống kê đúng                             | Audit Staff/Manager đối chiếu bốn KPI/hai chart và care counts với SQL độc lập                                  |
| 19: chặn khách vào CRM                        | Browser 403 CRM shell và internal care API, role Website User không nâng quyền                                  |
| 20: desktop/mobile                            | 1440, 390, 320; native mobile/dark smoke, không overflow                                                        |
| 21: staff direct consultation                 | Sales User Demo thao tác Lead → form → Top 3 → feedback Staff → consent riêng → Task                            |
| 22: hồi quy/bảo mật                           | 56 Python, 25 JS, TASK4 9, CRM smoke 5 và các audit/browser v2 trên                                             |

### Ảnh ứng dụng thật

- [Top 3 ngay trên Portal](../test-results/self-service/instant-top3-desktop.png), [xác nhận liên hệ](../test-results/self-service/customer-contact-confirmed.png)
- [Bell đúng nhân viên](../test-results/self-service/assigned-contact-notification.png), [request đúng snapshot](../test-results/self-service/staff-contact-details.png)
- [Task native](../test-results/self-service/native-created-task.png), [chưa nghe máy/hẹn lại](../test-results/self-service/callback-keeps-task-open.png)
- [Call Log native](../test-results/self-service/native-call-log-modal.png), [hoàn thành riêng](../test-results/self-service/explicit-task-completion.png)
- [Dashboard quản lý](../test-results/self-service/manager-real-care-dashboard.png), [staff trực tiếp](../test-results/self-service/staff-direct-consultation-separate-consent.png)
- [Portal 320](../test-results/self-service/portal-320.png), [Portal 390](../test-results/self-service/portal-390.png), [Care mobile](../test-results/self-service/staff-care-mobile.png)

**Ready check cuối 00:37 ngày 07/11/2026:** [báo cáo](../test-results/self-service/ready-check.json), [Portal](../test-results/self-service/ready-customer.png), [Tổng quan nhân viên](../test-results/self-service/ready-staff.png), [quản lý](../test-results/self-service/ready-manager.png). Phiên `10kuggfvae` có ba kết quả chưa phản hồi, không có Contact Request; consent form chưa chọn. Đăng nhập/xem dữ liệu không tăng Task, Notification hoặc Call Log.

Bổ sung đã xác nhận trên UI thật: [Không quan tâm và lý do](../test-results/self-service/feedback-ui.json), [ảnh phản hồi](../test-results/self-service/customer-not-interested.png), không tăng Task/Notification/Call. [Worker health](../test-results/self-service/worker-health.json) xác nhận registry và kết nối trực tiếp đều có một worker online. Một lượt Doctor từng đếm 0 dù process/log vẫn xử lý retry Job OK; restart đã khôi phục đăng ký worker, sau đó cả ba tài khoản mở lại thành công.

## 7. Sửa lỗi P0 trước đó vẫn được giữ

Lead `CRM-LEAD-2026-00038` là QA fixture thuộc tài khoản QA đã bị tắt, không phải Lead Portal của Nguyễn Minh Anh (`00030`). Repair có guard chỉ xét ba Lead mapping demo và đúng QA Lead 00038; hủy assignment QA cũ trước rồi lưu owner/ToDo chuẩn vì native hook unassign có thể xóa owner. Sales User Demo có read/write Lead được giao; không System Manager, không bỏ controller permission. Task, Call Log và FCRM Note thuộc chăm sóc BeautyMatch đều kiểm tra Lead; không thể gỡ Link trong payload để vượt quyền. Ghi chú lịch sử chỉ được backfill khi có Call Log/Lead liên kết chắc chắn.

Portal từng tái hiện được module cache cũ thiếu export `fieldErrors`, dừng trước API. Bundle có hash, timeout/watchdog/retry được giữ. Không khẳng định đã đọc cache browser gốc của người báo lỗi. [Bằng chứng P0](../test-results/portal-notifications/) vẫn giữ local; bản bàn giao trước lưu trong `.local/self-service-before/`.

## 8. Giới hạn và lưu ý

- Các bộ browser v1 dùng mô hình chờ tiếp nhận/feedback tự tạo Task không còn là tiêu chí nghiệm thu v2, chưa chuyển toàn bộ các script đó sang UI/contract mới; không công bố chúng là PASS v2. Script/test v2 và core smoke nêu trên là bộ dùng hiện tại.
- `npm.cmd run format:check` toàn repository còn **28 file lỗi style**, tất cả không đổi so với HEAD; scoped Prettier của frontend/tài liệu thay đổi đã PASS. [Log format](../test-results/self-service/format-global.log). Không format hàng loạt code nhóm.
- Không có tổng đài hoặc tự gửi email khách; ghi cuộc gọi thủ công sau khi liên hệ, giả lập phải DEMO. Email hoàn thành qua Task native sau thực hiện thật.
- Cần scheduler/worker để retry nền; thiếu assignee có quyền thì Pending Assignment, quản lý phân công Lead trong CRM rồi mở lại yêu cầu. Không mặc định gửi Administrator.
- Không có OTP điện thoại; quy tắc hiện có chặn ghi đè số đang gắn Lead khi chưa xác minh. Giới hạn phân trang, catalog/ảnh và thiết bị vật lý ghi rõ trong tài liệu nghiệp vụ.
- Bằng chứng, credentials và build output được Git ignore; sao lưu riêng khi chuyển máy. Không reset DB/xóa volume, đổi mật khẩu Administrator, sửa Matching Engine hoặc core CRM.

## 9. Danh sách file trong working tree

Danh sách tổng hợp từ baseline, gồm phần P0 đã có và self-service v2; xem trạng thái Git để review từng diff. File đính kèm yêu cầu và tài liệu Task 3 của thành viên khác không bị sửa.

- [.gitignore](../.gitignore)
- [README.md](../README.md)
- [beautymatch/api/feedback.py](../beautymatch/api/feedback.py)
- [beautymatch/api/frontend.py](../beautymatch/api/frontend.py)
- [beautymatch/api/portal.py](../beautymatch/api/portal.py)
- [beautymatch/api/recommendation.py](../beautymatch/api/recommendation.py)
- [beautymatch/beautymatch/doctype/beautymatch_customer_request/beautymatch_customer_request.json](../beautymatch/beautymatch/doctype/beautymatch_customer_request/beautymatch_customer_request.json)
- [beautymatch/beautymatch/doctype/recommendation_item/recommendation_item.json](../beautymatch/beautymatch/doctype/recommendation_item/recommendation_item.json)
- [beautymatch/beautymatch/doctype/recommendation_session/recommendation_session.json](../beautymatch/beautymatch/doctype/recommendation_session/recommendation_session.json)
- [beautymatch/hooks.py](../beautymatch/hooks.py)
- [beautymatch/public/css/portal.css](../beautymatch/public/css/portal.css)
- [beautymatch/public/js/api.mjs](../beautymatch/public/js/api.mjs)
- [beautymatch/public/js/portal.mjs](../beautymatch/public/js/portal.mjs)
- [beautymatch/scripts/seed_demo.py](../beautymatch/scripts/seed_demo.py)
- [beautymatch/tests/test_task4_api.py](../beautymatch/tests/test_task4_api.py)
- [beautymatch/www/beautymatch/portal.html](../beautymatch/www/beautymatch/portal.html)
- [docs/DEMO_SEMINAR_READY.md](../docs/DEMO_SEMINAR_READY.md)
- [frontend/crm/Workspace.vue](../frontend/crm/Workspace.vue)
- [frontend/crm/integration.mjs](../frontend/crm/integration.mjs)
- [frontend/crm/native.css](../frontend/crm/native.css)
- [frontend/crm/views/Analytics.vue](../frontend/crm/views/Analytics.vue)
- [frontend/crm/views/Customer.vue](../frontend/crm/views/Customer.vue)
- [frontend/crm/views/Overview.vue](../frontend/crm/views/Overview.vue)
- [frontend/crm/views/Requests.vue](../frontend/crm/views/Requests.vue)
- [frontend/crm/views/Results.vue](../frontend/crm/views/Results.vue)
- [package.json](../package.json)
- [scripts/check_frontend.mjs](../scripts/check_frontend.mjs)
- [scripts/prepare_seminar.ps1](../scripts/prepare_seminar.ps1)
- [scripts/verify_seminar.mjs](../scripts/verify_seminar.mjs)
- [beautymatch/api/customer_care.py](../beautymatch/api/customer_care.py)
- [beautymatch/api/self_service.py](../beautymatch/api/self_service.py)
- [beautymatch/beautymatch/doctype/beautymatch_contact_request/**init**.py](../beautymatch/beautymatch/doctype/beautymatch_contact_request/__init__.py)
- [beautymatch/beautymatch/doctype/beautymatch_contact_request/beautymatch_contact_request.json](../beautymatch/beautymatch/doctype/beautymatch_contact_request/beautymatch_contact_request.json)
- [beautymatch/beautymatch/doctype/beautymatch_contact_request/beautymatch_contact_request.py](../beautymatch/beautymatch/doctype/beautymatch_contact_request/beautymatch_contact_request.py)
- [beautymatch/config/customer_care.py](../beautymatch/config/customer_care.py)
- [beautymatch/public/js/beautymatch_portal.bundle.js](../beautymatch/public/js/beautymatch_portal.bundle.js)
- [beautymatch/public/js/portal-client.mjs](../beautymatch/public/js/portal-client.mjs)
- [beautymatch/public/js/portal-results.mjs](../beautymatch/public/js/portal-results.mjs)
- [beautymatch/scripts/portal_notification_audit.py](../beautymatch/scripts/portal_notification_audit.py)
- [beautymatch/scripts/self_service_audit.py](../beautymatch/scripts/self_service_audit.py)
- [beautymatch/services/request_notifications.py](../beautymatch/services/request_notifications.py)
- [docs/BEAUTYMATCH_FINAL_BUSINESS_FLOW.md](../docs/BEAUTYMATCH_FINAL_BUSINESS_FLOW.md)
- [frontend/crm/care-api.mjs](../frontend/crm/care-api.mjs)
- [frontend/crm/components/ContactConsent.vue](../frontend/crm/components/ContactConsent.vue)
- [frontend/crm/views/Care.vue](../frontend/crm/views/Care.vue)
- [frontend/crm/views/RequestEntry.vue](../frontend/crm/views/RequestEntry.vue)
- [scripts/verify_portal_notifications.mjs](../scripts/verify_portal_notifications.mjs)
- [scripts/verify_self_service.mjs](../scripts/verify_self_service.mjs)
- [tests/frontend/portal-client.test.mjs](../tests/frontend/portal-client.test.mjs)
- [tests/frontend/self-service.test.mjs](../tests/frontend/self-service.test.mjs)
