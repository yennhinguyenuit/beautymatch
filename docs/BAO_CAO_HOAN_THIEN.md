# BeautyMatch — bàn giao tích hợp CRM

> Bàn giao seminar mới nhất: [DEMO_SEMINAR_READY.md](DEMO_SEMINAR_READY.md). Đã có portal khách, queue native và Task CREATED với assignee demo; các giới hạn PENDING bên dưới thuộc trạng thái trước.

Ngày kiểm tra: 05/11/2026. Nhánh: `feat/recommendation-ui`. Thay đổi nằm trong working tree; không commit, push, merge hay tạo PR. Chạy trên repository hiện có, Frappe 15.121.3 / Frappe CRM 1.86, container `crm-frappe-1`, site `crm.localhost`.

## 1. Audit và checklist triển khai

| Hạng mục | Hiện trạng khi audit | Kết quả |
| --- | --- | --- |
| TASK2: Lead, Beauty Profile, Consultation Submission | Đã có validation, khóa liên hệ và idempotency | Giữ nguyên API; nối Lead được chọn vào form |
| TASK3: matching engine | Đã có lọc, tính điểm, giải thích và tối đa 3 kết quả | Giữ nguyên thuật toán |
| TASK4: session, feedback, task, dashboard, summary | Backend đã hoàn thành, khác hợp đồng frontend cũ | Sửa adapter và cách ánh xạ dữ liệu |
| Kết quả không tải được như ảnh báo lỗi | Client đọc tên định danh cũ | Dùng `session_id` / `item_id`, vẫn đọc cache định dạng cũ |
| Điều hướng và ngữ cảnh khách hàng | Các trang rời nhau | Thêm trang chọn khách hàng và trang hồ sơ/lịch sử; cùng navigation |
| Mở BeautyMatch từ CRM Lead | Script Desk đã có summary; CRM SPA cần tích hợp riêng | Giữ script cũ, bổ sung action Desk và CRM Form Script do BeautyMatch sở hữu |
| Catalog demo | 65 sản phẩm, chỉ 2 Active thuộc 2 danh mục khác nhau | Thêm 3 bản sao CSV có nhãn demo trên site local; không cập nhật sản phẩm cũ |
| Test TASK4 | Phụ thuộc mã profile và email assignee riêng của máy tác giả | Chỉ sửa fixture test, tạo dữ liệu trong giao dịch rollback |
| Docker | Parent repository bind mount tới `/workspace` | Xác nhận bench app trỏ tới `/workspace/beautymatch`; build/cache/restart thành công |

Đã kiểm tra source, Git history/branch, routes, DocTypes, API, schema snapshot/task, tests và tài liệu. Không tạo một ứng dụng React khác hoặc sao chép backend đã hoàn thành.

## 2. Tính năng đã hoàn thành

