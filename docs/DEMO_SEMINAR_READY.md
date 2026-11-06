# BeautyMatch — Demo seminar CRM

Bàn giao trên `develop`, từ working tree sạch tại `c2a1afc`. Môi trường local: Frappe **15.121.3**, CRM **1.86.0**, site `crm.localhost`, container `crm-frappe-1`. Không commit, push, merge, reset database hoặc thay mật khẩu Administrator.

## A. Kiến trúc và hai luồng

**Khách:** `/beautymatch/portal` → đăng nhập Website User → nhập nhu cầu, đồng ý lưu thông tin → gửi → CRM Lead + một Current Beauty Profile → yêu cầu Pending. Portal chỉ hiển thị hồ sơ và trạng thái của chính khách, không có navigation CRM.

**Nhân viên:** CRM → BeautyMatch → Yêu cầu tư vấn → Tiếp nhận tư vấn → form điền sẵn → xác nhận đồng ý mới → Lưu hồ sơ & tạo gợi ý → Top 3 thật → Quan tâm → Task CREATED → lịch sử → dashboard. Các màn hình nội bộ dùng cùng Vue Router, Pinia, sidebar và layout CRM, không iframe hoặc SPA thứ hai.

| DocType | Dữ liệu và quan hệ |
| --- | --- |
| `User` | Sales Manager/Sales User hoặc Website User với role mới `BeautyMatch Customer` |
| `BeautyMatch Customer Account` mới | Mapping server quản lý, unique User và unique CRM Lead |
| `CRM Lead` | Đối chiếu email/phone; Lead portal mới thuộc default assignee |
| `Beauty Profile` | Một hồ sơ hiện tại trên Lead, tái sử dụng logic TASK 2 |
| `Consultation Submission` | UUID, hash payload, profile_version và receipt cho retry |
| `BeautyMatch Customer Request` mới | Khách, Lead/profile, snapshot, nhân viên, session; Pending → In Progress → Completed. Pending cũ thành Superseded khi khách gửi mới |
| `Recommendation Session` / `Recommendation Item` | Snapshot hồ sơ/cấu hình/kết quả và feedback; không ghi đè phiên trước khi cập nhật profile |
| `CRM Task` | Lead, session, item, assignee; key chống trùng theo session/item |

Portal tái sử dụng validation, khóa request/contact, nhận diện và `_save_profile` của TASK 2 trong service có kiểm tra sở hữu. Endpoint không đổi user để nâng quyền. Email được lấy từ tài khoản; không nhận Lead/user tùy ý, không dùng phone đơn lẻ để chiếm Lead có email khác. Khách không có quyền CRUD các DocType nội bộ; API nhân viên vẫn kiểm tra role và quyền từng Lead. Hook chặn CRM chỉ áp dụng cho **Website User**, tránh chặn Administrator vốn nhận mọi role từ Frappe.

`set_user` chỉ dùng trong seed/audit local có guard Administrator để thực thi API theo vai trò demo. Hai DocType mới chỉ cho System Manager CRUD; staff và khách đi qua các endpoint chuyên biệt. Không đổi quyền CRM toàn cục hoặc thuật toán.

## B. Tài khoản và URL

| Vai trò | Username | Sử dụng |
| --- | --- | --- |
| Customer Demo | `customer.demo@example.invalid` | Website User, chỉ hồ sơ của mình |
| Sales User Demo | `sales.user.demo@example.invalid` | Nhân viên phụ trách ba Lead mẫu, default follow-up assignee |
| Sales Manager Demo | `sales.manager.demo@example.invalid` | Quản lý queue, hồ sơ, dashboard và công việc theo quyền CRM hiện có |
| Administrator | `Administrator` | Tài khoản local cũ, mật khẩu không thay đổi |

**Lấy mật khẩu từ `.local/seminar-credentials.json` bằng editor local.** File được Git ignore; mật khẩu ngẫu nhiên, không hardcode/in stdout/gửi email. Chạy lại không reset password hay tạo user trùng. Không chép file vào slide hoặc source. Khách không có Sales User/System Manager; không mở public signup.

