# BeautyMatch — bàn giao sửa lỗi và demo seminar

Cập nhật 06/11/2026. Nhánh **`fix/request-consistency-ux`**, tạo từ `develop` sạch tại commit **`89d7aecee8ccd48be6376489980ce5b14a4634ca`**. Thay đổi nằm trong working tree; không commit, push hoặc merge. Đã triển khai trực tiếp trên Docker local: **Frappe 15.121.3 / CRM 1.86.0**, site `crm.localhost`, container `crm-frappe-1`.

## 1. Luồng cuối cùng và URL

**Customer Login → Beauty Profile → Submit Request → CRM Lead → Staff Accept → Consultation → Recommendation → Feedback → CRM Task → History → Dashboard.**

| Màn hình                   | URL local                                            |
| -------------------------- | ---------------------------------------------------- |
| Portal khách               | <http://localhost:8000/beautymatch/portal>           |
| CRM gốc                    | <http://localhost:8000/crm>                          |
| Tổng quan BeautyMatch      | <http://localhost:8000/crm/beautymatch>              |
| Yêu cầu tư vấn             | <http://localhost:8000/crm/beautymatch/requests>     |
| Khách hàng & lịch sử       | <http://localhost:8000/crm/beautymatch/customer>     |
| Báo cáo                    | <http://localhost:8000/crm/beautymatch/dashboard>    |
| Tư vấn, mở theo luồng      | <http://localhost:8000/crm/beautymatch/consultation> |
| Kết quả, mở theo luồng     | <http://localhost:8000/crm/beautymatch/result>       |
| Route phản hồi tương thích | <http://localhost:8000/crm/beautymatch/feedback>     |

Bốn tab chính: **Tổng quan / Yêu cầu tư vấn / Khách hàng & lịch sử / Báo cáo**. Tư vấn và kết quả vẫn có route để reload; phản hồi ở kết quả hoặc bộ lọc **Chỉ phiên có phản hồi** trong lịch sử. Route phản hồi cũ vẫn hoạt động. Mở kết quả khi chưa chọn phiên sẽ hiện hướng dẫn, không tự tạo session.

Portal chỉ cho Website User có role `BeautyMatch Customer`, không có navigation hoặc Sales role. Nhân viên làm việc trong Vue Router, Pinia, sidebar, layout và phiên đăng nhập của CRM hiện có. Các API kiểm tra vai trò và quyền Lead ở backend; sessionStorage hoặc menu ẩn không cấp quyền.

## 2. Lỗi đã sửa và quy tắc nhất quán

| Lỗi/nguyên nhân                                                             | Cách sửa                                                                                                                                                                        |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Form yêu cầu A đọc Current Profile đã bị B cập nhật                         | Form lấy snapshot bất biến của chính request từ server. Khi khách gửi mới, Pending **và In Progress** cũ thành Superseded, giữ nhân viên phụ trách và liên kết `superseded_by`. |
| Hoàn tất chỉ kiểm tra cùng Lead/profile                                     | Server kiểm tra nhân viên tiếp nhận, trạng thái, session đã liên kết, receipt và `profile_version`; không dùng session của B hoàn tất A.                                        |
| Hai nhân viên có thể tiếp nhận chồng nhau, Manager có thể ghi đè người nhận | Khóa account/request đến commit/rollback; chỉ một người nhận. Manager có quyền xem nhưng không tự chiếm yêu cầu đã tiếp nhận.                                                   |
| Retry đồng thời gặp `TimestampMismatchError`                                | MariaDB local thực tế là `REPEATABLE-READ`. Dùng locking read cho receipt, mapping/Lead và Current Profile sau khi chờ khóa.                                                    |
| UUID tư vấn cũ có thể trỏ tới session không thuộc yêu cầu mới               | Lần tạo đầu tiên yêu cầu một UUID tư vấn chưa dùng; retry đã có session phải khớp hash nội dung đã xác nhận.                                                                    |
| `complete_request` lỗi làm màn hình mất kết quả đã lưu                      | Lưu liên kết request–session trên server ngay trong giao dịch tạo session. Hoàn tất là bước riêng, có cảnh báo và nút thử lại, không gọi generation lần nữa.                    |
| Bộ lọc mới có thể hiển thị phản hồi cũ đến trễ hoặc dữ liệu cũ khi lỗi      | Mỗi query có phiên bản; xóa rows khi bắt đầu tải, bỏ qua success/error cũ, reset trang khi đổi trạng thái, có retry.                                                            |
| Chỉ lọc feedback trong 10 session vừa tải                                   | Backend lọc bằng `EXISTS` trước `LIMIT/OFFSET`, trả tổng số phiên có phản hồi chính xác và thứ tự creation/name ổn định.                                                        |
| Lead/session không phân vùng đầy đủ khi đổi tài khoản                       | Context native có owner xác thực. Đổi tài khoản/logout/hết phiên làm mất hiệu lực hoặc xóa context cũ; không nhập lại khóa legacy không rõ owner.                               |

