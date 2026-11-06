# BeautyMatch — Tích hợp giao diện Frappe CRM

> **Cập nhật 06/11/2026:** theme trong tài liệu này tiếp tục được dùng, nhưng phần navigation/entrypoint đã chuyển sang Vue native trong `/crm/...`. Xem [CRM_NATIVE_INTEGRATION.md](CRM_NATIVE_INTEGRATION.md); không dùng hướng dẫn sidebar DOM hoặc menu website cũ để triển khai module hiện tại.

Ngày kiểm tra: 05/11/2026. Repository hiện có, nhánh `feat/recommendation-ui`. Không commit, push, merge hoặc đổi nhánh remote.

## Kết quả và phạm vi

Giao diện `/crm` thật được áp dụng hệ thống Botanical Cinema: xanh rừng, xanh botanical, sage, nền ivory, font Inter tiếng Việt, serif cho phần giới thiệu BeautyMatch, bề mặt bo góc, đường viền mảnh và focus rõ ràng. Dashboard, Leads, Lead Detail, Contacts, Deals, Tasks, dialog và menu vẫn dùng component, dữ liệu và nghiệp vụ gốc của CRM. Không đặt ảnh botanical phía sau bảng dữ liệu; không dựng dashboard CRM giả.

Trong Lead Detail, phần BeautyMatch hiển thị hồ sơ làn da, số phiên tư vấn, các phiên gần đây, sản phẩm đã quan tâm và CRM Task có quyền đọc. Các action **Tư vấn với BeautyMatch**, **Hồ sơ & lịch sử**, **Làm mới BeautyMatch** hoạt động trên Lead đang mở. Có liên kết mở lại kết quả của phiên đã lưu.

Các route BeautyMatch và luồng tư vấn, matching, phản hồi, follow-up, lịch sử, Lead Summary và dashboard trước đó tiếp tục được giữ nguyên. Không thay API backend hoặc matching engine trong tác vụ tích hợp giao diện CRM này.

## Kiến trúc đã kiểm tra

| Thành phần thực tế | Phiên bản / cơ chế |
| --- | --- |
| Frappe Framework | 15.121.3 |
| Frappe CRM | 1.86.0 |
| Frontend CRM | Vue 3, Vue Router, Pinia |
| frappe-ui | 1.0.0-beta.29 |
| Site / container local | `crm.localhost` / `crm-frappe-1` |

CRM dùng HTML shell độc lập `crm/www/crm.html`, mount Vue tại `#app`, nạp bundle riêng và nhận dữ liệu boot từ controller `crm/www/crm.py`. Vì shell này không sử dụng block chèn assets của Desk/website template chuẩn, chỉ khai báo `app_include_css` hoặc `web_include_css` không đủ để theme `/crm`.

BeautyMatch dùng hook chính thức **`page_renderer`** của Frappe v15. `BeautyMatchCRMPage` kế thừa `TemplatePage`, chỉ nhận endpoint chuẩn `crm` khi đúng app, đường dẫn template và thư mục CRM đang cài. Rule CRM gốc chuyển `/crm/<path>` về endpoint này.

Renderer đọc template CRM hiện tại, giữ nguyên nội dung, controller, kiểm tra quyền, boot, CSRF và các đường dẫn bundle hash đang được CRM build. Nó chỉ thêm class `bm-crm` trên `<html>`, một stylesheet và một module JavaScript BeautyMatch. Không sao chép shell CRM, hardcode tên bundle hoặc sửa source CRM. Nếu anchor HTML upstream thay đổi, renderer giữ nguyên HTML gốc và ghi cảnh báo; CRM vẫn mở được, theme tạm không áp dụng.

CSS nằm trong phạm vi `html.bm-crm`, gồm semantic tokens thật của frappe-ui như `--surface-base`, `--surface-sidebar`, `--ink-gray-9`, `--outline-gray-1`, radius và elevation. Dialog/menu portal ra `<body>` vẫn nhận tokens. Các trạng thái, số liệu và thao tác CRM tiếp tục do CRM quản lý. Theme có xử lý light/dark, focus và `prefers-reduced-motion`; không thay thư viện UI hay sửa stylesheet trong `node_modules`.

