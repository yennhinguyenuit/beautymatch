// Exact-source copies; provenance, SHA256 and display-only crop in images/catalog/manifest.json.
const catalogImages = new Map([
  [
    "https://media.hcdn.vn/catalog/product/o/g/og-image-auto-tinh-chat-garnier-giam-mun-mo-tham-cho-da-dau-mun-30ml_EzLdsJGRdMFKeRef.png",
    {
      url: "/assets/beautymatch/images/catalog/HASAKI-SER-013.png",
      crop: { x: 260, y: 218, width: 100, height: 307 },
    },
  ],
  [
    "https://media.hcdn.vn/catalog/product/o/g/og-image-auto-serum-caryophy-giam-mun-mo-tham-se-lo-chan-long-30ml_mTyYxtDiDoZZpPDY.png",
    {
      url: "/assets/beautymatch/images/catalog/HASAKI-SER-001.png",
      crop: {
        x: 196,
        y: 65,
        width: 235,
        height: 545,
      },
    },
  ],
  [
    "https://media.hcdn.vn/catalog/product/o/g/og-image-auto-tinh-chat-bi-dao-cocoon-lam-giam-mun-mo-tham-70ml-moi_uyuEkXvHW7ehee5e.png",
    {
      url: "/assets/beautymatch/images/catalog/HASAKI-SER-008.png",
      crop: {
        x: 178,
        y: 207,
        width: 115,
        height: 312,
      },
    },
  ],
  [
    "https://media.hcdn.vn/catalog/product/o/g/og-image-auto-nuoc-hoa-hong-khong-mui-klairs-danh-cho-da-nhay-cam-180ml_qiCkR78L7X1YPyZW.png",
    {
      url: "/assets/beautymatch/images/catalog/HASAKI-TON-009.png",
      crop: {
        x: 102,
        y: 208,
        width: 130,
        height: 324,
      },
    },
  ],
]);
export function catalogImage(source) {
  return catalogImages.get(source)?.url || source;
}
export function catalogCrop(source) {
  return catalogImages.get(source)?.crop;
}