### Trạng thái yêu cầu

| Trạng thái  | Ý nghĩa và điều kiện                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pending     | Portal đã lưu hồ sơ và request thành công; chưa có nhân viên nhận.                                                                                                          |
| In Progress | Nhân viên có quyền Lead tiếp nhận, `assigned_to` là chính nhân viên đó. Có thể chưa tạo session hoặc đã có session đang chờ cập nhật trạng thái.                            |
| Completed   | Backend xác nhận session được tạo qua phiên tư vấn đã ràng buộc với request, đúng version và đúng nhân viên nhận. Retry cùng session trả Completed, không tạo thêm session. |
| Superseded  | Khách đã gửi yêu cầu mới hơn. Snapshot, nhân viên phụ trách, session cũ nếu có và lịch sử được giữ. Không tiếp tục tạo mới/hoàn tất yêu cầu cũ.                             |

Chuyển trạng thái: **Pending → In Progress → Completed**; **Pending hoặc In Progress → Superseded** khi khách gửi yêu cầu mới. Completed không bị thay thế. Giao diện hiển thị rõ yêu cầu mới hơn và thông báo xung đột bằng tiếng Việt; không chuyển hồ sơ B vào form A.

Snapshot gồm payload/hash, khách, Lead/profile và version lúc gửi, được DocType validation bảo vệ khỏi chỉnh sửa. Nhân viên có thể chọn **Chỉnh sửa thông tin**, nhưng dữ liệu sửa được lưu vào Consultation Submission/version riêng. Consent luôn bỏ chọn khi tải form; phải xác nhận lại trước khi tạo tư vấn.

Khóa portal dùng account → request; generation tiếp tục khóa contact → Lead → profile theo thứ tự TASK2 để tránh chờ vòng. Tạo submission, matching thật, session và liên kết request–session cùng một giao dịch. Giao dịch lỗi thì rollback. Advisory lock được giải phóng khi commit/rollback.

Thay đổi cần thiết trong [API hồ sơ](../beautymatch/api/profile.py) chỉ là current read `FOR UPDATE` cho Lead/Profile sau khi chờ khóa, giữ kiểm tra quyền đọc/ghi, validation và response hiện có. Không đổi matching engine, công thức điểm, API recommendation/feedback/dashboard hoặc dữ liệu catalog nghiên cứu.

## 3. Nhân viên tiếp nhận và khôi phục lỗi

1. Vào **Yêu cầu tư vấn**, lọc **Chờ tiếp nhận**, tìm theo tên hoặc mã nếu cần.
2. Chọn **Tiếp nhận tư vấn**. Kiểm tra **Hồ sơ khách đã gửi**; đây là snapshot của request, không phải bản mới nhất của khách.
3. Nếu cần đổi nhu cầu, chọn **Chỉnh sửa thông tin**. Bản gốc vẫn được giữ.
4. Xác nhận khách đồng ý lưu thông tin, chọn **Xác nhận & tạo gợi ý**.
5. Xem tối đa ba kết quả thật, hoặc empty state thật. Chỉ hiển thị Completed sau xác nhận backend.

