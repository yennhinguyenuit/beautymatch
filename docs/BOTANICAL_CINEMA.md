# BeautyMatch — Botanical Cinema

Giao diện mới được triển khai trực tiếp trong ứng dụng Frappe hiện có trên nhánh `feat/recommendation-ui`. Không tạo ứng dụng riêng, commit, push hoặc merge. Mở **http://localhost:8000/beautymatch** để xem bản chạy với CRM thật.

## Các màn hình đã thiết kế lại

| Trang | Cải tiến |
| --- | --- |
| `/beautymatch` | Hero botanical toàn cảnh, headline serif tiếng Việt, CTA bắt đầu tư vấn/khám phá, các liên kết tính năng thật và không gian chọn khách hàng CRM |
| `/beautymatch/consultation` | Giới thiệu editorial, ảnh lá macro, 4 bước điều hướng bằng cuộn/focus, tiến độ hoàn thành, form hai cột và trạng thái chọn rõ ràng |
| `/beautymatch/result` | Nền rừng, hồ sơ kính mờ, session khách hàng, Top 1 nổi bật, card bất đối xứng, ảnh/giá/điểm/lý do/cảnh báo thật và phản hồi hoạt động |
| `/beautymatch/customer` | Hồ sơ/Lead Summary, sản phẩm quan tâm, timeline lịch sử, mở lại session và liên kết Task theo quyền |
| `/beautymatch/dashboard` | Heading editorial, 4 KPI, vòng tiến trình cho tỷ lệ, donut mối quan tâm, thanh sản phẩm, tooltip focus/hover, bảng dữ liệu và CSV |

Navigation, typography, button, dialog, loading, empty/error state và footer dùng cùng một hệ thị giác. Mọi nội dung nghiệp vụ vẫn là tiếng Việt; không thêm quét da, nhận diện khuôn mặt hoặc chỉ số y tế giả.

## Hệ thống thiết kế và tài nguyên

- Forest `#163F35`, botanical `#176B5B`, olive `#788568`, sage `#B8CBAA`, lime `#D9EFB9`, ivory `#F7F6F0`, cream `#FDFBF7`, charcoal `#202722`.
- Cormorant Garamond cho tiêu đề, có normal/italic và glyph tiếng Việt; Inter cho nội dung, điều khiển và số liệu. Font tự host, có giấy phép OFL.
- `public/images/botanical/hero.webp`: ảnh rừng/đá/rêu nguyên bản, 1672×941, khoảng 159 KB. `leaf-detail.webp`: macro lá/sương nguyên bản, 1086×1448, khoảng 88 KB. Không chứa sản phẩm giả, chữ hoặc logo.
- Nguồn font, prompt tạo ảnh và giấy phép được ghi trong [BOTANICAL_ASSETS.md](BOTANICAL_ASSETS.md).
- Ảnh sản phẩm vẫn gắn với catalog/snapshot thật. Ba ảnh có sẵn trong CSV được cache nguyên byte tại `public/images/catalog/`; manifest lưu URL nguồn, SHA256 và vùng crop chỉ dùng để hiển thị đúng sản phẩm. Không thay tên, giá, thứ hạng, điểm hoặc bản ghi catalog. URL nguồn snapshot được giữ tại `data-source-url`; URL không có trong mapping vẫn dùng nguồn ban đầu.
- Fallback có nhãn xuất hiện ngay khi ảnh tải, tiếp tục hiện khi CDN lỗi hoặc chờ quá lâu. Không dùng ảnh sản phẩm khác để thay ảnh thiếu. Ảnh đã tải thành công mới thay fallback; tỷ lệ ảnh/crop được giữ đúng.

Motion dùng CSS, IntersectionObserver và requestAnimationFrame: reveal khi cuộn, parallax nhẹ trên desktop, hover và tiến trình. Không thêm GSAP/Three.js/WebGL. `prefers-reduced-motion` tắt chuyển động; nội dung vẫn dùng được khi không có animation.

## Tính đúng đắn nghiệp vụ

Giữ luồng CRM Lead → Consultation → Beauty Profile/Submission → Recommendation Session → Feedback → Follow-up → History/Lead Summary → Dashboard. Các API, DocTypes, authentication, quyền CRM, CSRF, request_id/profile_version, sessionStorage và idempotency được giữ nguyên.

