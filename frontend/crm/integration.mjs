// Compiled into the host CRM bundle. This is a custom bridge, not an upstream
// Frappe plugin API. No Vue private properties, DOM menu injection or new app.
import { reactive } from "vue";
import LeafIcon from "./LeafIcon.vue";
import { useBeautyMatch } from "./store.mjs";
import { currentAccount } from "../../beautymatch/public/js/account-context.mjs";

export const nativeAccess = reactive({ allowed: false, checked: false });
export const beautyMatchNavigationItem = {
  label: "BeautyMatch",
  icon: LeafIcon,
  route: "BeautyMatch",
};
export const hasBeautyMatchAccess = () => nativeAccess.allowed;
const sections = new Set([
  "",
  "requests",
  "care",
  "consultation",
  "customer",
  "result",
  "feedback",
  "dashboard",
]);
let hostRouter;
let pending;
let pendingAccount = "";
let checkedAt = 0;
let checkedAccount = "";

export async function refreshNativeAccess(force = false) {
  const user = currentAccount();
  if (user !== checkedAccount) {
    nativeAccess.checked = false;
    nativeAccess.allowed = false;
    checkedAccount = user;
    force = true;
  }
  if (!force && nativeAccess.checked && Date.now() - checkedAt < 60000)
    return nativeAccess.allowed;
  if (pending) {
    if (pendingAccount === user) return pending;
    await pending;
    return refreshNativeAccess(true);
  }
  pendingAccount = user;
  pending = (async () => {
    try {
      const response = await fetch(
        "/api/method/beautymatch.api.navigation.get_sidebar_entry",
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        },
      );
      const data = response.ok ? (await response.json()).message : null;
      if (user !== currentAccount()) return false;
      nativeAccess.allowed =
        data?.label === "BeautyMatch" &&
        ["/beautymatch", "/crm/beautymatch"].includes(data?.href);
    } catch {
      nativeAccess.allowed = false;
    } finally {
      nativeAccess.checked = user === currentAccount();
      checkedAt = Date.now();
      pending = null;
    }
    return nativeAccess.allowed;
  })();
  return pending;
}

export function installBeautyMatchRoutes(router, { isLoggedIn }) {
  if (router.hasRoute("BeautyMatch")) return;
  hostRouter = router;
  router.addRoute({
    path: "/beautymatch/:section?",
    name: "BeautyMatch",
    component: () => import("./Workspace.vue"),
    meta: { beautyMatch: true },
  });
  // CRM notification links pass `leadId`; for this route it is an opaque
  // customer-request UUID. The backend still checks the linked Lead permission.
  router.addRoute({
    path: "/beautymatch/request/:leadId",
    name: "BeautyMatchRequest",
    component: () => import("./Workspace.vue"),
    meta: { beautyMatch: true },
  });
  router.addRoute({
    path: "/beautymatch/contact/:leadId",
    name: "BeautyMatchContact",
    component: () => import("./Workspace.vue"),
    meta: { beautyMatch: true },
  });
  router.beforeEach(async (to) => {
    useBeautyMatch().syncSelection();
    if (!isLoggedIn()) {
      useBeautyMatch().reset();
      nativeAccess.allowed = false;
      nativeAccess.checked = false;
      return;
    }
    await refreshNativeAccess();
    if (to.name === "BeautyMatch" && !sections.has(to.params.section || ""))
      return { name: "BeautyMatch" };
    // The page renders a denied state without fetching customer data when the
    // capability is false. All business APIs independently enforce permissions.
  });
  window.beautymatch_native_crm = true;
  // Retire the old compatibility adapter if a stale runtime loaded it first.
  window[Symbol.for("beautymatch.crm.sidebar")]?.();
  document.addEventListener("beautymatch:open", (event) => {
    const section = event.detail?.section || "";
    if (event.detail?.lead) {
      const store = useBeautyMatch();
      if (section === "consultation") store.newConsultation(event.detail.lead);
      else store.selectLead(event.detail.lead);
      if (event.detail.session)
        store.openSession({
          crm_lead: event.detail.lead,
          session_id: event.detail.session,
        });
    }
    if (sections.has(section))
      router.push({
        name: "BeautyMatch",
        params: { section: section || undefined },
      });
  });
  document.addEventListener("beautymatch:session-ended", () => {
    useBeautyMatch().reset();
    nativeAccess.allowed = false;
    nativeAccess.checked = false;
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) useBeautyMatch().syncSelection();
  });
  document.addEventListener("beautymatch:task", (event) => {
    if (typeof event.detail?.task === "string")
      openNativeTask(event.detail.task);
  });
}

export async function openNativeTask(name) {
  if (!hostRouter || !/^[a-zA-Z0-9_-]+$/.test(String(name))) return;
  await hostRouter.push({ name: "Tasks", params: { viewType: "list" } });
  const { useDoctypeModal } = await import("@/composables/doctypeModal");
  useDoctypeModal().showModal({ name, doctype: "CRM Task", title: "Task" });
}