- Trang chọn khách hàng có tìm kiếm theo tên/mã, phân trang, mở CRM và bắt đầu tư vấn mới. Truy vấn danh sách dùng `frappe.get_list`, giữ bộ lọc quyền CRM.
- Từ CRM Lead có action **Tư vấn BeautyMatch** và **Hồ sơ & lịch sử BeautyMatch**. Form dùng đúng Lead được chọn, điền sẵn thông tin và giữ khóa liên hệ đã có. Lead chưa có email/điện thoại có thể bổ sung liên hệ và tái sử dụng chính Lead đó. Liên hệ xung đột bị từ chối.
- Giữ form TASK2 và validation hiện có: liên hệ, loại da, độ nhạy cảm, 1–3 vấn đề da, loại sản phẩm, ngân sách, thành phần tránh, thương hiệu và consent. Không tự tick consent cho kịch bản mẫu.
- Lưu Beauty Profile và Consultation Submission thật, chuyển sang kết quả trong cùng tab. Chặn gửi trùng khi đang xử lý. Khi lỗi mạng và reload, giữ nguyên payload cùng `request_id`; chỉnh dữ liệu sẽ tạo một yêu cầu mới.
- Kết quả dùng session lưu trong database, có hồ sơ da, tên khách hàng khi được phép, phiên/ngày tư vấn, tối đa 3 sản phẩm, ảnh hoặc fallback, giá, thứ hạng, điểm, tiến trình, lý do, cảnh báo và liên kết chi tiết.
- Có loading, lỗi API, thiếu phiên, `PROFILE_CHANGED`, không có kết quả. `results: []` là kết quả nghiệp vụ hợp lệ. Reload/mở lại lịch sử đọc session cũ, không tạo session mới.
- **Quan tâm** và **Không quan tâm** gọi API thật; chỉ xác nhận sau response thành công. Dialog từ chối dùng đúng 5 lý do backend cho phép và bắt buộc chọn.
- `CREATED` hiển thị Task đã được xác nhận; chỉ cung cấp liên kết mở Task khi người dùng có quyền đọc. `PENDING` thông báo chờ phân công/xử lý, không giả định đã tạo Task. Backend tiếp tục quản lý tính duy nhất, hủy Task khi từ chối và mở lại cùng Task khi đổi ý.
- Trang hồ sơ khách hàng kết hợp Lead Summary, hồ sơ da, tổng phiên, sản phẩm quan tâm và lịch sử phân trang. Lịch sử có ngày, loại sản phẩm, kết quả/điểm/phản hồi, follow-up và mở lại kết quả.
- Dashboard có đủ 4 KPI, 2 biểu đồ, bảng dữ liệu hỗ trợ accessibility, refresh và xuất CSV thật. Dữ liệu đến từ database, giữ đúng phạm vi quyền backend.
- Giao diện tiếng Việt, xanh `#176B5B`, nền trắng/sage, typography và thành phần hiện có, navigation nhất quán, responsive desktop/mobile, focus/keyboard/dialog, contrast và trạng thái tương tác.

Mã khách hàng/hồ sơ/phiên được truyền trong POST body và `sessionStorage`; các URL BeautyMatch không chứa PII hoặc định danh khách hàng. Liên kết trở lại CRM dùng route bản ghi gốc `/crm/leads/<id>`; liên kết CRM Task dùng route Desk được kiểm tra quyền. Backend vẫn xác thực mọi lần đọc, không coi sessionStorage là cơ chế cấp quyền.

## 3. API đã tích hợp

| API gốc | Tham số sử dụng | Vai trò |
| --- | --- | --- |
| `beautymatch.api.profile.save_beauty_profile` | `payload` | Tạo/tái sử dụng Lead, profile, submission |
| `beautymatch.api.recommendation.generate_recommendations` | `crm_lead, beauty_profile, request_id, profile_version` | Tạo/tái sử dụng session |
| `beautymatch.api.recommendation.get_recommendation_result` | `session_id` | Đọc snapshot đã lưu |
| `beautymatch.api.recommendation.get_customer_history` | `crm_lead, limit, start` | Lịch sử phân trang |
| `beautymatch.api.feedback.submit_feedback` | `session_id, item_id, customer_feedback, rejection_reason` | Phản hồi và lifecycle Task |
| `beautymatch.api.lead_summary.get_lead_summary` | `crm_lead` | Hồ sơ, tổng phiên, lịch sử quan tâm |
| `beautymatch.api.dashboard.get_dashboard_data` | Không có tham số | 4 KPI và 2 chart toàn thời gian |

`frontend.py` bổ sung `get_workspace`, `get_customer_context`, `save_consultation`, `get_customer_view`, metadata kết quả và POST read bridge allowlist. Wrapper chỉ nối ngữ cảnh/hiển thị; validation và persistence vẫn ủy quyền API TASK2/TASK4. Tên đầy đủ, contact và Task chỉ được trả sau kiểm tra quyền Lead/read/write thích hợp. Envelope `response.message` được xử lý ở adapter. CSRF vẫn được gửi trong request.

Khác biệt nghiệp vụ được xử lý công khai:

- Backend TASK4 **bắt buộc lý do từ chối**, khác yêu cầu ban đầu “optional”; UI tuân theo API thực tế.
- `get_dashboard_data()` là **toàn bộ thời gian**, không có tham số ngày. `get_dashboard(start_date, end_date)` là API legacy có định nghĩa metric khác; không trộn hai hợp đồng. Live UI không hiển thị bộ lọc ngày giả.
- `interest_rate` là tỷ lệ **phiên** có ít nhất một sản phẩm Interested, không phải tỷ lệ các lần click.
- `top_skin_concerns` dùng `{skin_concern, count}`; `top_interested_products` dùng `{product_name, count}`.
- Hỗ trợ định danh cũ chỉ ở biên adapter/cache; request thật luôn dùng hợp đồng TASK4 hiện tại.