Riêng cột HTML chứa `.bm-crm-insights` được bỏ giới hạn chiều cao/mask 300px của Side Panel gốc, để toàn bộ hồ sơ và lịch sử dùng vùng cuộn ngoài của CRM. Các section CRM khác giữ nguyên giới hạn và cơ chế collapse. Logo BeautyMatch được hiển thị như nền trang trí trong đúng ô thương hiệu, cạnh tên thương hiệu có sẵn; tránh kích hoạt ảnh thiếu `alt` trong component logo gốc.

## Điểm mở rộng CRM được sử dụng

**Điều hướng metadata:** thêm một dòng Route `/beautymatch` trong `FCRM Settings.dropdown_items`. Entry nằm trong menu thương hiệu/tài khoản của CRM, dùng cơ chế `CRM Dropdown Item` và hoạt động trên mobile. Sidebar chính của CRM 1.86.0 khai báo route trong `frontend/src/utils/navigation.js`, chưa có extension hỗ trợ external item tương đương. Các menu gốc, trạng thái hidden và lựa chọn admin được giữ nguyên; installer không thêm trùng route đã có. Mục sidebar riêng được bổ sung ở đợt 06/11/2026 bằng adapter Custom App có kiểm tra quyền; xem [cơ chế và kiểm thử sidebar](CRM_SIDEBAR_INTEGRATION.md).

**Lead Detail:** tạo Custom Field HTML `CRM Lead.beautymatch_insights`, thuộc module BeautyMatch. Installer thêm section BeautyMatch vào `CRM Fields Layout` loại `Side Panel`, giữ nguyên toàn bộ section/field gốc và tôn trọng vị trí đã được admin tùy chỉnh. Nếu layout gốc không tồn tại hoặc schema không tương thích, installer báo `unsupported`, không tạo một layout trống làm mất field CRM.

`CRM Form Script` riêng **BeautyMatch Workspace** sử dụng `setFieldHtml()` và `actions` có sẵn trong phiên bản đang cài. HTML hiển thị qua `HtmlControl` có sanitization của CRM; nội dung từ API được escape trước khi render. Module click chỉ xử lý liên kết thuộc `.bm-crm-insights`; không quan sát, thay thế hoặc dựng lại DOM của bảng, router hay Vue component CRM.

Thanh công cụ giữ nút tư vấn chính; hai thao tác lịch sử/làm mới nằm trong dropdown **BeautyMatch** bằng cấu trúc `group`/`buttonLabel`/`items` của `CustomActions` gốc. Breadcrumb dài tự co để nút trạng thái và **Convert to Deal** vẫn hiển thị. Trên mobile, CRM đưa các action này vào menu thao tác gốc.

**Dữ liệu và quyền:** script gọi `beautymatch.api.frontend.get_customer_view`, tái sử dụng hồ sơ, Lead Summary và lịch sử đã có. Backend tiếp tục kiểm tra role, quyền đọc/ghi Lead; liên kết Task chỉ xuất hiện khi có quyền đọc Task. Điều hướng BeautyMatch truyền opaque identifiers qua `sessionStorage`, không đưa tên, email, số điện thoại hoặc tham số khách hàng vào URL BeautyMatch. `sessionStorage` không cấp quyền truy cập và không thay Frappe authentication/CSRF.

**Metadata và branding:** installer kiểm tra capabilities bằng DocType metadata, không đoán hỗ trợ theo version. Chỉ thêm metadata thuộc BeautyMatch. Tên/logo công ty đã tùy chỉnh được giữ nguyên; tên mặc định trống/CRM/Frappe CRM mới đổi thành BeautyMatch CRM. Không cập nhật assignee follow-up hoặc các cấu hình vận hành khác.

## File của tác vụ tích hợp CRM

