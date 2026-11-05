// Presentation only: TASK2 still owns validation, submission and retry IDs.
const form = document.getElementById("bm-consultation-form");
if (form) {
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const sections = [...form.querySelectorAll("[data-consultation-section]")];
  const steps = [...document.querySelectorAll(".bm-step[data-consult-step]")];
  const progress = document.querySelector(".bm-form-progress");
  const progressText = document.getElementById("bm-progress-text");
  const field = (name) => form.elements.namedItem(name);
  const value = (name) => field(name)?.value.trim() || "";
  const stepDescriptions = steps.map((step, index) => {
    const description = document.createElement("span");
    description.id = `bm-step-status-${index + 1}`;
    description.className = "sr-only";
    step.append(description);
    step.setAttribute("aria-describedby", description.id);
    return description;
  });

  function updateProgress() {
    const concernCount = form.querySelectorAll(
      "#bm-concerns input:checked",
    ).length;
    const email = value("email");
    // This is a visual completion hint; the original submit validation remains
    // authoritative and runs even if a visitor skips directly to confirmation.
    const completion = [
      Boolean(
        value("full_name") &&
        (email || value("phone")) &&
        (!email || field("email").validity.valid),
      ),
      Boolean(
        value("skin_type") &&
        value("sensitivity") &&
        concernCount >= 1 &&
        concernCount <= 3,
      ),
      Boolean(value("requested_category") && Number(value("max_budget")) > 0),
      Boolean(field("consent")?.checked),
    ];
    steps.forEach((step, index) => {
      step.classList.toggle("is-complete", completion[index]);
      stepDescriptions[index].textContent = completion[index]
        ? "Đã điền đủ thông tin."
        : "Chưa điền đủ thông tin.";
    });
    const done = completion.filter(Boolean).length;
    progress?.setAttribute("aria-valuenow", String(done * 25));
    if (progress?.firstElementChild)
      progress.firstElementChild.style.width = `${done * 25}%`;
    const label = `${done}/4 mục đã hoàn tất`;
    if (progressText && progressText.textContent !== label)
      progressText.textContent = label;
  }

  function setCurrent(number) {
    steps.forEach((step) => {
      const current = step.dataset.consultStep === String(number);
      step.classList.toggle("is-current", current);
      if (current) step.setAttribute("aria-current", "step");
      else step.removeAttribute("aria-current");
    });
  }

  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-consult-step]");
    if (!control) return;
    const number = control.dataset.consultStep;
    const section = document.getElementById(`bm-section-${number}`);
    if (!section) return;
    setCurrent(number);
    section.querySelector("h2")?.focus({ preventScroll: true });
    section.scrollIntoView({
      behavior: reducedMotion.matches ? "instant" : "smooth",
      block: "start",
    });
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0])
          setCurrent(visible[0].target.dataset.consultationSection);
      },
      { rootMargin: "-18% 0px -55% 0px", threshold: 0 },
    );
    sections.forEach((section) => observer.observe(section));
    window.addEventListener("pagehide", () => observer.disconnect(), {
      once: true,
    });
  }
  form.addEventListener("input", updateProgress);
  form.addEventListener("change", updateProgress);
  form.addEventListener("focusin", (event) => {
    const section = event.target.closest("[data-consultation-section]");
    if (section) setCurrent(section.dataset.consultationSection);
  });
  // workspace.mjs pre-fills the original form after its authorized API request.
  // Observe the existing submit button, which is re-enabled only after prefill.
  const submit = document.getElementById("bm-submit");
  if (submit && "MutationObserver" in window) {
    const observer = new MutationObserver(updateProgress);
    observer.observe(submit, {
      attributes: true,
      attributeFilter: ["disabled"],
    });
    window.addEventListener("pagehide", () => observer.disconnect(), {
      once: true,
    });
  }
  updateProgress();
  document.addEventListener("beautymatch:consultation-ready", updateProgress);
  window.addEventListener("load", updateProgress, { once: true });
  window.addEventListener("pageshow", updateProgress);
}