Nếu thấy **“Đã tạo kết quả tư vấn nhưng chưa cập nhật được trạng thái yêu cầu.”**, vẫn có thể xem kết quả/feedback. Chọn **Thử cập nhật trạng thái yêu cầu** khi kết nối hoạt động lại. Nút này chỉ gọi đọc trạng thái và hoàn tất, không tạo session.

Nếu đã đóng trình duyệt hoặc đăng nhập lại, vào **Yêu cầu tư vấn → Đang tư vấn → Tiếp tục tư vấn**. Server trả snapshot/session đã gắn; có session thì mở lại kết quả. Không cần lấy UUID/session từ trình duyệt cũ. Có thể mở session từ lịch sử; server tìm lại request theo session. Nếu đã Superseded, kết quả cũ vẫn được giữ và nhân viên được hướng dẫn tiếp nhận yêu cầu mới.

Tổng quan hiển thị số Pending và ba yêu cầu mới nhất từ API thật, cùng nút tiếp nhận, tư vấn khách mới và mở Leads. Queue có ngày, mã rút gọn, trạng thái, tên nhân viên, hồ sơ, tìm kiếm, phân trang và các action phù hợp người nhận. Bộ lọc lịch sử được áp dụng toàn bộ dữ liệu trước phân trang; đơn vị tổng là **phiên có phản hồi**, không phải số item.

Context lựa chọn chỉ lưu định danh cần thiết. Draft retry tạm lưu đầu vào cần để khôi phục khi lỗi, thuộc tài khoản hiện tại, xóa sau thành công/đổi tài khoản/logout. Cùng tài khoản reload phục hồi phiên; tài khoản khác phải chọn khách lại. Dữ liệu server và kiểm tra quyền luôn quyết định. Không đưa tên/email/phone hoặc định danh tư vấn vào query string.

## 4. Tài khoản và dữ liệu demo

| Vai trò            | Username                             | Cách dùng                                                                                    |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------- |
| Customer Demo      | `customer.demo@example.invalid`      | Chỉ hồ sơ/trạng thái của mình trên portal.                                                   |
| Sales User Demo    | `sales.user.demo@example.invalid`    | Tiếp nhận và tư vấn ba Lead demo được phân công; default follow-up assignee.                 |
| Sales Manager Demo | `sales.manager.demo@example.invalid` | Xem queue/báo cáo theo quyền CRM; có thể nhận request còn trống, không ghi đè người đã nhận. |
| Administrator      | `Administrator`                      | Tài khoản local hiện có; mật khẩu không đổi.                                                 |

Mật khẩu demo nằm trong **[credentials local](../.local/seminar-credentials.json)**, mở bằng editor riêng; không đưa lên slide hoặc commit. Seed chạy lại không reset mật khẩu, không tạo trùng Lead/profile/session/Task mẫu, không xóa dữ liệu nhóm. QA browser dùng tài khoản/Lead demo hoặc Lead có tên QA rõ ràng; các bản ghi đã tạo được giữ lại để kiểm chứng. Backend audit rollback toàn bộ test write.

| Hồ sơ giả lập   | Điều kiện                                                                                                 | Kết quả matching thật                                 |
| --------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Nguyễn Minh Anh | Combination; Oil Control, Acne, Aging; không đặc biệt nhạy cảm; Serum; 325.000; không tránh/ưu tiên brand | 3 eligible, 3 kết quả, điểm **82,46 / 80,35 / 74,04** |
| Trần Ngọc Hà    | Dry; Dehydration, Skin Barrier; Sensitive; Moisturizer; 400.000; tránh Fragrance                          | 0 kết quả đủ điều kiện                                |
| Lê Khánh Linh   | Oily; Acne, Oil Control; Sunscreen; 150.000                                                               | 0 kết quả đủ điều kiện                                |

