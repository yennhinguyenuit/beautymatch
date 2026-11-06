# Host bridge: BeautyMatch trong CRM Vue SPA

Đánh giá trước khi áp dụng, 06/11/2026:

- Host thực tế: Frappe CRM 1.86.0, Vue 3, Vue Router, Pinia, frappe-ui 1.0.0-beta.29; CRM Git HEAD tại thời điểm khảo sát: `deedce73c1eb48577e7f70e95df6bac1dc55c93f`.
- Không có plugin API chính thức để Custom App đăng ký external page vào cả router và sidebar. `page_renderer` chỉ nạp theme, không thể tự đăng ký route Vue.
- Chọn bridge **14 dòng thêm trong 4 file host**: alias/dedupe build; gọi đăng ký route; khai báo mục navigation; chuyển navigation sidebar sang computed để phản ánh quyền bất đồng bộ. Không đổi auth guard, module nghiệp vụ hoặc dashboard chung của CRM.
- Một route Vue tên `BeautyMatch`, path `/beautymatch/:section?` trong router base `/crm`. Dùng cùng Layout, Router và Pinia của CRM; không createApp, iframe, HTML shell mới hay chèn DOM menu.
- Toàn bộ Vue components, store, API adapter, validation và CSS nằm trong repository BeautyMatch tại `frontend/crm/`.
- Patch host nằm ở repository CRM **riêng** trong container `/home/frappe/frappe-bench/apps/crm`; không được commit/push theo repository BeautyMatch. Container hiện không bind mount source CRM ra Windows; recreate container có thể mất patch nếu không áp dụng lại trong quy trình build.

Patch reviewable: [crm-1.86.0-beautymatch.patch](crm-1.86.0-beautymatch.patch). Script từ chối version/anchor khác và lưu bản gốc/hashes trong `test-results/native-crm-patch/`; các thay đổi CRM có sẵn ngoài bốn file này được giữ nguyên.

```powershell
docker exec crm-frappe-1 python /workspace/beautymatch/scripts/crm_native_patch.py --check
docker exec crm-frappe-1 python /workspace/beautymatch/scripts/crm_native_patch.py --apply
docker exec -w /home/frappe/frappe-bench/apps/crm/frontend crm-frappe-1 yarn build
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench build --app beautymatch
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost execute beautymatch.config.integration.install
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-cache
docker exec -w /home/frappe/frappe-bench crm-frappe-1 bench --site crm.localhost clear-website-cache
```

Khi nâng CRM: review diff/version, chạy lại tests và cập nhật patch có chủ đích; không tự áp dụng vào một version khác. `--rollback` chỉ khôi phục khi hash cả bốn file vẫn đúng bản đã áp dụng, tránh ghi đè công việc phát sinh. Sau rollback phải build lại host CRM và khôi phục entrypoints phiên bản trước trong Custom App nếu muốn dùng website cũ.

Các trang `/beautymatch/...` được giữ nguyên; chỉ chuyển điểm điều hướng CRM sau khi host build và route mới hoạt động. Không tự commit, push hoặc merge hai repository.
