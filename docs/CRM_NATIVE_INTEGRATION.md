# BeautyMatch native trong Frappe CRM

Bàn giao ngày 06/11/2026 trên nhánh `develop`. Đã triển khai trực tiếp vào Docker local, không commit, push, merge hoặc đổi nhánh.

## Kết quả

Mở **<http://localhost:8000/crm/beautymatch>**, hoặc chọn **BeautyMatch** ngay dưới Dashboard trên sidebar CRM. Đây là một route của CRM hiện tại: giữ nguyên document, sidebar, layout, xác thực và Pinia của host. Không iframe, shell HTML mới, SPA riêng hoặc chèn menu vào DOM.

| URL | Chức năng |
| --- | --- |
| `/crm/beautymatch` | Tìm kiếm, phân trang CRM Lead có quyền đọc; chọn Lead hoặc tư vấn khách mới |
| `/crm/beautymatch/consultation` | Nhập hồ sơ, validation, đồng ý lưu dữ liệu và lưu TASK 2 |
| `/crm/beautymatch/customer` | Hồ sơ da, lịch sử phân trang, sản phẩm quan tâm, trạng thái chăm sóc |
| `/crm/beautymatch/result` | Gợi ý thật, tối đa ba sản phẩm, matching, thành phần, cảnh báo và phản hồi |
| `/crm/beautymatch/feedback` | Phản hồi và công việc liên quan trong lịch sử của Lead đang chọn |
| `/crm/beautymatch/dashboard` | Bốn KPI và hai biểu đồ BeautyMatch từ API thật |

Các URL dùng cùng origin `http://localhost:8000`. Lead/phiên đang chọn được truyền bằng `sessionStorage`; không đưa tên, số điện thoại, email hoặc hồ sơ vào URL. Mở trang kết quả khi chưa có phiên sẽ hiện hướng dẫn chọn/tạo tư vấn, không tự tạo phiên. Dashboard chung của CRM vẫn giữ nguyên.

## Khảo sát host và lựa chọn kiến trúc

Host thực tế: **Frappe CRM 1.86.0**, **Frappe 15.121.3**, Vue 3, Vue Router 4, Pinia 2, frappe-ui `1.0.0-beta.29`, Vite 8.2. CRM Git HEAD khi khảo sát: `deedce73c1eb48577e7f70e95df6bac1dc55c93f`.

- `frontend/src/router.js` dùng `createWebHistory('/crm')`, có auth guard và các route CRM gốc.
- `frontend/src/utils/navigation.js` khai báo danh sách module tĩnh; chỉ hiện route đã đăng ký.
- `frontend/src/components/Layouts/AppSidebar.vue` dựng navigation; mobile tái sử dụng sidebar trong drawer. Dashboard gốc được host ẩn trên mobile, nên BeautyMatch là mục đầu tiên tại đây.
- `App.vue` dựng DesktopLayout/MobileLayout quanh RouterView; component BeautyMatch được render vào đúng vùng này.
- Form Script của CRM có `this.router`, `this.actions`, `this.call`, `this.setFieldHtml`; dùng các helper này cho action trên Lead.
- `hooks.py`, `page_renderer`, `app_include_js/css` không phải API đăng ký route Vue. Renderer hiện có chỉ tiếp tục nạp theme và runtime của panel Lead.

**Phiên bản này không có extension/plugin API chính thức để Custom App đăng ký đồng thời Vue route và sidebar.** Sau đánh giá tác động, chọn bridge nhỏ có kiểm soát trong host. Đây là bản tích hợp tùy chỉnh cần bảo trì, không gọi nó là plugin API của upstream.

Mọi component, nghiệp vụ frontend và style module nằm trong Custom App `frontend/crm/`. Host chỉ import module đăng ký route/navigation và cấu hình build. Một route tên `BeautyMatch`, path `/beautymatch/:section?` dưới base `/crm`, giúp sidebar giữ active trên các màn hình con. Vue/Router/Pinia/frappe-ui dùng cùng dependency của host, không tạo instance ứng dụng hoặc store container riêng.

### Đúng bốn file host phải sửa

Các file dưới đây thuộc **repository CRM riêng** tại `/home/frappe/frappe-bench/apps/crm`, không nằm trong Git BeautyMatch:

