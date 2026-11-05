import { icon } from "./components.mjs?v=botanical-20261105-v2";

export function overviewMarkup() {
  return `<section class="cinema-home" data-parallax aria-labelledby="home-heading">
    <div class="hero-copy" data-reveal><span class="eyebrow">BEAUTYMATCH / CHĂM SÓC CÁ NHÂN HÓA</span>
      <h1 id="home-heading">Hiểu làn da.<br><em>Chạm đến vẻ đẹp riêng.</em></h1>
      <p>BeautyMatch kết nối dữ liệu làn da với những gợi ý chăm sóc cá nhân hóa, giúp mỗi cuộc tư vấn trở nên thấu hiểu hơn.</p>
      <div class="hero-actions"><button class="button primary" data-work="new">Bắt đầu tư vấn ${icon("arrow")}</button><a class="button secondary" href="#discover">Khám phá BeautyMatch</a></div>
      <div class="hero-footnote">MỖI LÀN DA LÀ MỘT CÂU CHUYỆN RIÊNG</div>
    </div><span class="hero-collection" aria-hidden="true">THIÊN NHIÊN TRUYỀN CẢM HỨNG · DỮ LIỆU DẪN LỐI</span>
    <div class="feature-paths" aria-label="Hành trình BeautyMatch">
      <button class="feature-path" data-work="new">${icon("leaf")}<strong>Tư vấn cá nhân hóa</strong><span>Lắng nghe làn da,<br>thấu hiểu nhu cầu của bạn.</span></button>
      <a class="feature-path" href="/beautymatch/customer">${icon("users")}<strong>Hồ sơ làn da</strong><span>Lưu giữ thông tin,<br>theo dõi từng thay đổi.</span></a>
      <a class="feature-path" href="/beautymatch/result">${icon("spark")}<strong>Gợi ý có cơ sở</strong><span>Tìm sự phù hợp<br>từ dữ liệu sản phẩm.</span></a>
      <a class="feature-path" href="/beautymatch/customer">${icon("heart")}<strong>Chăm sóc xuyên suốt</strong><span>Ghi nhận phản hồi,<br>tiếp nối sự quan tâm.</span></a>
    </div>
  </section>
  <section id="discover" class="discovery-heading" data-reveal aria-labelledby="discover-heading"><div><span class="eyebrow">THẤU HIỂU TRƯỚC KHI LỰA CHỌN</span><h2 id="discover-heading">Một hành trình chăm sóc.<br>Một sự kết nối dài lâu.</h2></div><p>Từ hồ sơ làn da đến lần chăm sóc tiếp theo, mỗi thông tin đều giúp cuộc tư vấn trở nên gần gũi và phù hợp hơn.</p></section>
  <section id="customers" aria-labelledby="customers-heading"><div class="section-heading customer-picker-heading"><div><span class="eyebrow">KHÔNG GIAN DÀNH CHO NHÂN VIÊN CRM</span><h2 id="customers-heading">Tiếp nối câu chuyện của khách hàng</h2></div><button class="button secondary" data-work="new">Tư vấn khách hàng mới ${icon("arrow")}</button></div>
  <form id="customer-search" class="report-controls"><label class="field" for="lead-search">Tìm khách hàng<input id="lead-search" placeholder="Tên hoặc mã CRM Lead" maxlength="140" autocomplete="off"></label><button class="button primary" type="submit">Tìm kiếm</button><a class="button secondary" href="/crm/leads">Danh sách trong CRM ${icon("external")}</a></form><div id="lead-list"></div></section>`;
}