Catalog giữ **68 Product Profile = 65 nghiên cứu + 3 bản sao demo**. **5 Active**: 2 nghiên cứu + 3 demo, đều đủ trường bắt buộc của engine. Tên bản demo có nhãn **Mẫu trình diễn**, code bắt đầu `BM-DEMO-`. Không bật Active sản phẩm nghiên cứu thiếu bằng chứng hoặc sửa thuật toán để ép có kết quả.

CSV có **69 dòng**; bốn code nghiên cứu chưa có trong DB: `HASAKI-SER-013`, `HASAKI-SUN-012`, `HASAKI-SUN-013`, `HASAKI-SUN-014`. Có khác biệt ảnh/status/claim giữa dữ liệu cũ và CSV; chưa đồng bộ toàn catalog. B/C có 0 kết quả được báo đúng, không thêm claim/thành phần bịa. Chi tiết trong [environment report](../test-results/request-consistency/environment.json).

Feedback: **Quan tâm** tạo CRM Task thật, default assignee Sales User Demo, hạn một ngày. Lặp lại không tạo Task thứ hai. **Không quan tâm** bắt buộc một lý do hợp lệ, hủy Task hiện có; quan tâm lại mở cùng Task. Thiếu assignee trả **PENDING**; lỗi tạo Task không trả **CREATED**. Không tự tạo Deal. Link Task chỉ hiện khi có quyền đọc.

Portal có hướng dẫn loại da/1–3 vấn đề, ngân sách hiển thị VND, lỗi ngay tại trường và focus trường đầu tiên. Lỗi mạng giữ đầu vào/UUID để retry; không chọn sẵn consent. Khung xác nhận và mã/ngày/bước tiếp theo lấy từ backend. Có thông báo: “BeautyMatch hỗ trợ lựa chọn sản phẩm chăm sóc da dựa trên nhu cầu đã cung cấp, không thay thế tư vấn hoặc chẩn đoán y tế.”

## 5. Build, migrate và chuẩn bị chạy