| File | Vai trò |
| --- | --- |
| `beautymatch/website/__init__.py` | Package extension website |
| `beautymatch/website/crm_renderer.py` | Renderer nạp assets vào shell CRM gốc |
| `beautymatch/public/css/crm-botanical.css` | Design tokens và theme có scope cho CRM |
| `beautymatch/public/js/crm-botanical.mjs` | Handoff các link thuộc HTML field BeautyMatch |
| `beautymatch/public/js/crm-insights.mjs` | Render hồ sơ, lịch sử, quan tâm và Task từ dữ liệu thật |
| `beautymatch/public/js/crm_form_script.js` | Action và refresh HTML field trong CRM Lead |
| `beautymatch/config/crm_customization.py` | Installer metadata, menu, branding có kiểm tra compatibility |
| `beautymatch/config/integration.py` | Nối installer với CRM Form Script hiện có |
| `beautymatch/hooks.py` | Đăng ký `page_renderer`, giữ install/migrate integration |
| `scripts/verify_crm_visual.mjs` | Chụp trước/sau, kiểm tra native routes, search, integration và CRUD tùy chọn |
| `scripts/check_frontend.mjs`, `package.json` | Bổ sung kiểm tra cú pháp và lệnh `test:crm`, `test:crm:crud` |
| `scripts/verify_live_frontend.mjs` | Đồng bộ nhãn action CRM trong kiểm thử live hiện có |
| `tests/test_crm_renderer.py` | 5 test phạm vi renderer, boot/CSRF, idempotency, fail-open |
| `tests/test_crm_customization.py` | 8 test bảo toàn layout/menu/branding và capability guard |
| `tests/frontend/crm-insights.test.mjs` | Kiểm tra dữ liệu thật, HTML escaping và Task URL an toàn |
| `docs/CRM_VISUAL_INTEGRATION.md` | Báo cáo và hướng dẫn vận hành này |
| `README.md`, `docs/FRONTEND_HANDOFF.md` | Bổ sung liên kết tài liệu tích hợp CRM |

Font và logo dùng lại assets có sẵn của Botanical Cinema; giấy phép font nằm trong `beautymatch/public/fonts`. Các thay đổi frontend BeautyMatch khác đang có trong working tree thuộc các đợt triển khai trước. Những file CRM core đã có thay đổi từ trước như `auto-imports.d.ts` và `yarn.lock` (mốc file 06/10) được giữ nguyên, không dùng làm cách triển khai theme này.

## Cài đặt, build và mở local

Áp dụng cho môi trường Docker hiện tại, app BeautyMatch đã cài vào site. Không reset volume, không cài lại CRM và không import thay thế dữ liệu.

```powershell
cd 'C:\Users\Yen Nhi\frappe-crm'
docker compose up -d
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost execute beautymatch.config.integration.install'
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench build --app beautymatch'
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost clear-cache'
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench --site crm.localhost clear-website-cache'
docker restart crm-frappe-1
```

Installer được gọi lại khi install/migrate app và có tính idempotent. Xem JSON trả về để biết feature nào đã hỗ trợ/thay đổi. Không cần build lại CRM core chỉ để đổi các assets BeautyMatch. Khi chỉ đổi nội dung `crm_form_script.js`, chạy lại installer để đồng bộ record script; khi nâng cấp file JS/CSS nên tăng release query ở renderer và dynamic import tương ứng trong form script, rồi clear cache và tải lại trình duyệt.

| Trang | URL local |
| --- | --- |
| CRM | http://localhost:8000/crm |
| CRM Dashboard | http://localhost:8000/crm/dashboard |
| Leads | http://localhost:8000/crm/leads |
| Contacts | http://localhost:8000/crm/contacts |
| Deals | http://localhost:8000/crm/deals |
| Tasks | http://localhost:8000/crm/tasks |
| BeautyMatch | http://localhost:8000/beautymatch |

Mở một Lead có quyền, xem section BeautyMatch trong sidebar, dùng **Tư vấn với BeautyMatch** hoặc **Hồ sơ & lịch sử**. Trên mobile, phần chi tiết và menu có thể nằm trong drawer gốc của CRM. Giữ cùng tab khi tiếp tục tư vấn để sử dụng context đã lưu trong `sessionStorage`.

## Kiểm thử và ảnh trước/sau

```powershell
cd 'C:\Users\Yen Nhi\frappe-crm\beautymatch'
python -m unittest discover -s tests -p 'test_*.py'
npm.cmd test
npm.cmd run check
npm.cmd run test:e2e
node scripts/verify_crm_visual.mjs --phase after
```