## 4. File tạo hoặc sửa

Đường dẫn tính từ repository root; danh sách bao gồm phần sửa contract trước đó trong cùng working tree.

| Nhóm | File |
| --- | --- |
| Tích hợp backend | `beautymatch/api/frontend.py` (sửa) |
| Hook và script CRM | `beautymatch/hooks.py`, `beautymatch/public/js/crm_lead.js` (sửa); `beautymatch/config/integration.py`, `beautymatch/public/js/crm_form_script.js` (mới) |
| Frontend hiện có | `beautymatch/public/js/api.mjs`, `app.mjs`, `components.mjs`, `demo-api.mjs` (sửa) |
| Thành phần/flow mới | `beautymatch/public/js/navigation.mjs`, `workspace.mjs`, `beautymatch/public/css/workspace.css` (mới) |
| Layout và form | `beautymatch/templates/beautymatch_app.html`, `beautymatch/www/beautymatch/consultation.html` (sửa); `consultation.py` (mới) |
| Route mới | `beautymatch/www/beautymatch/index.html`, `index.py`, `customer.html`, `customer.py` |
| Audit/demo local | `beautymatch/scripts/frontend_audit.py`, `beautymatch/scripts/local_demo.py` (mới) |
| Kiểm thử | `tests/test_frontend_api.py`, `tests/frontend/api.test.mjs`, `tests/browser/beautymatch.spec.mjs`, `beautymatch/tests/test_task4_api.py` (sửa); `scripts/verify_live_frontend.mjs` (mới) |
| Tooling | `package.json`, `playwright.config.mjs`, `scripts/preview_frontend.mjs` (sửa) |
| Tài liệu | `README.md`, `docs/FRONTEND_HANDOFF.md` (sửa); tài liệu này (mới) |

Không sửa `matching_engine.py`, `profile.py`, `recommendation.py`, `feedback.py`, `dashboard.py`, `lead_summary.py` hay schema DocType. Form TASK2 chỉ đổi layout chung, CSRF fallback, selected Lead handoff và retry; không viết lại validation/backend của đồng đội. CRM installer chỉ quản lý record **BeautyMatch Workspace**, giữ các CRM scripts khác.

## 5. Kết quả kiểm thử thực tế

| Kiểm tra | Kết quả đã chạy |
| --- | --- |
| Python offline — matching/catalog/frontend projection | **PASS: 33** |
| Node — API adapter, privacy, dedupe, feedback, datetime | **PASS: 10** |
| Frappe TASK4 — session idempotency, PROFILE_CHANGED, feedback/Task | **PASS: 9** |
| Playwright — desktop và mobile | **PASS: 10** |
| Browser trên Frappe thật | **PASS: 14 kiểm tra toàn luồng** |
| API trên Frappe trong giao dịch rollback | **PASS: 10 kiểm tra**, số bản ghi trước/sau không đổi |
| JS syntax / Prettier | **PASS** |
| Bench build / clear-cache / service restart | **PASS** |

Browser thật xác nhận: tạo profile/submission/session; snapshot sản phẩm; cache cũ và reload không generate; Interested/PENDING; 4 KPI/2 chart thật; required rejection reason; phản hồi lưu sau reload; action native CRM → summary/history → form điền sẵn; mobile; lịch sử → mở session; lỗi intake → reload giữ payload/UUID; kết quả 0; accessibility/bố cục workspace/customer/form; kết quả **3/2/1/0 từ catalog thật cùng một Lead**; không có page errors hoặc định danh trong URL BeautyMatch.

Playwright kiểm tra thêm API failure, missing session, retry/deduplication, loading/empty/error, CSV, keyboard/dialog focus và accessibility. Kiểm tra rollback dùng Task thật để xác nhận CREATED, duy nhất một Task, hủy/mở lại, PENDING khi chưa có assignee, contact conflict, Lead không có contact và Guest bị từ chối. Không giả lập matching trong kiểm thử catalog thật.