PowerShell tại thư mục repository, Docker Desktop đang chạy; không dựng lại database hoặc xóa volume.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prepare_seminar.ps1
```

Script hiện có start container → kiểm tra/apply bridge đã có → migrate → seed → chuẩn bị A Pending → build CRM/app → clear-cache → restart. Nếu chỉ triển khai bản sửa lần này:

```powershell
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost migrate
docker exec -w /home/frappe/frappe-bench/apps/crm/frontend crm-frappe-1 yarn build
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench build --app beautymatch
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-cache
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-website-cache
docker restart crm-frappe-1
```

Đợi site lên, mở URL và **Ctrl+F5**. Chuẩn bị buổi demo tiếp theo:

```powershell
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seed_demo.prepare_presentation
```

Lệnh đưa A về 325.000 và một request Pending phù hợp; chạy lại an toàn, giữ lịch sử. Nó sẽ đánh dấu request đang xử lý cũ của A là Superseded theo đúng quy tắc mới, nên chỉ chạy khi chủ đích chuẩn bị buổi demo.

CRM 1.86.0 chưa có plugin route/sidebar chính thức phù hợp. Giữ nguyên bridge đã có, không thêm file core cần patch: Vite config, router, navigation và AppSidebar. Hướng dẫn upgrade/rollback tại [CRM Native Integration](CRM_NATIVE_INTEGRATION.md). Backup/hash tại [backup local](../.local/crm-native-patch/), không phụ thuộc container tạm. Không tự động áp dụng patch lên baseline/version khác.

## 6. Kịch bản demo 7 phút

Dùng hai browser profile hoặc cửa sổ thường/ẩn danh cho khách và staff. Mở mật khẩu ngoài màn hình trình chiếu. Help của CRM có thể mở ở browser mới; đóng bằng nút X gốc.

| Thời gian | Thao tác                                                                                   | Giải thích                                                                                                                           |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0:00–0:45 | Customer Demo vào portal, kiểm tra A/325000, chọn đồng ý, **Gửi yêu cầu tư vấn**           | Hiển thị xác nhận thật, mã/ngày và chờ tiếp nhận.                                                                                    |
| 0:45–1:30 | Sales User → BeautyMatch → xem số Pending → **Tiếp nhận yêu cầu** → nhận A                 | Một nhân viên tiếp nhận; Lead thuộc đúng phạm vi quyền.                                                                              |
| 1:30–2:15 | Xem **Hồ sơ khách đã gửi**, có thể mở chỉnh sửa, chọn đồng ý mới, **Xác nhận & tạo gợi ý** | Dùng đúng snapshot, lưu phiên/version riêng nếu chỉnh sửa.                                                                           |
| 2:15–3:00 | Xem Top 3, điểm/giá/lý do/cảnh báo                                                         | Matching dựa dữ liệu thật; không quét da hoặc chẩn đoán y tế.                                                                        |
| 3:00–4:00 | Top 1 → **Quan tâm** → đợi **CREATED** → mở CRM Task                                       | Đúng Lead/session/item/nhân viên; thao tác lặp không tạo Task trùng.                                                                 |
| 4:00–5:00 | Khách đổi 324000 và gửi; staff nhận request mới, tạo kết quả                               | Một Current Profile; session cũ được giữ. Nếu đổi khi đang tư vấn, request cũ thành Superseded và không thể hoàn tất bằng hồ sơ mới. |
| 5:00–5:45 | **Khách hàng & lịch sử** → **Chỉ phiên có phản hồi** → mở phiên cũ                         | Lọc toàn bộ lịch sử trước phân trang; Task theo từng phản hồi.                                                                       |
| 5:45–6:30 | **Báo cáo** → cập nhật; mở Lê Khánh Linh từ Tổng quan nếu cần minh họa empty               | Bốn KPI/hai chart thật; tỷ lệ quan tâm tính theo phiên có ít nhất một Interested.                                                    |
| 6:30–7:00 | Sales Manager mở queue/dashboard ở browser riêng                                           | Cùng sản phẩm CRM; quyền backend và lịch sử được giữ.                                                                                |

Khi cần trình bày khôi phục lỗi, dùng ảnh regression hoặc thao tác network block có kiểm soát ở môi trường local. Không giả lập response thành công; bật lại mạng và dùng nút cập nhật trạng thái thay vì gửi tư vấn lần nữa.

## 7. Kiểm thử thực tế và bằng chứng

```powershell
python -m unittest discover -s tests -p 'test_*.py'
npm.cmd test
npm.cmd run check
npm.cmd run test:seminar
npm.cmd run test:crm:native:flow
npm.cmd run test:consistency
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.request_consistency_audit.verify
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seminar_audit.verify
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.scripts.seed_demo.verify_seed
docker exec -w /home/frappe/frappe-bench crm-frappe-1 env/bin/python /workspace/beautymatch/scripts/run_local_frappe_tests.py
```

| Nhóm                       | Kết quả                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Python offline             | **56 PASS**, gồm kiểm tra filter trước pagination và quyền trước SQL                                                                                                                                                                       |
| JavaScript unit            | **20 PASS**, gồm response đến ngược thứ tự, account switch/logout/reload và inline validation                                                                                                                                              |
| Syntax                     | **33 module PASS**                                                                                                                                                                                                                         |
| Seminar browser thật       | **7 nhóm PASS**, Customer/Sales User/Sales Manager, feedback/Task thật, Axe vùng đã quét, không lỗi JS                                                                                                                                     |
| Native CRM browser thật    | **13 nhóm PASS**, Administrator/Sales User, Lead tạo/cập nhật, module CRM, feedback, history, reload/mobile/dark, không lỗi JS                                                                                                             |
| Regression browser mới     | **8 nhóm PASS**, xem [report cuối](../test-results/request-consistency/report.json): API thật, claim đồng thời, A→B, browser mới, mất mạng completion, retry không generation, account switch, search/filter, portal 320/390, không lỗi JS |
| Request/backend regression | **8 nhóm PASS**, mọi test write rollback, số bản ghi không đổi                                                                                                                                                                             |
| Seminar/backend audit      | **10 nhóm PASS**, lifecycle Task, PENDING, lỗi tạo Task, quyền và cả bốn KPI/hai chart so với SQL độc lập; rollback                                                                                                                        |
| Bộ TASK4 có sẵn            | **9 PASS**; unit tests có fixture/patch riêng, không dùng thay bằng chứng E2E thật                                                                                                                                                         |
| Seed                       | PASS: counts, hash catalog nghiên cứu và credentials không đổi khi chạy lại                                                                                                                                                                |
| Triển khai                 | Migrate, build CRM/app, clear-cache và restart local đã thực hiện                                                                                                                                                                          |

Browser acceptance không intercept hoặc bịa response API. Lỗi completion được tạo bằng **Chrome `Network.setBlockedURLs`** chỉ chặn URL `complete_request`; session/đọc dữ liệu và lần retry vẫn gọi server thật. Out-of-order xác định bằng unit test deferred promises của controller đang dùng trong view; browser thêm kiểm tra đổi filter nhanh và offline thật. Backend test feedback tạo hơn 20 session mới hơn để chứng minh phản hồi ở trang cũ vẫn tìm được.

Test runner Frappe ban đầu bị tắt; runner local chỉ bật `allow_tests` tạm, bỏ fixture toàn cục và khôi phục cấu hình site **nguyên byte** trong `finally`. Không cài thêm dependency chỉ để xuất XML; dùng log runner chuẩn. Các lượt đầu đã tái hiện stale-read thật, sau đó sửa và chạy lại. Không xóa/skip assertion để báo đạt; test điều hướng được cập nhật đúng bốn tab và endpoint request mới.

Bằng chứng local:

Kiểm tra sẵn demo cuối lúc **19:49 ngày 06/11/2026**: cả ba tài khoản demo đăng nhập được; A có ngân sách **325.000**, một yêu cầu **Pending**, consent chưa chọn; Sales User có nút tiếp nhận, Manager mở báo cáo thật, mỗi sidebar có đúng một mục BeautyMatch. Khách tiếp tục bị chặn CRM. Xem [ready-check](../test-results/request-consistency/ready-check.json), [portal sẵn demo](../test-results/request-consistency/ready-customer.png), [sidebar và queue](../test-results/request-consistency/ready-staff.png), [Manager](../test-results/request-consistency/ready-manager.png).

- [Regression request](../test-results/request-consistency/report.json), [backend request](../test-results/request-consistency/request-backend.json), [backend seminar](../test-results/request-consistency/seminar-backend.json), [TASK4 log](../test-results/request-consistency/task4.log)
- [Seed](../test-results/request-consistency/seed-idempotency.json), [phiên bản/catalog](../test-results/request-consistency/environment.json)
- [Seminar](../test-results/seminar/report.json), [native CRM](../test-results/crm-native/report.json)
- [Kết quả vẫn hiển thị khi completion lỗi](../test-results/request-consistency/saved-result-completion-failed.png), [retry thành công](../test-results/request-consistency/completion-retried-no-new-session.png)
- [Request bị thay thế](../test-results/request-consistency/superseded-requests-correct-filter.png), [portal trạng thái thật](../test-results/request-consistency/portal-confirmation-real-status.png)
- [Portal 320](../test-results/request-consistency/portal-320-inline-validation.png), [portal 390](../test-results/request-consistency/portal-390-inline-validation.png), [CRM mobile](../test-results/request-consistency/native-overview-mobile.png), [dark](../test-results/request-consistency/native-overview-dark.png)

## 8. Danh sách file thay đổi

**Backend và metadata:** [portal.py](../beautymatch/api/portal.py), [frontend.py](../beautymatch/api/frontend.py), [profile.py](../beautymatch/api/profile.py), [schema request](../beautymatch/beautymatch/doctype/beautymatch_customer_request/beautymatch_customer_request.json), [validation snapshot](../beautymatch/beautymatch/doctype/beautymatch_customer_request/beautymatch_customer_request.py).

**Portal và adapter dùng chung:** [portal.html](../beautymatch/www/beautymatch/portal.html), [portal.mjs](../beautymatch/public/js/portal.mjs), [portal.css](../beautymatch/public/css/portal.css), [intake-domain.mjs](../beautymatch/public/js/intake-domain.mjs), [account-context.mjs mới](../beautymatch/public/js/account-context.mjs), [api.mjs](../beautymatch/public/js/api.mjs).

**CRM native:** [store.mjs](../frontend/crm/store.mjs), [portal-api.mjs](../frontend/crm/portal-api.mjs), [latest-request.mjs mới](../frontend/crm/latest-request.mjs), [integration.mjs](../frontend/crm/integration.mjs), [Workspace.vue](../frontend/crm/Workspace.vue), [native.css](../frontend/crm/native.css), [Overview.vue](../frontend/crm/views/Overview.vue), [Requests.vue](../frontend/crm/views/Requests.vue), [Consultation.vue](../frontend/crm/views/Consultation.vue), [Results.vue](../frontend/crm/views/Results.vue), [Customer.vue](../frontend/crm/views/Customer.vue), [crm_form_script.js](../beautymatch/public/js/crm_form_script.js), [crm-botanical.mjs](../beautymatch/public/js/crm-botanical.mjs).

**Kiểm thử và chạy:** [request_consistency_audit.py mới](../beautymatch/scripts/request_consistency_audit.py), [seminar_audit.py](../beautymatch/scripts/seminar_audit.py), [verify_request_consistency.mjs mới](../scripts/verify_request_consistency.mjs), [run_local_frappe_tests.py mới](../scripts/run_local_frappe_tests.py), [verify_seminar.mjs](../scripts/verify_seminar.mjs), [verify_crm_native.mjs](../scripts/verify_crm_native.mjs), [check_frontend.mjs](../scripts/check_frontend.mjs), [package.json](../package.json), [test_frontend_api.py](../tests/test_frontend_api.py), [request-consistency.test.mjs mới](../tests/frontend/request-consistency.test.mjs), [tài liệu này](DEMO_SEMINAR_READY.md).

Không thêm source core CRM cần patch trong lần sửa này. Không sửa API recommendation/feedback/dashboard hoặc matching engine. Không thay mật khẩu Administrator/demo, không xóa database/volume hoặc dữ liệu của nhóm.

## 9. Giới hạn còn lại

- Catalog chưa khớp hoàn toàn CSV; B/C hiện 0 kết quả. Ảnh catalog bên ngoài có thể không tải được; UI dùng fallback có nhãn, không thay bằng ảnh sản phẩm khác.
- Request In Progress từ phiên bản cũ chưa có receipt/session ràng buộc và profile đã thay đổi sẽ bị chặn an toàn; cần khách gửi yêu cầu mới. Không tự gắn lại session dựa vào cùng Lead.
- Chưa có UI chuyển người nhận; Manager không chiếm request đang được người khác xử lý. Dùng đúng tài khoản đã nhận để tiếp tục.
- Portal chỉ hiển thị 10 request gần nhất; toàn bộ request/session cũ vẫn trong database và lịch sử CRM. Không public signup hoặc gửi email thật.
- Context lựa chọn bị xóa khi đổi tài khoản; mở lại từ queue/lịch sử để phục hồi dữ liệu server. Đầu vào chưa gửi chỉ nằm trong form hiện tại; draft retry được giữ sau khi đã bấm gửi.
- Mobile đã kiểm thử trên Chrome/Playwright 320px và 390px; chưa kiểm tra bàn phím ảo trên thiết bị vật lý.
- Build host có cảnh báo Browserslist cũ và chunk upstream lớn. Không có lỗi compile. Không nâng dependency CRM ngoài phạm vi nhiệm vụ.
- Axe chỉ quét những vùng đã ghi trong report; không phải chứng nhận toàn CRM. Bridge native vẫn cần review khi nâng version CRM.
- [Credentials](../.local/), backup và [test-results](../test-results/) được Git ignore. Sao lưu ảnh/bằng chứng riêng khi chuyển máy; không commit mật khẩu hoặc token.
