// Progressive visual enhancement: content stays usable without animation.
const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
const wide = window.matchMedia("(min-width: 901px)");
let observer;
if ("IntersectionObserver" in window) {
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.08 },
  );
}
function enhance() {
  document
    .querySelectorAll("[data-reveal]:not([data-motion-bound])")
    .forEach((el) => {
      el.dataset.motionBound = "true";
      if (!reduce.matches) observer?.observe(el);
    });
}
enhance();
let scan;
new MutationObserver(() => {
  cancelAnimationFrame(scan);
  scan = requestAnimationFrame(enhance);
}).observe(document.getElementById("app"), { childList: true, subtree: true });
let frame;
function parallax() {
  frame = null;
  document.querySelectorAll("[data-parallax]").forEach((el) => {
    const rect = el.getBoundingClientRect();
    const shift =
      !reduce.matches &&
      wide.matches &&
      rect.bottom > 0 &&
      rect.top < innerHeight
        ? Math.max(-28, Math.min(28, -rect.top * 0.065))
        : 0;
    el.style.setProperty("--parallax", `${shift}px`);
  });
}
addEventListener(
  "scroll",
  () => {
    if (!frame) frame = requestAnimationFrame(parallax);
  },
  { passive: true },
);
reduce.addEventListener("change", parallax);
wide.addEventListener("change", parallax);