| File CRM | Thay đổi |
| --- | --- |
| `frontend/vite.config.js` | Alias `@beautymatch`, resolve realpath app, dedupe Pinia, cho Vite dev đọc thư mục app |
| `frontend/src/router.js` | Import và gọi `installBeautyMatchRoutes` sau auth guard hiện có |
| `frontend/src/utils/navigation.js` | Mục BeautyMatch sau Dashboard; lọc theo capability API |
| `frontend/src/components/Layouts/AppSidebar.vue` | Navigation thành computed để cập nhật khi kiểm tra quyền hoàn tất |

Patch có **14 dòng thêm**, không sửa màn hình nghiệp vụ/auth của CRM: [bản vá review được](../integration/crm-1.86.0-beautymatch.patch), [đánh giá và hướng dẫn host](../integration/README.md). Hai file `frontend/auto-imports.d.ts`, `frontend/yarn.lock` đã có thay đổi trước tác vụ; không reset chúng.

`scripts/crm_native_patch.py` kiểm tra version và anchor, kiểm tra toàn bộ trước khi ghi, sao lưu bản gốc kèm SHA-256 trong `test-results/native-crm-patch/`. Áp dụng lặp lại trả `installed: true, changed: false`. Rollback từ chối ghi đè nếu bốn file đã thay đổi tiếp sau khi cài.

## Chức năng và API

Luồng đã nối thật: CRM Lead → action **Tư vấn với BeautyMatch** → hồ sơ → Recommendation Session → phản hồi → lịch sử/chăm sóc → phân tích. Các liên kết trong panel Lead cũng mở module native. Các trang `/beautymatch/...` cũ còn nguyên để tương thích, không bị nhúng vào CRM.

| Nhu cầu | API tái sử dụng |
| --- | --- |
| Quyền hiện menu/route | `beautymatch.api.navigation.get_sidebar_entry` |
| Tìm/chọn CRM Lead | `beautymatch.api.frontend.get_workspace` |
| Thông tin Lead/hồ sơ hiện có | `beautymatch.api.frontend.get_customer_context` |
| Lưu tư vấn TASK 2 | `beautymatch.api.frontend.save_consultation` |
| Tạo gợi ý TASK 3 | `beautymatch.api.recommendation.generate_recommendations` |
| Kết quả và lịch sử | `get_recommendation_result`, `get_customer_history` qua bridge POST `beautymatch.api.frontend.read` hiện có |
| Ngữ cảnh kết quả | `get_result_context` qua cùng bridge POST |
| Hồ sơ/lịch sử tổng hợp | `beautymatch.api.frontend.get_customer_view` |
| Phản hồi TASK 4 | `beautymatch.api.feedback.submit_feedback` |
| Báo cáo TASK 4 | `beautymatch.api.dashboard.get_dashboard_data` |

Adapter `createLiveApi` tiếp tục dùng cookie/CSRF của Frappe, gộp request giống nhau đang chạy và xử lý lỗi thật. Không đổi contract, thuật toán, quyền DocType hoặc API backend được bảo vệ. `matching_engine.py`, `profile.py`, `recommendation.py`, `feedback.py`, `dashboard.py` không bị sửa trong tác vụ này.

Form dùng các trường backend hiện có, không bỏ trường bắt buộc. Trên Lead đã chọn, contact được bảo vệ; lưu truyền Lead ID hiện tại nên không tạo Lead mới. Một payload chuẩn hóa giữ nguyên `request_id` khi retry, kể cả sau reload. Kết quả lưu identifiers `crm_lead`, `beauty_profile`, `profile_version`, `request_id`; khi có session thì đọc lại session đã lưu thay vì tạo mới.

Phản hồi chỉ xác nhận sau API thành công. **Không quan tâm bắt buộc chọn lý do theo backend hiện tại.** Quan tâm hiển thị đúng `CREATED` hoặc `PENDING` và thông báo chăm sóc. Liên kết Task điều hướng đến route `Tasks` của CRM rồi mở `DoctypeModal` gốc; không dựng bảng công việc giả.