Lần chạy TASK4 đầu tiên bị **FAIL vì thiếu fixture hardcode**; sau khi chỉ sửa fixture, chạy lại cả 9 test đã PASS. `allow_tests` được bật tạm để chạy rồi khôi phục `false`. Ruff chưa được chạy do không cài trong Python host; không coi kiểm tra đó là PASS. Browser chấp nhận dùng tài khoản Administrator local, chưa tạo ma trận trình duyệt riêng cho mọi vai trò/ownership; checks quyền backend vẫn giữ nguyên.

## 6. Lệnh chạy và URL

Site hiện tại đã được cập nhật và kiểm tra hoạt động. Đăng nhập bằng tài khoản CRM được cấp quyền trên **http://localhost:8000/login**.

| Trang | URL chính xác |
| --- | --- |
| Khách hàng / điểm vào | http://localhost:8000/beautymatch |
| Tư vấn | http://localhost:8000/beautymatch/consultation |
| Gợi ý | http://localhost:8000/beautymatch/result |
| Hồ sơ + lịch sử + Lead Summary | http://localhost:8000/beautymatch/customer |
| Dashboard | http://localhost:8000/beautymatch/dashboard |
| CRM Leads | http://localhost:8000/crm/leads |

Áp dụng lại code sau thay đổi, từ PowerShell:

```powershell
cd 'C:\Users\Yen Nhi\frappe-crm'
docker compose up -d
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost execute beautymatch.config.integration.install'
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench build --app beautymatch && bench --site crm.localhost clear-cache'
docker compose restart frappe
```

Không cần migration schema cho thay đổi này. Installer tích hợp cũng được nối vào `after_install` / `after_migrate` để cài đặt mới nhận action CRM. Không reset volume hoặc xóa bản ghi.

Chạy kiểm thử frontend/offline:

```powershell
cd 'C:\Users\Yen Nhi\frappe-crm\beautymatch'
npm.cmd ci
npm.cmd run check
npm.cmd test
python -m unittest discover -s tests -p 'test_*.py' -v
npm.cmd run test:e2e
npm.cmd run format:check
node scripts/verify_live_frontend.mjs
```

E2E dùng Google Chrome đã cài. `test:live` chỉ cho phép hostname local, dùng `BM_TEST_USER` / `BM_TEST_PASSWORD` từ environment hoặc mật khẩu development được cấu hình sẵn trong `../init.sh`; không in/lưu credentials/cookies. Mỗi lượt test live thành công tạo **1 khách hàng thử nghiệm và 6 phiên tư vấn**, có tên `BeautyMatch Integration Test ...`, giữ lại để kiểm tra. Không xóa dữ liệu khách hàng sẵn có. Ảnh kiểm thử nằm trong thư mục ignored `test-results/`.

Test API với rollback:

```powershell
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost execute beautymatch.scripts.frontend_audit.inspect_runtime'
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost execute beautymatch.scripts.frontend_audit.verify_transactional_feedback'
```

Test Frappe TASK4, tắt test flag kể cả khi có lỗi:

```powershell
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost set-config allow_tests true'
try {
  docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost run-tests --app beautymatch --module beautymatch.tests.test_task4_api'
} finally {
  docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost set-config allow_tests false'
}
```

Preview UI không cần Frappe: `npm.cmd run dev`, mở http://127.0.0.1:4173/beautymatch/result?demo=1 hoặc http://127.0.0.1:4173/beautymatch/dashboard?demo=1. Đây chỉ là preview hai trang với mock adapter riêng, không lưu CRM. Dùng site cổng **8000** cho toàn bộ hành trình.

## 7. Hướng dẫn demo A–I

