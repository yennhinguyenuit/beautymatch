# BeautyMatch trong sidebar CRM

> **Tài liệu lịch sử.** Phương án DOM adapter và điều hướng ra `/beautymatch` dưới đây đã được thay bằng module Vue native. Xem [CRM_NATIVE_INTEGRATION.md](CRM_NATIVE_INTEGRATION.md) cho mã nguồn, URL, build và kết quả kiểm thử hiện tại. `crm-sidebar.mjs` đã được gỡ; không triển khai lại adapter này.

Bàn giao ngày 06/11/2026, trên nhánh `develop`. Không commit, push hoặc merge.

## Kết quả

CRM thật tại <http://localhost:8000/crm> có mục **BeautyMatch** ngay sau Dashboard, biểu tượng lá, mở cùng tab đến **`/beautymatch`**. Dashboard, Leads, Deals, Contacts, Organizations, Notes, Tasks và Call Logs được giữ nguyên. Không mở kết quả khi chưa có phiên tư vấn; các route tư vấn, lịch sử và dashboard trong BeautyMatch tiếp tục dùng navigation sẵn có.

Sidebar giữ nền xanh rừng hiện tại. CSS mới chỉ áp dụng vào hàng BeautyMatch, gồm hover, focus bàn phím, trạng thái nhấn, rail thu gọn, dark mode và reduced motion. Khi đã mở BeautyMatch, trình duyệt rời SPA CRM; khi quay lại CRM, mục CRM hiện tại tiếp tục được đánh dấu active, không giữ active giả trên BeautyMatch.

## Kiến trúc và cơ chế tích hợp

Đã đọc source CRM **1.86.0**, Vue 3 và frappe-ui đang cài:

- `frontend/src/utils/navigation.js`: `navigationItems` là danh sách route tĩnh; `getNavigationItems()` chỉ giữ các route đã đăng ký trong Vue Router.
- `frontend/src/components/Layouts/AppSidebar.vue`: chuyển danh sách này thành `SidebarItem` trong main `nav`; Public/Pinned Views cũng chỉ trỏ đến các module CRM hiện có.
- `frontend/src/components/Mobile/MobileSidebar.vue`: dựng lại AppSidebar trong drawer portal. Core chủ động bỏ Dashboard trên mobile bằng `desktopOnly`.
- `frontend/src/components/UserDropdown.vue` và `FCRM Settings`: `dropdown_items` hỗ trợ menu thương hiệu, không hỗ trợ chèn external route dưới Dashboard.
- frappe-ui `Sidebar.vue` / `SidebarItem.vue`: có các mốc `data-slot="sidebar"`, `data-state` và hàng menu có anchor thật.

**Không có sidebar extension metadata chính thức phù hợp trong phiên bản này.** Không tạo CRM View giả hoặc route giả để lách giới hạn này; không sửa CRM core, Vite bundle, Vue Router, Pinia hoặc truy cập các thuộc tính Vue nội bộ.

Giải pháp ít xâm lấn được dùng là **adapter DOM có phạm vi và điều kiện nhận diện, nằm trong Custom App**:

1. Hook `page_renderer` và `crm_renderer.py` hiện có tiếp tục nạp asset BeautyMatch vào shell CRM thật. Không dựa vào `app_include_js/css` của Desk.
2. `crm-botanical.mjs` khởi tạo `crm-sidebar.mjs` một lần. Module gọi API quyền mới, không lấy danh sách khách hàng để quyết định hiện menu.
3. Chỉ khi được phép, adapter tìm main `nav` qua `data-slot` và route gốc, tạo **anchor thật** `href="/beautymatch"` sau Dashboard. Không sao chép hoặc đổi event listener, node, thứ tự hay trạng thái của hàng CRM gốc.
4. MutationObserver nhận diện mount/remount sidebar, kể cả drawer mobile được portal ra body; cập nhật được gộp qua requestAnimationFrame. Không sửa bảng, chart, dialog hoặc nội dung khách hàng.
5. Singleton, kiểm tra vị trí và deduplication giữ đúng một mục trên mỗi sidebar. Nếu sau này có link native `/beautymatch`, adapter ưu tiên link native. Nếu không nhận diện được cấu trúc upstream, nó bỏ hàng của chính mình và để CRM nguyên trạng.
6. Anchor dùng điều hướng trình duyệt bình thường: cùng tab, hỗ trợ Enter, copy link, Ctrl/Cmd-click và browser Back. Không can thiệp vào navigation/history của Vue.

Đây là lớp tương thích được kiểm thử với phiên bản hiện cài, **không phải hook sidebar chính thức của CRM**. Một custom build/fork sửa `navigation.js`, router và AppSidebar sẽ cần bảo trì nhiều hơn; tác vụ này không chọn cách đó và không patch core.