Dashboard hiển thị đúng `total_sessions`, `leads_with_profile`, `interest_rate`, `average_top1_score`, `top_skin_concerns`, `top_interested_products`. Có bảng dữ liệu truy cập được cho biểu đồ. API hiện trả báo cáo toàn thời gian; không đặt bộ lọc ngày hoặc nút export gây hiểu nhầm.

Menu được kiểm tra bằng role tư vấn hiện có và quyền đọc `CRM Lead`, cache tối đa 60 giây trong frontend. Guest không được gọi API capability. Không có quyền thì không hiện menu và trang native không tải dữ liệu khách hàng. Backend vẫn kiểm tra quyền trên từng request; ẩn menu không thay thế bảo mật.

## Danh sách file Custom App

File mới:

- `frontend/crm/integration.mjs`, `LeafIcon.vue`, `Workspace.vue`: bridge host, navigation và vùng nội dung CRM.
- `frontend/crm/store.mjs`, `domain.mjs`, `native.css`: Pinia, session/retry, validation, nhãn tiếng Việt và style có phạm vi; responsive, focus, dark mode, reduced motion.
- `frontend/crm/components/ProfileSummary.vue`, `StatePanel.vue`: hồ sơ, loading/empty/error dùng lại.
- `frontend/crm/views/Overview.vue`, `Consultation.vue`, `Results.vue`, `Customer.vue`, `Analytics.vue`: màn hình nghiệp vụ.
- `integration/crm-1.86.0-beautymatch.patch`, `integration/README.md`, `scripts/crm_native_patch.py`: triển khai bridge host.
- `scripts/verify_crm_native.mjs`, `scripts/verify_crm_task.mjs`, `tests/frontend/crm-native.test.mjs`, tài liệu này: kiểm thử/bàn giao native.

File sửa:

- `beautymatch/public/js/api.mjs`: adapter lưu tư vấn dùng API hiện có.
- `beautymatch/public/js/crm_form_script.js`: action dùng `this.router`, giữ ngữ cảnh Lead.
- `beautymatch/public/js/crm-insights.mjs`, `crm-botanical.mjs`: link panel Lead native và sự kiện điều hướng thuộc BeautyMatch; bỏ khởi tạo adapter DOM.
- `beautymatch/public/css/crm-botanical.css`: gỡ style riêng của menu DOM cũ, giữ theme CRM hiện có.
- `beautymatch/website/crm_renderer.py`: asset release `crm-native-20261106`.
- `beautymatch/api/navigation.py`: capability trả đường dẫn `/crm/beautymatch`.
- `beautymatch/config/crm_customization.py`: chỉ loại menu thương hiệu website cũ do chính installer sở hữu; giữ cấu hình quản trị viên đã sửa và các mục CRM gốc.
- `scripts/verify_crm_sidebar.mjs`: lệnh tương thích gọi bộ kiểm thử native.
- `package.json`, `scripts/check_frontend.mjs`, `tests/frontend/crm-insights.test.mjs`, `tests/test_crm_navigation.py`, `tests/test_crm_customization.py`, `tests/test_crm_renderer.py`: lệnh và kiểm thử liên quan.
- `README.md`, `docs/CRM_SIDEBAR_INTEGRATION.md`, `docs/CRM_VISUAL_INTEGRATION.md`: chuyển hướng tài liệu sang kiến trúc hiện tại.

Đã gỡ `beautymatch/public/js/crm-sidebar.mjs` của phương án cũ; không còn dựng menu bằng DOM. Capability API, `beautymatch/scripts/sidebar_audit.py` và một số file test/tài liệu đã có trong working tree từ tác vụ sidebar trước; không ghi nhận nhầm chúng là tất cả đều mới ở tác vụ native. `hooks.py`, `config/integration.py`, schema và DocType nghiệp vụ không cần đổi.

## Build và chạy

Chạy tại thư mục repository BeautyMatch bằng PowerShell. Docker/site hiện có phải đang chạy. Native module phải build bằng CRM host; `npm run dev` chỉ là preview website cũ, không dùng để xác nhận native integration.

