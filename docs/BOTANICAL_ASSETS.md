# BeautyMatch — Botanical Cinema assets

## Cache ảnh catalog thật

Ba PNG trong `beautymatch/public/images/catalog/` được tải nguyên byte từ đúng `image_url` của catalog CSV có sẵn: `HASAKI-SER-001`, `HASAKI-SER-008`, `HASAKI-TON-009`. Ngày **08/11/2026**, bổ sung PNG thứ tư `HASAKI-SER-013`: ảnh đúng serum Garnier 30ml lấy từ `og:image` của [trang sản phẩm đã có trong catalog](https://hasaki.vn/san-pham/tinh-chat-garnier-giam-mun-mo-tham-cho-da-dau-mun-30ml-102911.html). CSV gốc thiếu ảnh sản phẩm này nên không sửa CSV; script local chỉ bổ sung trường ảnh trống của bản sao có nhãn `BM-DEMO-HASAKI-SER-013`.

Đây là ảnh catalog có nguồn, không phải ảnh sản phẩm sinh bằng AI. `manifest.json` lưu URL nguồn, trang xác minh nếu bổ sung mới, đường dẫn local, SHA256 và tọa độ crop hiển thị. Ảnh nguồn không bị sửa; CSS chỉ trình bày vùng packshot để không đưa giá/quảng cáo trong banner vào UI. `catalog-images.mjs` ánh xạ chính xác URL nguồn sang ảnh local, dùng chung trong Portal và component `frontend/crm/components/CatalogPhoto.vue`. Không thay đổi sản phẩm nghiên cứu hoặc snapshot cũ. Giá hiển thị tiếp tục từ API. Ảnh không có nguồn hợp lệ tiếp tục dùng fallback có nhãn.

Ngày chuẩn bị: 2026-11-05. Các asset này được lưu trực tiếp trong repository; giao diện không cần gọi dịch vụ tạo ảnh hoặc Google Fonts lúc chạy.

## Ảnh botanical nguyên bản

| File | Kích thước | Dung lượng | Mục đích |
| --- | --- | --- | --- |
| `beautymatch/public/images/botanical/hero.webp` | 1672 × 941 | 159,060 bytes | Hero điện ảnh, nền trang kết quả, negative space tối bên trái |
| `beautymatch/public/images/botanical/leaf-detail.webp` | 1086 × 1448 | 88,198 bytes | Ảnh macro dọc cho tư vấn và panel botanical |

Hai ảnh được tạo mới bằng công cụ built-in `image_gen.imagegen`; không dùng CLI, không sao chép từ ảnh tham khảo, không có logo, watermark, bao bì hay sản phẩm catalog giả. Ảnh chỉ là trang trí, không đại diện cho sản phẩm thật hoặc khả năng chẩn đoán da. Ảnh sản phẩm thật vẫn phải lấy từ API/catalog.

PNG gốc được giữ tại thư mục generated_images của Codex. WebP được chuyển định dạng giữ nguyên kích thước bằng Chrome Canvas (hero quality 0.88, leaf quality 0.86). Không sửa cảnh hoặc ghép ảnh trong bước tối ưu này.

### Prompt hero (nguyên văn)

```text
Use case: photorealistic-natural.
Asset type: original wide decorative photographic website hero background for BeautyMatch Botanical Cinema, not a rendered website or mockup.
Primary request: An exquisitely composed cinematic botanical landscape that evokes a luxury natural skincare campaign. Lush olive and sage leaves, living moss on gently rounded dark natural stone in the lower right foreground, dew on leaves, a few delicate ivory botanical blossoms at right. Deep verdant garden/forest depth and realistic atmospheric haze. Natural shafts of warm morning sun entering from upper right, soft volumetric light, layered bokeh and sophisticated editorial color grading.
Composition: panoramic wide 16:9 landscape, entirely original photographic scene. Keep left 55 percent dark, quiet, softly textured forest and usable negative space for large ivory website typography; interesting detailed leaves and stone concentrated in right 40 percent and lower edge. Center has soft botanical depth, not busy contrast. Organic framing, elegant asymmetry, authentic macro texture, premium professional photography.
Palette: deep forest #163F35, muted olive #788568, sage #B8CBAA, subtle warm ivory highlights; natural muted greens, no neon, no strong teal.
Constraints: No products, bottles, jars, packages or cosmetic containers. No people, hands, faces, logos, letters, text, branding, UI, borders or watermarks. No invented product. No duplicated kaleidoscope leaves. The background must remain decorative only and never resemble a real catalog product. Rich photographic realism, cinematic light, restrained high-end visual atmosphere.
```

### Prompt leaf detail (nguyên văn)

```text
Use case: photorealistic-natural.
Asset type: original decorative portrait botanical photograph for a luxury skincare consultation sidebar.
Primary request: Macro editorial photograph of a beautifully curved healthy sage-olive leaf with luminous, realistically sized clear dew droplets. One elegant leaf descends diagonally through the composition, shallow depth of field, rich natural texture of veins, rounded smooth droplets reflecting the garden. Defocused olive garden foliage with muted fresh sage and warm ivory bokeh behind it.
Composition: portrait 3:4 photography, close macro with elegant negative space and organic curves, one clearly dominant leaf without chaotic overlapping branches, layered soft natural depths, no artificial studio shapes.
Lighting and mood: soft atmospheric morning light, gentle bright background at upper right, softly shaded deep forest at bottom, sophisticated botanical cinema art direction. Forest green #163F35 and warm sage #B8CBAA, natural olive #788568, restrained cream highlights, no neon.
Constraints: Background decoration only, no people, no products, no bottles/jars, no text, UI, watermark, graphic frame or branding. Photographic realism; avoid fantasy crystalline leaves, no insects, no excessive droplet repetition. Original visual asset, not a replica of any product advertising.
```

## Font tự host

Cormorant Garamond được dùng làm serif display, normal/italic variable weight 400–600, có các subset Latin và Vietnamese. Inter hiện có được giữ cho nội dung, điều khiển và dữ liệu.

| File | Bytes |
| --- | --- |
| `beautymatch/public/fonts/cormorant-garamond-normal-vietnamese.woff2` | 11,220 |
| `beautymatch/public/fonts/cormorant-garamond-normal-latin.woff2` | 37,640 |
| `beautymatch/public/fonts/cormorant-garamond-italic-vietnamese.woff2` | 11,516 |
| `beautymatch/public/fonts/cormorant-garamond-italic-latin.woff2` | 39,260 |

Nguồn chính thức: [Google Fonts Cormorant Garamond](https://github.com/google/fonts/tree/main/ofl/cormorantgaramond), [Google Fonts stylesheet](https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400..600;1,400..600&display=swap).

Giấy phép SIL Open Font License 1.1 được lưu tại `beautymatch/public/fonts/CormorantGaramond-OFL.txt`; bản nguồn: [OFL.txt](https://raw.githubusercontent.com/google/fonts/main/ofl/cormorantgaramond/OFL.txt). Font được tải từ fonts.gstatic.com theo stylesheet chính thức trên, không chỉnh sửa font.

Bốn file đã được kiểm tra chữ ký WOFF2. Khi khai báo `@font-face`, dùng `font-weight: 400 600`, `font-display: swap` và tách unicode-range Latin/Vietnamese tương ứng để chữ có dấu dùng cùng một thiết kế.

Vietnamese unicode range:

```css
U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169,
U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304,
U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB
```

Latin unicode range:

```css
U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6,
U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F,
U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD
```