- Khách: <http://localhost:8000/beautymatch/portal>
- CRM: <http://localhost:8000/crm>
- Tổng quan: <http://localhost:8000/crm/beautymatch>
- Tiếp nhận: <http://localhost:8000/crm/beautymatch/requests>
- Tư vấn: `/crm/beautymatch/consultation`
- Kết quả: `/crm/beautymatch/result`
- Hồ sơ/lịch sử: `/crm/beautymatch/customer`
- Phản hồi: `/crm/beautymatch/feedback`
- Báo cáo: <http://localhost:8000/crm/beautymatch/dashboard>

Ngữ cảnh Lead/session nằm trong sessionStorage, không đưa tên/email/phone vào URL. Chưa có phiên thì trang kết quả hiện hướng dẫn, không tự tạo. Website cũ `/beautymatch/...` được giữ để tương thích.

## C. Khởi động và chuẩn bị

PowerShell tại `C:\Users\Yen Nhi\frappe-crm\beautymatch`, Docker Desktop đang chạy. Ba container của project phải đã được tạo theo cấu hình repository cha. Không dựng lại database.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare_seminar.ps1
```

Đã chạy chính script này: start → check/apply patch → migrate → seed → chuẩn bị yêu cầu A Pending → build CRM/app → clear cache → restart. Đợi site lên, mở URL và Ctrl+F5. Script dừng nếu một bước lỗi.

Lệnh riêng khi cần kiểm tra:

```powershell
docker start crm-mariadb-1 crm-redis-1 crm-frappe-1
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost list-apps
# Chỉ nếu list-apps chưa có BeautyMatch, với app source đã đặt trong bench:
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost install-app beautymatch
docker exec crm-frappe-1 python /workspace/beautymatch/scripts/crm_native_patch.py --check
docker exec crm-frappe-1 python /workspace/beautymatch/scripts/crm_native_patch.py --apply
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost migrate
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seed_demo.seed_demo
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seed_demo.prepare_presentation
docker exec -w /home/frappe/frappe-bench/apps/crm/frontend crm-frappe-1 yarn build
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench build --app beautymatch
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-cache
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-website-cache
docker restart crm-frappe-1
```

`prepare_presentation` chỉ đưa A về hồ sơ 325.000 và một yêu cầu chờ tiếp nhận, giữ nguyên lịch sử. Chạy lại khi đã có Pending cùng thông số không thêm request. Sau demo khách quay lại với 324.000, gọi bước này để chuẩn bị buổi sau.

Hai user staff được lưu preference tương đương **Skip All onboarding** qua API Frappe; không tạo Deal hoặc nghiệp vụ onboarding giả. Browser mới có thể vẫn mở Help một lần lúc preference đồng bộ; đóng bằng X. Không dùng CSS/DOM hack ẩn Help.

## D. Dataset và kết quả thật

| Khách giả lập | Hồ sơ | Kết quả xác minh |
| --- | --- | --- |
| Nguyễn Minh Anh | Combination; Oil Control, Acne, Aging; không đặc biệt nhạy cảm; Serum; 325.000; không tránh/ưu tiên brand | **3 eligible, 3 kết quả**, điểm **82,46 / 80,35 / 74,04** |
| Trần Ngọc Hà | Dry; Dehydration, Skin Barrier; Sensitive; Moisturizer; 400.000; tránh Fragrance | **0 kết quả**; không có Active đủ điều kiện, không suy đoán thành phần an toàn |
| Lê Khánh Linh | Oily; Acne, Oil Control; Sunscreen; 150.000 | **0 kết quả**, dùng minh họa empty state |

A dùng email Customer Demo; B/C dùng `tran.ngoc.ha.demo@example.invalid`, `le.khanh.linh.demo@example.invalid`. Không dùng số điện thoại hoặc dữ liệu cá nhân thật. Cả ba Lead thuộc Sales User Demo.

Seed tạo ba phiên thật, một Task Quan tâm của A và yêu cầu chờ nhân viên. Browser test tạo thêm các phiên/Task demo để kiểm tra khách quay lại. Chúng được giữ để minh họa lịch sử; không xóa khách có sẵn. Chống trùng Task theo item/session, không phải một Task cho toàn bộ khách.

**Catalog:** 68 Product Profile = **65 nghiên cứu + 3 bản sao demo `BM-DEMO-*`**. Active: 2 nghiên cứu + 3 demo = **5 bản đủ trường bắt buộc của engine**. Tên demo có “Mẫu trình diễn”, không báo cáo là sản phẩm nghiên cứu mới. Seed không tự tạo sản phẩm Hasaki hoặc suy đoán thành phần.

CSV hiện có **69 dòng**; bốn code chưa có bản nghiên cứu trong DB: `HASAKI-SER-013`, `HASAKI-SUN-012`, `HASAKI-SUN-013`, `HASAKI-SUN-014`. Nhiều bản gốc đã có khác biệt ảnh/status/claim so với CSV. Không tự ghi đè hoặc bật Active chúng. Bản demo `BM-DEMO-HASAKI-SER-013` có thể tồn tại dù bản nghiên cứu gốc chưa được import. Đối chiếu chi tiết: `.local/seminar-data.json` và report seminar.

Đây **chưa phải catalog đồng bộ hoàn toàn với CSV**. Nếu nhóm duyệt dataset mới, import có review riêng rồi chạy lại matching; kết quả B/C có thể đổi. Không giữ empty state bằng cách sửa thuật toán. B hiện 0 được báo đúng, không thêm fixture thành phần bịa để ép có kết quả.

Giữ Content-based + Rule-based: Active/category/budget/skin/avoid/H6 → điểm trọng số → ngưỡng **60** → Top 3. Trọng số hiện tại: **30/30/20/10/5/5** cho skin/concern/ingredient/sensitivity/budget/brand; brand không chọn được loại khỏi mẫu số theo engine. Ảnh thiếu dùng fallback rõ ràng, không đổi sang sản phẩm khác.

## E. Kịch bản seminar 7 phút

Dùng hai browser profile hoặc cửa sổ thường/ẩn danh để session khách và staff tách nhau. Mở credentials bằng editor riêng, không chiếu mật khẩu.

| Thời gian | Thao tác | Lời giải thích gợi ý |
| --- | --- | --- |
| 0:00–0:45 | Customer Demo vào portal, kiểm tra A và **325000**, chọn đồng ý, **Gửi yêu cầu tư vấn** | Khách chủ động chia sẻ nhu cầu và đồng ý lưu thông tin; server xác định hồ sơ từ tài khoản. |
| 0:45–1:30 | Sales User đăng nhập CRM → BeautyMatch → **Yêu cầu tư vấn** → Chờ tiếp nhận → **Xem yêu cầu** | Nhân viên nhìn thấy yêu cầu gắn với Lead có quyền quản lý. |
| 1:30–2:15 | A → **Tiếp nhận tư vấn** → kiểm tra form điền sẵn → đồng ý mới → **Lưu hồ sơ & tạo gợi ý** | Cập nhật một Current Profile; phiên tư vấn lưu snapshot để giữ lịch sử. |
| 2:15–3:00 | Xem Top 3, giá/điểm/lý do/partial warning | Lọc điều kiện bắt buộc trước chấm điểm; không phải chẩn đoán hoặc quét khuôn mặt. |
| 3:00–4:00 | Top 1 → **Quan tâm** → chờ **CREATED** → **Mở CRM Task** → kiểm tra Assigned To/Title → đóng X | Tín hiệu quan tâm tạo công việc thật, liên kết Lead/session/item; không tự tạo Deal. |
| 4:00–5:00 | Khách đổi ngân sách **324000**, đồng ý, gửi; staff tiếp nhận và tạo phiên tiếp | Nhu cầu thay đổi vẫn dùng cùng Lead/profile; tạo session mới. |
| 5:00–5:40 | **Hồ sơ da**, mở phiên trước; hoặc tìm Lê Khánh Linh → hồ sơ/lịch sử → mở kết quả | Phiên cũ không bị ghi đè; không có sản phẩm thì hiển thị rõ. |
| 5:40–6:30 | **Báo cáo tư vấn → Cập nhật báo cáo**, giới thiệu 4 KPI/2 chart | Dữ liệu thật theo quyền; interest_rate = tỷ lệ phiên có ít nhất một Interested. |
| 6:30–7:00 | Sales Manager Demo mở dashboard/queue ở browser riêng | CRM nối tiếp nhận, cá nhân hóa, phản hồi và chăm sóc trong một luồng. |

Demo staff ngắn có thể bắt đầu ngay từ yêu cầu A Pending đã chuẩn bị. Không quan tâm: bắt buộc chọn lý do, gửi và chờ thành công; Task hiện có chuyển Canceled. Quan tâm lại mở cùng Task. Demo đã đặt assignee Sales User và hạn một ngày; PENDING chỉ dùng khi thực sự chưa có assignee.

## F. Kiểm thử và ảnh thật

```powershell
python -m unittest discover -s tests -p 'test_*.py'
npm.cmd test
npm.cmd run check
npx.cmd playwright test --workers=1
npm.cmd run test:crm:native:flow
npm.cmd run test:seminar
python scripts/verify_crm_patch.py
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seminar_audit.verify
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seed_demo.verify_seed
```

| Nhóm | Kết quả cuối |
| --- | --- |
| Python | **54 PASS**, gồm 4 test guard Website User/Administrator |
| JavaScript / syntax | **17 PASS / 30 module PASS** |
| Website desktop/mobile | **20 PASS**, một worker |
| CRM native Administrator + Sales User | **13 nhóm PASS**, CREATED thật, navigation/filter/reload/mobile/dark, 0 lỗi JS |
| Seminar browser | **7 nhóm PASS**, 0 lỗi JS; Customer mobile và native results Axe 0 vi phạm |
| Backend seminar | **9 nhóm PASS**, rollback toàn bộ và số bản ghi không đổi |
| Seed | **PASS**: counts, hash catalog nghiên cứu và credentials không đổi khi chạy lại |
| Recovery patch | **PASS**: apply/idempotency/reapply sau khôi phục source gốc/rollback/refuse later edits trên bản sao baseline thật |
| Build/migrate/start/restart | **PASS** qua chính script PowerShell bàn giao |
| Sẵn demo sau restart cuối | **PASS** đăng nhập cả bốn vai trò; A Pending 325.000, đồng ý không chọn sẵn, Customer vẫn bị chặn CRM |

`test:seminar` gọi site/API thật, không intercept. Nó tắt mạng thật một lần để kiểm tra lỗi/retry UUID, gửi lặp đồng thời, thử HTTP bị từ chối, rồi handoff/Task/returning/empty/mobile/dark. Browser giữ dữ liệu demo đã tạo. Audit backend kiểm tra thêm lifecycle Task, PENDING, profile đơn nhất, Guest, Sales User bị chặn Lead ngoài phân công và 4 KPI/cả hai chart bằng SQL độc lập theo scope; mọi test write của nhóm audit được rollback.

Bằng chứng: [seminar](../test-results/seminar/report.json), [backend cuối](../test-results/seminar/backend-final.json), [seed](../test-results/seminar/seed-idempotency.json), [patch](../test-results/seminar/patch-recovery.json), [native CRM](../test-results/crm-native/report.json), [readiness sau restart](../test-results/seminar/ready-check.json), [phiên bản/catalog](../test-results/seminar/environment.json).

Ảnh Playwright từ ứng dụng đang chạy:

- [Customer Intake](../test-results/seminar/customer-intake.png), [submit](../test-results/seminar/customer-submitted.png), [mobile](../test-results/seminar/customer-mobile.png)
- [CRM Leads](../test-results/seminar/crm-leads.png), [queue và sidebar](../test-results/seminar/staff-requests.png)
- [Beauty Profile](../test-results/seminar/beauty-profile.png), [Top 3](../test-results/seminar/recommendations.png), [empty](../test-results/seminar/empty-result.png)
- [Feedback CREATED](../test-results/seminar/feedback-created.png), [CRM Task](../test-results/seminar/crm-task.png), [History](../test-results/seminar/history.png)
- [Dashboard staff](../test-results/seminar/dashboard.png), [Manager](../test-results/seminar/manager-dashboard.png), [dark](../test-results/seminar/native-dark.png)
- [Portal sẵn demo sau restart](../test-results/seminar/ready-customer.png), [mobile sẵn demo](../test-results/seminar/ready-customer-mobile.png), [queue Pending](../test-results/seminar/ready-staff.png)

Lỗi đã sửa: guard chặn nhầm Administrator vì superuser có mọi role; tên hồ sơ sau cập nhật; row lock khi tiếp nhận; thông báo lỗi mạng tiếng Việt; timestamp portal kèm offset timezone site; array đối số Docker trong PowerShell. Harness sửa cách đóng Help/Getting started bằng X và giới hạn localStorage theo origin. Các lượt cuối đều đạt; không bỏ/xóa test để che lỗi.

## G. File thay đổi, bảo trì và checklist

File mới trong app: `api/portal.py`; hai DocType `beautymatch_customer_account`, `beautymatch_customer_request`; `config/portal.py`; `www/beautymatch/portal.py/html`; `public/js/portal.mjs`, `intake-domain.mjs`; `public/css/portal.css`; `scripts/seed_demo.py`, `seminar_audit.py`; `frontend/crm/portal-api.mjs`, `views/Requests.vue`. Root: `scripts/prepare_seminar.ps1`, `verify_seminar.mjs`, `verify_crm_patch.py`; `tests/test_portal_access.py`; tài liệu này.

File sửa: `hooks.py`; `frontend/crm/Workspace.vue`, `integration.mjs`, `store.mjs`, `domain.mjs`, `native.css`, `views/Overview.vue`; `.gitignore`, `package.json`, `scripts/check_frontend.mjs`, `scripts/crm_native_patch.py`; README và tài liệu liên quan. `domain.mjs` re-export module thuần dùng chung portal/CRM. Matching engine và contract TASK 2/3/4 không đổi.

CRM chưa có route/sidebar plugin chính thức. Vẫn chỉ patch bốn file host đã đánh giá: `frontend/vite.config.js`, `frontend/src/router.js`, `frontend/src/utils/navigation.js`, `frontend/src/components/Layouts/AppSidebar.vue`. Không thêm file core cần patch trong tác vụ seminar. Source CRM thuộc repository riêng trong container, không đi theo commit BeautyMatch.

Patch/script nằm trong Git. Backup/hash chuyển sang **`.local/crm-native-patch/` trên bind mount host**, không phụ thuộc test-results tạm. Đúng baseline có thể reapply sau dựng lại container, dùng lại backup đã kiểm tra hash; khác version/baseline sẽ dừng. Recovery đã thử trên bản sao source, không phá container đang dùng. Restart thật đã được kiểm tra.

```powershell
# Chỉ dùng khi chủ đích rollback; từ chối nếu host đã sửa tiếp
docker exec crm-frappe-1 python /workspace/beautymatch/scripts/crm_native_patch.py --rollback
```

Sau rollback phải build host và khôi phục entrypoint app tương ứng. Khi nâng CRM, review version/patch và test lại; không git reset hoặc xóa volume.

- [ ] Docker chạy; thực hiện `prepare_seminar.ps1`, đợi site lên và Ctrl+F5.
- [ ] Mở credentials ở editor riêng, không chiếu; dùng browser session khách/staff riêng.
- [ ] Đóng Help bằng X nếu browser mới mở lần đầu.
- [ ] A có 325.000 và Pending; default assignee là Sales User Demo, hạn một ngày.
- [ ] Mở sẵn portal/queue/dashboard; sidebar chỉ một mục BeautyMatch.
- [ ] Chọn đồng ý mới trên cả hai form; đợi CREATED thật trước giới thiệu Task.
- [ ] Gọi dữ liệu demo đúng nhãn; nêu B/C hiện 0 và catalog chưa đồng bộ toàn CSV.

Giới hạn: catalog/ảnh như mục D; không public signup hoặc gửi email thật; chart native CRM upstream có timer ResizeObserver nếu rời Dashboard quá nhanh, ngoài phạm vi bridge. Axe chỉ quét các vùng đã ghi, không chứng nhận toàn CRM. `.local/` và `test-results/` Git ignore: bảo quản credentials/backup riêng, sao chép ảnh khi chuyển máy. Không có mock adapter trong luồng seminar.