`verify_crm_visual.mjs` mặc định chỉ đọc dữ liệu local. Script đăng nhập bằng tài khoản được cấp qua `BM_TEST_USER`/`BM_TEST_PASSWORD` hoặc cấu hình development hiện có; không ghi credentials vào báo cáo. Nó chỉ mở Lead synthetic đã có và che giá trị bảng khách hàng trong ảnh.

Để xác minh tạo/sửa Lead trên **site local**, chạy:

```powershell
node scripts/verify_crm_visual.mjs --phase after --exercise-crud
```

Cờ này cho phép tạo đúng một Lead synthetic mới, sau đó chỉ sửa Lead vừa tạo; không sửa hoặc xóa khách hàng hiện có. Một lượt bị dừng giữa chừng có thể để lại bản ghi test đã tạo. Script giới hạn host local. Không dùng nó như một công cụ chạy CRUD trên production.

| Kiểm tra của đợt CRM | Kết quả cuối |
| --- | --- |
| Python offline, bao gồm renderer và metadata | **PASS 46** |
| JavaScript unit, bao gồm CRM Insights | **PASS 15** |
| Browser regression BeautyMatch, desktop và mobile | **PASS 20** |
| Kiểm tra cú pháp / Prettier | **PASS**, 20 module có kiểm tra cú pháp |
| Frappe asset build | **PASS** |
| Installer chạy lại | **PASS**, `changed: false` cho toàn bộ metadata và script |
| Guest không đăng nhập mở `/crm` | **PASS**, cổng quyền CRM trả HTTP 403 |
| 6 native screens × desktop/mobile | **PASS**, 12 ảnh trước và 16 ảnh sau, gồm panel/menu/dark |
| CRM browser audit cuối | **PASS 24**, 18 phản hồi API thật, không lỗi JavaScript/request/route, không ghi dữ liệu |
| Lead HTML panel, actions, mở kết quả và native quick filter | **PASS**, đúng dữ liệu API, không tạo lại recommendation, context qua sessionStorage |
| Thanh công cụ Lead | **PASS**, trạng thái/Convert và nút BeautyMatch nằm trong viewport ở 1440px và 1024px |
| Menu BeautyMatch, mobile panel, dark và reduced motion | **PASS** |
| Native create/update Lead | Tạo **1 Lead synthetic**, chỉ sửa Job Title của Lead này; save/readback/reload đạt, lượt audit cuối đọc lại độc lập xác nhận dữ liệu còn lưu |
| Accessibility phần panel BeautyMatch | **PASS**, Axe không phát hiện vi phạm trong phạm vi panel |
| Native CRM accessibility | Còn các vấn đề baseline; không tuyên bố toàn bộ CRM đạt WCAG AA |

Lượt CRUD hoàn thành 23 kiểm tra chức năng, nhưng báo cáo tổng ban đầu vẫn `passed: false` vì phần đọc body phục vụ audit bị ngắt khi trình duyệt đổi dark mode và reload. Đây là lỗi đồng bộ của script kiểm thử; không có lỗi JavaScript hoặc request ứng dụng thất bại trong lượt đó. Báo cáo thô được giữ nguyên tại `test-results/crm-botanical/crud-report.json`, không sửa thành PASS. Script đã được sửa để đợi phản hồi trước reload, nhận diện body bị trình duyệt hủy và bắt buộc có phản hồi dữ liệu thành công trên từng route/device. Lượt cuối chỉ đọc đạt **24/24**, không bị ngắt body và xác minh độc lập dữ liệu Lead đã tạo/sửa; không tạo thêm Lead thử nghiệm.

So sánh 12 ảnh cùng route/device: số node bị Axe báo tương phản giảm từ **159 xuống 0**. CRM gốc vẫn có lỗi nhãn nút icon/checkbox, viewport hạn chế zoom và vùng cuộn chưa focus được; khi mở dropdown native còn có cảnh báo `aria-hidden-focus`. Không có rule accessibility mới trong 12 màn hình chung; panel BeautyMatch được kiểm tra riêng ở desktop và mobile.

Ảnh và báo cáo máy đọc được nằm trong:

- `test-results/crm-botanical/before/`: ảnh native CRM trước theme, `report.json`.
- `test-results/crm-botanical/after/`: ảnh CRM có theme, các ảnh panel/action/dialog và `report.json`.
- `test-results/crm-botanical/crud-report.json`: bằng chứng đợt CRUD ban đầu, gồm ghi nhận lỗi audit đã nêu. Ảnh `after/lead-create-desktop.png` của đợt này được giữ lại.

Các tên ảnh native dùng `{dashboard,leads,contacts,deals,tasks,lead}-{desktop,mobile}.png`. Báo cáo ghi route, viewport, kết quả kiểm tra, lỗi JavaScript/API nếu có và kết quả Axe để so sánh baseline. Các ảnh chụp là ứng dụng thật, không phải mockup hoặc dữ liệu hardcode.

## Nâng cấp và rollback

Sau khi nâng Frappe CRM/frappe-ui, kiểm tra lại native HTML anchors, hook `page_renderer`, semantic tokens, schema `FCRM Settings`, `CRM Fields Layout` và helper `setFieldHtml`. Chạy offline tests, installer hai lần để kiểm tra idempotency, rồi build/cache và browser audit. Nếu khả năng hỗ trợ thay đổi, giữ action điều hướng và báo feature chưa hỗ trợ; không âm thầm patch core hoặc thay dữ liệu backend.

Để tắt riêng theme, bỏ đăng ký `BeautyMatchCRMPage` trong hook `page_renderer`, clear cache/website cache và restart container. Shell và giao diện gốc của CRM được dùng lại; Lead, Contact, Deal, Task, hồ sơ và Recommendation Session vẫn giữ nguyên.

Nếu cần gỡ cả panel/menu, trước tiên ngừng gọi installer metadata trong integration hook, vô hiệu hóa **BeautyMatch Workspace** hoặc khôi phục script thuộc BeautyMatch trước đợt tích hợp, rồi chỉ bỏ section `beautymatch_insights` và route `/beautymatch` do installer này thêm. Giữ nguyên các section/menu của người dùng. HTML field có thể để lại mà không xóa dữ liệu nghiệp vụ. Chỉ khôi phục branding từ cấu hình đã ghi nhận trước đó; không giả định tên/logo cũ. Không dùng `git reset --hard`, xóa volume, migrate reset hoặc xóa business records để rollback giao diện.

## Giới hạn cần biết

- Entry metadata dùng menu thương hiệu/tài khoản. Từ 06/11/2026, mục dưới Dashboard được bổ sung bằng adapter Custom App có kiểm tra quyền, không sửa core; xem [báo cáo sidebar và giới hạn của cơ chế này](CRM_SIDEBAR_INTEGRATION.md). Phiên bản CRM hiện tại vẫn chưa có metadata hook chính thức cho external sidebar item.
- Figma MCP đã hết quota của gói hiện tại nên không cập nhật editable layers trong đợt này. Art direction lấy từ Botanical Cinema đang triển khai và ảnh tham chiếu của người dùng.
- Assignee follow-up chưa cấu hình nên Interested thường trả `PENDING`; integration chỉ hiển thị trạng thái API thật, không tự đổi người được phân công. Vòng đời CREATED/hủy/mở lại Task đã được kiểm tra transactional ở đợt backend/frontend trước.
- Dashboard CRM vẫn là dashboard CRM gốc. Dashboard BeautyMatch tiếp tục dùng các KPI/chart có trong backend; không thêm chỉ số chăm sóc da hoặc số liệu giả.
- API BeautyMatch hiện yêu cầu quyền ghi Lead bên cạnh quyền đọc. Người dùng chỉ có quyền đọc Lead vẫn sử dụng CRM gốc, nhưng panel BeautyMatch báo thiếu quyền; không nới quyền backend để hiển thị panel.
- Một số vấn đề accessibility đã có trong CRM trước theme: nhãn checkbox/nút icon, viewport hạn chế zoom và vùng cuộn. Theme đã xử lý tương phản trong các màn hình kiểm tra; chưa sửa DOM/component CRM gốc để giải quyết toàn bộ lỗi baseline.
- Đã kiểm tra bằng tài khoản local được cấp quyền; vẫn cần kiểm tra ownership, Sales User/Sales Manager và dữ liệu của tổ chức thực tế trước production.
