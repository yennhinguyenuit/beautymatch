// A labeled fallback is visible throughout remote loading, including cached failures.
export function enhanceProductPhotos(scope) {
  for (const frame of scope.querySelectorAll(
    ".catalog-photo:not([data-photo-bound])",
  )) {
    frame.dataset.photoBound = "true";
    const img = frame.querySelector("img");
    const label = frame.querySelector("[data-photo-label]");
    if (!img) continue;
    let timer;
    const ready = () => {
      clearTimeout(timer);
      if (!img.naturalWidth) return unavailable();
      frame.classList.add("is-ready");
      img.removeAttribute("aria-hidden");
    };
    const unavailable = () => {
      clearTimeout(timer);
      frame.classList.remove("is-ready");
      img.setAttribute("aria-hidden", "true");
      if (label) label.textContent = "Chưa tải được ảnh sản phẩm";
    };
    img.addEventListener("load", ready, { once: true });
    img.addEventListener("error", unavailable, { once: true });
    if (img.complete) {
      if (img.naturalWidth) ready();
      else unavailable();
    } else timer = setTimeout(unavailable, 7000);
  }
}