1. Mở `/beautymatch`, chọn khách hàng có quyền hoặc chọn **Tư vấn khách hàng mới**. Cũng có thể mở `/crm/leads`, chọn Lead và dùng action BeautyMatch.
2. Demo A/B/C: trên trang đầu, chọn **3 sản phẩm**, **2 sản phẩm**, **1 sản phẩm** hoặc **Không có kết quả**. Form điền thông số da/ngân sách mẫu; tự nhập tên và email/số điện thoại thử nghiệm, xác nhận consent rồi gửi. Đây là input presets, kết quả vẫn do matching engine/API thật tạo và lưu. Dùng lại cùng email thử nghiệm để tái sử dụng Lead.
3. Demo D/F: nhấn **Quan tâm**. Hiện tại assignee mặc định chưa cấu hình nên API trả `PENDING`. Nếu muốn trình diễn `CREATED`, quản trị viên mở `/app/beautymatch-settings`, chọn `default_follow_up_assignee` là người dùng hợp lệ rồi lưu; gửi/retry Quan tâm. Chỉ khi API xác nhận CREATED mới mở Task liên kết, kiểm tra Lead/session/item trong record Task.
4. Demo E: nhấn **Không quan tâm**, chọn một lý do hợp lệ, gửi và đợi xác nhận. Nếu có Task trước đó, backend chuyển Canceled; đổi lại Quan tâm mở cùng Task, không tạo bản trùng.
5. Demo G/H: chọn **Hồ sơ & lịch sử**; xem profile, tổng phiên, sản phẩm quan tâm và các kết quả đã lưu. Mở phiên trước, reload và trở lại CRM Lead.
6. Demo I: mở `/beautymatch/dashboard`, chọn **Làm mới**, xem 4 KPI, 2 chart/bảng và tải CSV. Dữ liệu tổng hợp bao gồm các phiên test đã lưu trong site local.

Catalog local đã chuẩn bị: 68 sản phẩm, 5 Active. Ba bản sao mới có mã `BM-DEMO-HASAKI-SER-001`, `BM-DEMO-HASAKI-SER-008`, `BM-DEMO-HASAKI-SER-013`; tên có hậu tố **Mẫu trình diễn**, dữ liệu lấy từ CSV catalog có sẵn. Không bật Active/sửa giá/ảnh của 65 sản phẩm gốc. Với catalog hiện tại, các ngân sách SERUM mẫu 325000/264000/218000/1 tạo lần lượt 3/2/1/0 kết quả cho bộ thông số mẫu.

Chỉ khi cần chuẩn bị lại một site local mới có `developer_mode`:

```powershell
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost execute beautymatch.scripts.local_demo.prepare'
```

Script này idempotent, không tự chạy từ hook, từ chối site không phải `.localhost` hoặc không bật developer mode, không seed production. Endpoint presets chỉ tính đầu vào theo catalog hiện tại; không tạo response gợi ý giả.

## 8. Giới hạn và việc cần chuẩn bị trước trình bày

- Không có phần nghiệp vụ chính phải fallback mock: toàn bộ flow trên cổng 8000 dùng Frappe thật. Mock chỉ hoạt động khi chủ động bật `?demo=1` trên result/dashboard, có banner, không ghi database.
- Assignee follow-up vẫn để nguyên cấu hình ban đầu. Cần quản trị viên chọn người nhận nếu muốn trình diễn Task CREATED trực tiếp; PENDING là kết quả đúng khi chưa cấu hình. CREATED và lifecycle đã PASS trong test rollback.
- Một số ảnh catalog thiếu hoặc URL ngoài không tải được; UI hiển thị fallback rõ ràng. Không dùng ảnh của sản phẩm khác để thay snapshot. Kiểm tra mạng/ảnh trước buổi demo; các giá là dữ liệu catalog, không cam kết là giá bán hiện tại.
- Dashboard TASK4 chưa hỗ trợ lọc ngày; frontend thể hiện toàn thời gian và không tự thay định nghĩa KPI.
- Figma MCP đang hết quota của gói Starter. Chưa cập nhật editable layers trong file Figma hoặc xác minh toàn bộ frame mới; giữ visual language hiện có và cải thiện trực tiếp UI. Không báo là đã cập nhật Figma.
- Cần kiểm tra thêm với tài khoản nhân viên và ownership thực tế trước production. Không nới quyền để demo; Guest denial, selected Lead conflict và quyền đọc Task đã có kiểm thử.
- Dữ liệu khách hàng/phiên synthetic từ các lần kiểm thử được giữ trong site development để xem lại; không có Docker reset, xóa CRM records hoặc seed production.