## Phân quyền

API mới **`beautymatch.api.navigation.get_sidebar_entry`**, chỉ GET cho người đã đăng nhập:

- Dùng lại `_check_consultation_role()` hiện có: Administrator hoặc System Manager / Sales Manager / Sales User.
- Yêu cầu thêm `frappe.has_permission("CRM Lead", "read")`.
- Chỉ trả `{label, href, icon}` công khai; không trả tên khách hàng, mã Lead, hồ sơ hoặc dữ liệu CRM.
- Không có quyền thì không trả entry; Guest bị Frappe chặn HTTP 403. Lỗi/timeout API khiến adapter không gắn link, không bật demo hoặc tự đoán quyền theo client.
- Kiểm tra lại khi trở về từ bfcache và khi focus sau ít nhất 60 giây. Role thay đổi cần tải lại trang hoặc lần kiểm tra lại tiếp theo để phản ánh trên menu; API nghiệp vụ vẫn kiểm tra quyền ở mỗi request.

Không thay đổi quyền, API tư vấn, matching, feedback, tạo CRM Task hoặc các DocType nghiệp vụ. Ẩn menu không cấp hoặc thay thế quyền backend.

## File thay đổi

| File | Thay đổi |
| --- | --- |
| `beautymatch/api/navigation.py` | API khả năng truy cập menu, dùng lại kiểm tra quyền hiện có |
| `beautymatch/public/js/crm-sidebar.mjs` | Adapter sidebar, lifecycle, deduplication và link thật |
| `beautymatch/public/js/crm-botanical.mjs` | Khởi tạo adapter, giữ nguyên handler Lead hiện có |
| `beautymatch/public/css/crm-botanical.css` | Style riêng cho hàng BeautyMatch |
| `beautymatch/website/crm_renderer.py` | Đổi asset release sang `crm-sidebar-20261106` để tránh cache cũ |
| `tests/test_crm_navigation.py` | 4 kiểm thử role/quyền đọc và phản hồi không chứa dữ liệu khách hàng |
| `tests/test_crm_renderer.py` | Kiểm tra release theo hằng số renderer hiện tại |
| `beautymatch/scripts/sidebar_audit.py` | Chuẩn bị và vô hiệu hóa tài khoản Sales User kiểm thử local; không whitelist |
| `scripts/verify_crm_sidebar.mjs` | Browser acceptance test bằng tài khoản thật, API thật và screenshot |
| `scripts/check_frontend.mjs`, `package.json` | Thêm syntax check và lệnh `test:crm:sidebar` |
| `README.md`, `docs/CRM_VISUAL_INTEGRATION.md` | Liên kết và cập nhật tài liệu điều hướng |
| `docs/CRM_SIDEBAR_INTEGRATION.md` | Báo cáo này |

Đã kiểm tra nhưng không cần sửa `beautymatch/hooks.py`, `config/crm_customization.py` và `config/integration.py`: hook renderer và menu thương hiệu hiện có được giữ nguyên. Không có thay đổi schema hoặc migration mới. Hai file core CRM `frontend/auto-imports.d.ts`, `frontend/yarn.lock` đã có thay đổi từ trước; tác vụ này không sửa chúng.

## Build, migrate, clear cache và reload

Các lệnh cho Docker local hiện tại:

```powershell
cd 'C:\Users\Yen Nhi\frappe-crm\beautymatch'

# Khi cập nhật cả app/schema trong một đợt triển khai, dùng quy trình migrate chuẩn:
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost migrate

docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench build --app beautymatch
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-cache
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-website-cache
docker restart crm-frappe-1
```

Riêng thay đổi sidebar không cần migrate: không thêm/sửa DocType, Custom Field hoặc metadata. Đã thực hiện build, clear-cache, clear-website-cache và restart local. Không build lại CRM core. Mở <http://localhost:8000/crm> và nhấn **Ctrl+F5** để nạp module/stylesheet mới.

## Kiểm thử thực tế

```powershell
python -m unittest discover -s tests -p 'test_*.py'
npm.cmd test
npm.cmd run check
npm.cmd run test:crm:sidebar
# Bộ hồi quy CRM có sẵn, mặc định chỉ đọc:
npm.cmd run test:crm
```

`test:crm:sidebar` giới hạn hostname local, dùng tài khoản admin từ environment `BM_TEST_USER`/`BM_TEST_PASSWORD` hoặc cấu hình development có sẵn. Không in hoặc lưu mật khẩu/cookie. Script tạo một tài khoản **Sales User thực** chỉ dành cho kiểm thử local, tắt email welcome và vô hiệu hóa tài khoản trong `finally`. Các tài khoản QA được giữ ở trạng thái disabled để không xóa các quan hệ/audit của Frappe. Không tạo hoặc sửa Lead, sản phẩm, hồ sơ, phiên gợi ý hoặc CRM Task. Mỗi lần chạy tạo một tài khoản QA mới.