```powershell
docker exec crm-frappe-1 python /workspace/beautymatch/scripts/crm_native_patch.py --check
docker exec crm-frappe-1 python /workspace/beautymatch/scripts/crm_native_patch.py --apply

docker exec -w /home/frappe/frappe-bench/apps/crm/frontend crm-frappe-1 yarn build
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench build --app beautymatch

docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.config.integration.install
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-cache
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-website-cache
docker restart crm-frappe-1
```

Đợi site lên, mở <http://localhost:8000/crm/beautymatch> và **Ctrl+F5**. Đã chạy build host/app, installer, clear cache và restart trong đợt triển khai local; lượt installer cuối trả `changed: false`. Không cần migrate riêng cho thay đổi native này vì không đổi schema. Nếu triển khai kèm phiên bản app có schema mới, chạy quy trình chuẩn trước bước build/cache:

```powershell
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost migrate
```

## Kiểm thử thực tế

```powershell
python -m unittest discover -s tests -p 'test_*.py'
npm.cmd test
npm.cmd run check
npm.cmd run test:e2e

# Chỉ đọc: CRM modules, native sidebar, mobile và dark mode
npm.cmd run test:crm:native

# Tạo rồi xóa đúng một Task QA để thử modal native; không đổi assignee mặc định
npm.cmd run test:crm:task

# Tạo dữ liệu QA có tên rõ ràng, thử đầy đủ Admin + Sales User
npm.cmd run test:crm:native:flow
```

| Nhóm | Kết quả |
| --- | --- |
| Python unit tests | **50 PASS** |
| JavaScript unit tests | **17 PASS** |
| Syntax check | **26 module PASS** |
| Build CRM và asset BeautyMatch | **PASS**, còn warning bundle/caniuse-lite của toolchain host |
| Browser native dùng API thật, Administrator + Sales User | **12 nhóm PASS**; 75 phản hồi API BeautyMatch HTTP 200; 0 lỗi JavaScript/API |
| Smoke trên bundle cuối sau chỉnh biểu đồ dark mode | **4 nhóm PASS**, không tạo Lead/phiên và không lỗi JavaScript |
| Kiểm tra tích hợp transaction trên backend thật | **10 PASS**, mọi thay đổi của nhóm này rollback; số bản ghi trước/sau không đổi |
| Mở/đóng Task bằng modal CRM, quay về BeautyMatch cùng document | **PASS**, dùng Task QA thật rồi xóa đúng fixture; 0 lỗi JavaScript |
| Axe trong vùng module native | 0 vi phạm ở kết quả Admin/Sales User và dashboard dark mode |
| Hồi quy website cũ, desktop/mobile | 19 PASS lượt đầu; 1 timeout ở bài mobile nhiều bước, chạy riêng lại **PASS 7,9 giây**, không sửa code để bỏ qua lỗi |

Kết quả browser chi tiết: [report.json](../test-results/crm-native/report.json). Lượt smoke cuối dùng thư mục riêng [crm-native-smoke](../test-results/crm-native-smoke/report.json), không ghi đè báo cáo full flow.

Bài Task riêng lưu [report và cleanup](../test-results/crm-native-task/report.json). Bài này tạo một CRM Task QA bằng API thật để thử bridge điều hướng, xác nhận modal tải đúng Title đã lưu, đóng bằng nút X của component gốc và quay lại BeautyMatch. Sau khi đóng trang kiểm thử, bài kiểm tra đọc lại Title để kiểm tra sở hữu rồi mới xóa đúng Task đó; không thay assignee mặc định hoặc sửa Task của khách hàng.

Browser đã xác nhận menu native đúng vị trí, không trùng; cùng document/sidebar khi đi qua tám module gốc; tìm/lọc Lead bằng API thật; action Lead mở form trong CRM; lưu hồ sơ và gợi ý trên đúng Lead; retry generation trả cùng session; phản hồi và lịch sử; bốn KPI/hai chart; reload cả sáu URL; mobile không tràn ngang và dark mode. Tài khoản Sales User kiểm thử đã được vô hiệu hóa sau chạy.