Form mới giữ toàn bộ field/name/ID, consent và logic submit/validation TASK2. Nút bước chỉ cuộn/focus, không gửi dữ liệu hoặc tự tick consent. Tiến độ phản ánh mục đã điền, không phải thông báo lưu thành công.

Dashboard dùng đúng `get_dashboard_data()` và dữ liệu được backend giới hạn quyền. `interest_rate` tính theo phiên có ít nhất một Interested; `leads_with_profile` là khách CRM có hồ sơ. Donut tính tỷ trọng trên **tổng lượt ghi nhận mối quan tâm**, không giả định mỗi phiên chỉ có một vấn đề da. Không có tăng trưởng giả hoặc bộ lọc ngày ở chế độ live vì API này không hỗ trợ ngày. CSV vẫn hoạt động.

`CREATED`/`PENDING`, lý do từ chối bắt buộc, lưu phản hồi, tính duy nhất/hủy/mở lại Task do backend quyết định. UI chỉ xác nhận sau API thành công. Mock vẫn tách ở adapter và chỉ bật bằng `?demo=1` trên result/dashboard, có banner rõ ràng.

## File thuộc phần redesign

| Nhóm | File |
| --- | --- |
| Design system | `beautymatch/public/css/botanical.css` (mới), template `beautymatch/templates/beautymatch_app.html` (sửa) |
| Navigation/trang đầu/lịch sử | `public/js/navigation.mjs`, `workspace.mjs` (sửa), `home-view.mjs` (mới) |
| Kết quả/ảnh/phản hồi | `public/js/app.mjs`, `components.mjs` (sửa), `product-photos.mjs`, `catalog-images.mjs` (mới) |
| Form | `www/beautymatch/consultation.html` (sửa), `public/css/consultation.css`, `public/js/consultation.mjs` (mới) |
| Dashboard | `public/css/dashboard.css`, `public/js/dashboard-view.mjs` (mới) |
| Motion | `public/js/motion.mjs` (mới) |
| Assets | `public/images/botanical/*`, `public/images/catalog/*`, `public/fonts/cormorant-*`, `public/fonts/CormorantGaramond-OFL.txt` |
| Kiểm thử | `tests/browser/cinema.spec.mjs`, `photos.spec.mjs`, `tests/frontend/catalog.test.mjs`, `dashboard.test.mjs` (mới) |
| Tooling | `scripts/capture_botanical.mjs`, `check_frontend.mjs` (mới), `scripts/preview_frontend.mjs`, `verify_live_frontend.mjs`, `package.json` (sửa) |
| Tài liệu | Tài liệu này, `docs/BOTANICAL_ASSETS.md`, liên kết từ README/handoff |

Các đường dẫn `public/` và `www/` trong bảng nằm dưới `beautymatch/`. Cache version của module graph/style được cập nhật đồng bộ để tab mới không đọc lẫn bản UI cũ.

Các thay đổi tích hợp CRM từ đợt trước vẫn được giữ trong working tree; xem [báo cáo tích hợp](BAO_CAO_HOAN_THIEN.md). Đợt redesign không sửa matching engine, profile/recommendation/feedback/dashboard/lead_summary API hoặc DocType backend.

## Kiểm thử và ảnh thực tế

Kết quả đã chạy trên bản redesign:

| Bộ kiểm tra | Kết quả |
| --- | --- |
| Python offline | **PASS 33** |
| JavaScript/asset integrity/dashboard | **PASS 13** |
| Frappe TASK4 | **PASS 9**; `allow_tests` đã khôi phục false |
| Playwright desktop/mobile | **PASS 20**: 18 kiểm tra toàn bộ flow/UI + 2 kiểm tra ảnh lỗi |
| Toàn luồng browser trên Frappe thật | **PASS 14**; gợi ý thật 3/2/1/0, không trùng Lead |
| Vòng đời Task/quyền/selected Lead trong transaction | **PASS 10**, rollback sạch và số record trước/sau không đổi |
| Kiểm tra hình ảnh trên site thật | **PASS 15 bố cục**; 0 lỗi Axe WCAG AA, overflow, page error hoặc rò định danh URL |
| JS syntax và format | **PASS**, 17 module đã kiểm tra cú pháp, Prettier và `git diff --check` |
| Frappe assets | **PASS** bench build và clear-cache |