| Kiểm tra | Kết quả |
| --- | --- |
| Python, gồm 4 kiểm thử navigation mới | **PASS 50** |
| JavaScript unit hiện có | **PASS 15** |
| Cú pháp frontend/verification | **PASS 22 module** |
| Prettier cho các JS/CSS/script thay đổi | **PASS** |
| `npm run format:check` toàn repo | **FAIL** ở các file định dạng có sẵn không thuộc tác vụ; không format lại hàng loạt file của nhóm |
| Build assets Frappe | **PASS** |
| Browser sidebar acceptance | **PASS 11 kiểm tra**, 6 ảnh, không lỗi JavaScript trong lượt cuối |
| Administrator và Sales User | **PASS** đăng nhập thật, API quyền thật, workspace API thật, mở BeautyMatch và quay lại CRM |
| 8 lần chuyển module SPA + hard reload + khởi tạo lặp | **PASS**, luôn đúng một mục dưới Dashboard, giữ các mục CRM gốc |
| Mobile, rail collapsed, dark mode, reduced motion | **PASS** |
| Axe trong phạm vi link mới | **PASS**, không có vi phạm được phát hiện |
| Guest gọi API menu và workspace thật | **PASS**, HTTP 403 |
| Bộ hồi quy CRM hiện có | **PASS 24**, 18 phản hồi API thật, 16 ảnh desktop/mobile; không lỗi JavaScript/request/route, không tạo/sửa bản ghi nghiệp vụ |

Lượt mobile đầu tiên dừng do script chọn nhầm nút trong content header; đã sửa selector theo source `MobileAppHeader.vue`, không đổi core hoặc UI mobile. Một lượt chuyển Dashboard quá nhanh gặp lỗi ResizeObserver trong chart native; source frappe-ui `Charts/ECharts.vue` có timer observe sau 500ms không hủy khi unmount. Script đã đợi component render xong trước chuyển tiếp; lượt acceptance cuối không ghi nhận lỗi. Không monkey-patch ResizeObserver hoặc chặn lỗi JavaScript.

Bằng chứng:

- [Báo cáo sidebar JSON](../test-results/crm-sidebar/report.json).
- [Báo cáo hồi quy CRM JSON](../test-results/crm-botanical/after/report.json), gồm bộ lọc native, danh sách, Lead panel và navigation hiện có.
- [Administrator desktop](../test-results/crm-sidebar/administrator-desktop.png).
- [Sidebar thu gọn](../test-results/crm-sidebar/administrator-collapsed.png).
- [Dark mode](../test-results/crm-sidebar/administrator-dark.png).
- [Mobile](../test-results/crm-sidebar/administrator-mobile.png).
- [Mobile sau khi quay lại CRM](../test-results/crm-sidebar/administrator-mobile-return.png).
- [Sales User](../test-results/crm-sidebar/sales-user-desktop.png).

Ảnh chỉ chụp sidebar để không đưa dữ liệu khách hàng vào báo cáo. File ảnh và JSON nằm trong `test-results/` đã được gitignore; chạy script để tái tạo trên máy khác.

## Giới hạn và bảo trì

- Adapter phụ thuộc cấu trúc `data-slot`, main `nav` và route Dashboard/Leads/Deals của phiên bản hiện tại. Sau khi nâng CRM/frappe-ui, cần chạy lại acceptance test; nếu upstream thay cấu trúc, adapter không chèn link vào vị trí đoán mò. Menu thương hiệu cũ vẫn là điểm vào BeautyMatch.
- Dashboard vốn không hiện trong drawer mobile của CRM. Trên mobile, BeautyMatch đứng đầu main navigation, trước Leads; không thêm hoặc thay đổi Dashboard gốc.
- Chưa phải component SidebarItem native hoặc metadata hook chính thức. Khi upstream có extension external route, nên thay adapter bằng cơ chế đó và bỏ observer.
- Bảng/dữ liệu, tìm kiếm/lọc, ownership và API nghiệp vụ vẫn do CRM/Frappe xử lý. Những lỗi accessibility hoặc chart đã có của core không được giải quyết bằng tác vụ thêm sidebar này.

Để rollback riêng mục sidebar, bỏ import/lời gọi `startBeautyMatchSidebar()` trong `crm-botanical.mjs`, tăng asset release, build/clear-cache/reload. Không cần xóa dữ liệu hoặc sửa CRM core; theme, Lead integration và menu thương hiệu hiện có vẫn được giữ lại.