Full-flow thành công cuối tạo **hai Lead QA và hai phiên**. Các lượt sửa lỗi trước đó cũng để lại Lead có tên QA riêng để kiểm tra, không chỉnh khách hàng có sẵn. Không tự xóa dữ liệu nghiệp vụ. Các kiểm tra transaction riêng xác nhận thật `CREATED`, một Task khi lặp Quan tâm, hủy/mở lại cùng Task khi đổi phản hồi, `PENDING`, lý do bắt buộc, binding Lead và từ chối Guest.

## Ảnh chụp sau tích hợp

18 ảnh full-flow nằm trong thư mục ignored `test-results/crm-native/`; dữ liệu trong ảnh là Lead QA và catalog của site local.

- [Tổng quan cùng sidebar CRM](../test-results/crm-native/administrator-overview.png)
- [Form tư vấn native](../test-results/crm-native/administrator-consultation.png)
- [Kết quả thật](../test-results/crm-native/administrator-results.png)
- [Phản hồi Quan tâm](../test-results/crm-native/administrator-interested.png)
- [Hồ sơ và lịch sử](../test-results/crm-native/administrator-history.png)
- [Phản hồi khách hàng](../test-results/crm-native/administrator-feedback.png)
- [Báo cáo BeautyMatch](../test-results/crm-native/administrator-dashboard.png)
- [Kết quả bằng Sales User](../test-results/crm-native/sales-user-results.png)
- [Mobile sidebar](../test-results/crm-native/native-mobile-sidebar.png), [mobile kết quả](../test-results/crm-native/native-mobile-content.png), [mobile báo cáo](../test-results/crm-native/native-mobile-dashboard.png)
- [Dark mode sau tinh chỉnh màu biểu đồ](../test-results/crm-native-smoke/native-dark-dashboard.png)
- [Task modal gốc của CRM](../test-results/crm-native-task/native-task-modal.png)

## Giới hạn và nâng cấp

1. **Host bridge cần bảo trì riêng.** Source CRM nằm trong container, chưa được bind mount ra Windows. Recreate container có thể mất patch; đưa bước apply/build vào quy trình dựng container hoặc lưu thay đổi trong repository CRM do nhóm quản lý. Không tự commit/push cùng BeautyMatch. Khi nâng CRM, review version/anchors rồi cập nhật và kiểm thử patch; script từ chối version không khớp.
2. **Feedback UI hiện trả PENDING:** site local chưa có assignee mặc định. Nhánh CREATED/cancel/reopen đã được kiểm tra bằng backend thật trong transaction. Thao tác mở/đóng Task modal native được kiểm thử riêng bằng Task QA thật; chưa chạy liền một luồng browser tạo CREATED từ cấu hình assignee mặc định. Không tự sửa cấu hình chăm sóc để làm đẹp kết quả thử nghiệm.
3. **Catalog local có dữ liệu seed** mang nhãn “Mẫu trình diễn”, một số ảnh thiếu hoặc chưa phải ảnh catalog chuẩn. Native module vẫn đọc API thật, không mock/ghi đè kết quả; khi thiếu ảnh sẽ hiện fallback rõ ràng. Cần dữ liệu sản phẩm chính thức trước vận hành.
4. **Lỗi sẵn có của chart Dashboard CRM:** frappe-ui có timer gọi ResizeObserver sau khi unmount nếu rời Dashboard quá sớm. Bài regression đợi chart mount xong trước chuyển trang; không monkey-patch hoặc che lỗi. Lượt kiểm thử thành công không ghi nhận lỗi JS. Chưa sửa chart upstream vì ngoài phạm vi bridge.
5. Axe chỉ quét vùng BeautyMatch; không phải chứng nhận toàn bộ CRM. Format toàn repository còn warning từ các file có trước; chỉ chuẩn hóa file liên quan, không sửa hàng loạt code đồng đội.
6. Screenshot/report/backup nằm trong `test-results/` và không được Git theo dõi; cần lưu riêng nếu bàn giao sang máy khác. `--rollback` cần bản backup đúng môi trường. Sau rollback phải build lại host, clear cache và khôi phục entrypoint Custom App tương ứng; không dùng reset repository hoặc xóa Docker volume.

```powershell
# Chỉ dùng khi chủ đích rollback; từ chối nếu host đã được sửa tiếp
docker exec crm-frappe-1 python /workspace/beautymatch/scripts/crm_native_patch.py --rollback
```
