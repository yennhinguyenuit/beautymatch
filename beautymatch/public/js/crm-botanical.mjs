// Native CRM data resources, router and Vue components are never replaced.
if (document.documentElement.classList.contains("bm-crm")) {
  document.addEventListener("click", (event) => {
    const taskLink = event.target.closest?.(".bm-crm-insights a[data-bm-task]");
    if (
      taskLink &&
      window.beautymatch_native_crm &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.button === 0
    ) {
      event.preventDefault();
      document.dispatchEvent(
        new CustomEvent("beautymatch:task", {
          detail: { task: taskLink.dataset.bmTask },
        }),
      );
      return;
    }
    const link = event.target.closest?.(
      ".bm-crm-insights a[data-bm-action][data-bm-lead]",
    );
    if (!link) return;
    const lead = link.dataset.bmLead;
    if (
      !lead ||
      !["consultation", "history", "result"].includes(link.dataset.bmAction)
    )
      return;
    sessionStorage.setItem(
      "beautymatch_customer_v1",
      JSON.stringify({ crm_lead: lead }),
    );
    sessionStorage.removeItem("beautymatch_intake_retry_v1");
    sessionStorage.removeItem("beautymatch_sample_profile_v1");
    sessionStorage.removeItem("beautymatch_open_session_v1");
    if (link.dataset.bmAction === "result" && link.dataset.bmSession) {
      sessionStorage.setItem(
        "beautymatch_open_session_v1",
        JSON.stringify({ crm_lead: lead, session_id: link.dataset.bmSession }),
      );
    }
    if (
      window.beautymatch_native_crm &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      event.button === 0
    ) {
      event.preventDefault();
      document.dispatchEvent(
        new CustomEvent("beautymatch:open", {
          detail: {
            section:
              link.dataset.bmAction === "history"
                ? "customer"
                : link.dataset.bmAction,
          },
        }),
      );
    }
  });
}
