import { defineStore } from "pinia";
import { ref } from "vue";
import {
  createLiveApi,
  normalizeRecommendation,
} from "../../beautymatch/public/js/api.mjs";
import { normalizeIntake } from "./domain.mjs";

function read(key) {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}
export const useBeautyMatch = defineStore("beautymatch-native", () => {
  const api = createLiveApi({ csrf: window.csrf_token || "" });
  const selected = ref(read("beautymatch_customer_v1")?.crm_lead || "");
  const customer = ref(null);
  const result = ref(null);
  const resultContext = ref(null);
  const busy = ref(false);
  let work;
  const account = () =>
    decodeURIComponent(
      document.cookie
        .split("; ")
        .find((value) => value.startsWith("user_id="))
        ?.slice(8) || "session",
    );
  const intakeKey = () => `beautymatch_crm_intake_v1:${account()}`;
  const receiptKey = () => `beautymatch_crm_receipt_v1:${account()}`;

  function selectLead(lead) {
    if (lead !== selected.value) {
      result.value = null;
      resultContext.value = null;
      customer.value = null;
      sessionStorage.removeItem("beautymatch_open_session_v1");
      sessionStorage.removeItem(receiptKey());
    }
    selected.value = lead || "";
    if (lead)
      sessionStorage.setItem(
        "beautymatch_customer_v1",
        JSON.stringify({ crm_lead: lead }),
      );
    else sessionStorage.removeItem("beautymatch_customer_v1");
  }
  function syncSelection() {
    const lead = read("beautymatch_customer_v1")?.crm_lead || "";
    if (lead !== selected.value) {
      selected.value = lead;
      result.value = null;
      resultContext.value = null;
      customer.value = null;
    }
  }
  async function loadCustomer() {
    syncSelection();
    customer.value = selected.value
      ? await api.customerContext(selected.value)
      : null;
    return customer.value;
  }
  function retryIntake() {
    const value = read(intakeKey());
    return value?.crm_lead === (selected.value || null) ? value : null;
  }
  async function submit(form) {
    if (work) return work;
    busy.value = true;
    work = (async () => {
      const previous = retryIntake();
      const normalized = normalizeIntake(form);
      const signature = JSON.stringify(normalized);
      const request_id =
        previous?.signature === signature
          ? previous.payload.request_id
          : crypto.randomUUID();
      const payload = { ...normalized, request_id };
      sessionStorage.setItem(
        intakeKey(),
        JSON.stringify({
          crm_lead: selected.value || null,
          signature,
          payload,
        }),
      );
      const receipt = await api.saveConsultation(
        payload,
        selected.value || null,
      );
      if (
        !["crm_lead", "beauty_profile", "request_id", "profile_version"].every(
          (key) => typeof receipt[key] === "string" && receipt[key],
        )
      )
        throw new Error(
          "Máy chủ chưa trả đủ thông tin tư vấn. Hãy thử lại cùng yêu cầu.",
        );
      selectLead(receipt.crm_lead);
      const identifiers = Object.fromEntries(
        ["crm_lead", "beauty_profile", "request_id", "profile_version"].map(
          (key) => [key, receipt[key]],
        ),
      );
      sessionStorage.setItem(receiptKey(), JSON.stringify(identifiers));
      sessionStorage.removeItem("beautymatch_open_session_v1");
      sessionStorage.removeItem(intakeKey());
      result.value = null;
      return receipt;
    })();
    try {
      return await work;
    } finally {
      busy.value = false;
      work = null;
    }
  }
  async function loadResult() {
    syncSelection();
    const opened = read("beautymatch_open_session_v1");
    const receipt = read(receiptKey());
    if (opened?.session_id && opened.crm_lead === selected.value) {
      result.value = normalizeRecommendation(
        await api.result(opened.session_id),
      );
    } else if (receipt?.crm_lead === selected.value) {
      result.value = normalizeRecommendation(await api.generate(receipt));
      sessionStorage.setItem(
        "beautymatch_open_session_v1",
        JSON.stringify({
          crm_lead: selected.value,
          session_id: result.value.session_id,
        }),
      );
    } else {
      result.value = null;
      resultContext.value = null;
      return;
    }
    resultContext.value = await api.context(result.value.session_id);
  }
  function openSession(session) {
    selectLead(session.crm_lead || selected.value);
    sessionStorage.setItem(
      "beautymatch_open_session_v1",
      JSON.stringify({
        crm_lead: selected.value,
        session_id: session.session_id,
      }),
    );
    result.value = null;
  }
  return {
    api,
    selected,
    customer,
    result,
    resultContext,
    busy,
    selectLead,
    syncSelection,
    loadCustomer,
    retryIntake,
    submit,
    loadResult,
    openSession,
  };
});