Các lỗi trung gian đã sửa và kiểm tra lại: tên truy cập stepper chưa khớp nhãn, fade làm giảm tương phản trong khung hình đầu, ảnh CDN tải lâu để trống vùng ảnh, crop làm méo tỷ lệ. Không còn FAIL ở các lượt xác minh cuối. Ảnh kết quả thật tải đủ 2 packshot có URL, 1 sản phẩm có URL trống hiện fallback; không còn ảnh treo tải hoặc ảnh lỗi trong bộ chụp cuối.

Các kiểm tra bao gồm: validation/consent, bước và keyboard focus, prefill readonly contact, retry/reload/UUID, 0/1/2/3 kết quả, Interested/Not Interested, PENDING, vòng đời Task, lịch sử/mở lại session, KPI/chart/CSV, ảnh CDN lỗi, accessibility, reduced motion và không overflow.

`scripts/capture_botanical.mjs` chỉ đọc các bản ghi synthetic đã tồn tại. Script chụp 5 trang × 3 kích thước (desktop 1440, tablet 768, mobile 390), chạy Axe WCAG AA và ghi `test-results/botanical/report.json`. Không tạo hoặc sửa business records. Ảnh nằm ở:

- `test-results/botanical/overview-{desktop,tablet,mobile}.png`
- `test-results/botanical/consultation-{desktop,tablet,mobile}.png`
- `test-results/botanical/result-{desktop,tablet,mobile}.png`
- `test-results/botanical/customer-{desktop,tablet,mobile}.png`
- `test-results/botanical/dashboard-{desktop,tablet,mobile}.png`

## Chạy và kiểm tra local

Site đã có Frappe/CRM/BeautyMatch, dùng Docker Compose hiện tại:

```powershell
cd 'C:\Users\Yen Nhi\frappe-crm'
docker compose up -d
docker exec crm-frappe-1 bash -lc 'cd /home/frappe/frappe-bench && bench build --app beautymatch && bench --site crm.localhost clear-cache'
```

Không cần migration schema cho redesign. Không reset Docker volume hay xóa CRM records.

```powershell
cd 'C:\Users\Yen Nhi\frappe-crm\beautymatch'
npm.cmd run check
npm.cmd test
python -m unittest discover -s tests -p 'test_*.py'
npm.cmd run test:e2e
npm.cmd run format:check
node scripts/verify_live_frontend.mjs
node scripts/capture_botanical.mjs
```

Test live dùng credential local từ environment hoặc cấu hình development hiện có, không in/lưu credentials. Mỗi lần thành công tạo một khách thử nghiệm và sáu phiên có nhãn synthetic để kiểm tra; lượt bị dừng giữa chừng có thể để lại phiên synthetic đã lưu, không tự xóa dữ liệu. Script capture chọn một khách synthetic có sẵn phiên 3 sản phẩm, chỉ đọc và không tăng dữ liệu test. Browser test dùng Google Chrome đã cài.

Preview không cần backend: `npm.cmd run dev`, mở `http://127.0.0.1:4173/beautymatch/result?demo=1` hoặc dashboard tương ứng. Preview có thể render các route khác để kiểm tra UI, nhưng không cung cấp CRM APIs; dùng cổng **8000** để demo nghiệp vụ hoàn chỉnh.

URL live:

- http://localhost:8000/beautymatch
- http://localhost:8000/beautymatch/consultation
- http://localhost:8000/beautymatch/result
- http://localhost:8000/beautymatch/customer
- http://localhost:8000/beautymatch/dashboard

## Giới hạn còn lại

- Sản phẩm có `image_url` trống vẫn dùng fallback; không bịa packshot. Bản cache chỉ áp dụng đúng URL đã kiểm chứng, không thay ảnh của snapshot cũ bằng sản phẩm khác.
- Assignee follow-up hiện chưa được cấu hình nên luồng thường trả `PENDING`. Cấu hình người nhận trong BeautyMatch Settings nếu cần trình diễn CREATED; không tự đổi cấu hình vận hành của người dùng.
- Dashboard live chưa có date filter vì TASK4 API không hỗ trợ. Mock mode được ghi nhãn riêng, không thay thế lỗi API thật.
- Đã kiểm tra với tài khoản local Administrator và các kiểm thử quyền hiện có; cần kiểm tra ownership/role nhân viên thực tế trước production.
- Ảnh tham chiếu được dùng làm art direction, không sao chép logo, dữ liệu, người dùng hoặc chỉ số giả từ ảnh. Không cập nhật file Figma trong đợt này.
