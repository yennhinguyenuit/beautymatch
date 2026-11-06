import { defineStore } from "pinia";
import { ref } from "vue";
import {
  createLiveApi,
  normalizeRecommendation,
} from "../../beautymatch/public/js/api.mjs";
import {
  currentAccount,
  createAccountContext,
} from "../../beautymatch/public/js/account-context.mjs";
import { normalizeIntake } from "./domain.mjs";
import { portalCall } from "./portal-api.mjs";

export const useBeautyMatch = defineStore("beautymatch-native", () => {
  const context = createAccountContext(sessionStorage, currentAccount);
  let owner = context.sync();
  const selected = ref(context.read("lead") || "");
  const customer = ref(null),
    result = ref(null),
    resultContext = ref(null);
  const request = ref(null),
    completionError = ref(""),
    completionBusy = ref(false),
    busy = ref(false);
  let work;
  const api = createLiveApi({
    csrf: window.csrf_token || "",
    fetcher: async (...args) => {
      const response = await fetch(...args);
      if (response.status === 401 || !currentAccount()) reset();
      return response;
    },
  });
  function clearMemory() {
    customer.value = result.value = resultContext.value = request.value = null;
    completionError.value = "";
  }
  function reset() {
    context.clear();
    selected.value = "";
    clearMemory();
  }
  function syncSelection() {
    const user = context.sync();
    if (user !== owner) {
      clearMemory();
      owner = user;
    }
    const lead = context.read("lead") || "";
    if (lead !== selected.value) {
      clearMemory();
      selected.value = lead;
    }
  }
  function assertAccount(user) {
    if (!user || user !== currentAccount()) {
      reset();
      throw new Error("Tài khoản đã thay đổi. Vui lòng mở lại BeautyMatch.");
    }
  }
  function selectLead(lead) {
    syncSelection();
    if ((lead || "") !== selected.value) {
      clearMemory();
      for (const key of ["handoff", "opened", "receipt", "intake"])
        context.write(key, null);
    }
    selected.value = lead || "";
    context.write("lead", selected.value);
  }
  function newConsultation(lead = selected.value) {
    selectLead(lead);
    clearMemory();
    for (const key of ["handoff", "opened", "receipt", "intake"])
      context.write(key, null);
  }
  function acceptRequest(value) {
    selectLead(value.crm_lead);
    context.write("handoff", {
      request_id: value.request_id,
      crm_lead: value.crm_lead,
    });
    context.write(
      "opened",
      value.session_id
        ? { crm_lead: value.crm_lead, session_id: value.session_id }
        : null,
    );
    context.write("receipt", null);
    context.write("intake", null);
    request.value = value;
  }
  async function loadCustomer() {
    syncSelection();
    const user = owner;
    const handoff = context.read("handoff");
    request.value = handoff
      ? await portalCall("get_request", { request_id: handoff.request_id })
      : null;
    assertAccount(user);
    if (request.value) {
      const snapshot = request.value.snapshot;
      customer.value = {
        ...snapshot,
        profile: snapshot,
        crm_lead: request.value.crm_lead,
      };
    } else
      customer.value = selected.value
        ? await api.customerContext(selected.value)
        : null;
    assertAccount(user);
    return customer.value;
  }
  function retryIntake() {
    const value = context.read("intake");
    return value?.crm_lead === (selected.value || null) ? value : null;
  }
  async function submit(form) {
    if (work) return work;
    syncSelection();
    const user = owner;
    busy.value = true;
    work = (async () => {
      const previous = retryIntake();
      const normalized = normalizeIntake(form);
      const signature = JSON.stringify(normalized);
      const payload = {
        ...normalized,
        request_id:
          previous?.signature === signature
            ? previous.payload.request_id
            : crypto.randomUUID(),
      };
      context.write("intake", {
        crm_lead: selected.value || null,
        signature,
        payload,
      });
      const handoff = context.read("handoff");
      let receipt;
      if (handoff) {
        const reply = await portalCall("generate_for_request", {
          request_id: handoff.request_id,
          payload,
        });
        assertAccount(user);
        receipt = reply.receipt;
        result.value = normalizeRecommendation(reply.result);
        context.write("opened", {
          crm_lead: receipt.crm_lead,
          session_id: result.value.session_id,
        });
      } else {
        receipt = await api.saveConsultation(payload, selected.value || null);
        assertAccount(user);
        selectLead(receipt.crm_lead);
        context.write("opened", null);
        result.value = null;
      }
      if (
        !["crm_lead", "beauty_profile", "request_id", "profile_version"].every(
          (k) => typeof receipt[k] === "string" && receipt[k],
        )
      )
        throw new Error(
          "Máy chủ chưa trả đủ thông tin tư vấn. Hãy thử lại cùng yêu cầu.",
        );
      context.write(
        "receipt",
        Object.fromEntries(
          ["crm_lead", "beauty_profile", "request_id", "profile_version"].map(
            (key) => [key, receipt[key]],
          ),
        ),
      );
      context.write("intake", null);
      return receipt;
    })();
    try {
      return await work;
    } finally {
      busy.value = false;
      work = null;
    }
  }
  async function retryCompletion() {
    if (completionBusy.value || !result.value) return;
    const user = currentAccount();
    completionBusy.value = true;
    completionError.value = "";
    try {
      const actual = await portalCall("get_request", {
        session_id: result.value.session_id,
      });
      assertAccount(user);
      request.value = actual;
      if (!actual || actual.status === "Completed") return;
      if (actual.status === "Superseded") {
        completionError.value =
          "Yêu cầu đã có yêu cầu mới hơn. Kết quả này được giữ trong lịch sử; hãy tiếp nhận yêu cầu mới.";
        return;
      }
      const reply = await portalCall("complete_request", {
        request_id: actual.request_id,
        session_id: result.value.session_id,
      });
      assertAccount(user);
      if (reply.status !== "Completed")
        throw new Error("Máy chủ chưa xác nhận hoàn tất.");
      request.value = { ...actual, status: reply.status };
      context.write("handoff", null);
    } catch (error) {
      completionError.value =
        "Đã tạo kết quả tư vấn nhưng chưa cập nhật được trạng thái yêu cầu. " +
        error.message;
    } finally {
      completionBusy.value = false;
    }
  }
  async function loadResult() {
    syncSelection();
    const user = owner;
    let opened = context.read("opened");
    const receipt = context.read("receipt"),
      handoff = context.read("handoff");
    if (!opened && handoff) {
      const saved = await portalCall("get_request", {
        request_id: handoff.request_id,
      });
      assertAccount(user);
      if (saved.session_id)
        opened = { crm_lead: saved.crm_lead, session_id: saved.session_id };
    }
    if (opened?.session_id && opened.crm_lead === selected.value)
      result.value = normalizeRecommendation(
        await api.result(opened.session_id),
      );
    else if (receipt?.crm_lead === selected.value)
      result.value = normalizeRecommendation(await api.generate(receipt));
    else {
      result.value = resultContext.value = null;
      return;
    }
    assertAccount(user);
    context.write("opened", {
      crm_lead: selected.value,
      session_id: result.value.session_id,
    });
    resultContext.value = await api.context(result.value.session_id);
    assertAccount(user);
    await retryCompletion();
  }
  function openSession(session) {
    selectLead(session.crm_lead || selected.value);
    context.write("opened", {
      crm_lead: selected.value,
      session_id: session.session_id,
    });
    result.value = null;
  }
  return {
    api,
    selected,
    customer,
    result,
    resultContext,
    request,
    completionError,
    completionBusy,
    busy,
    selectLead,
    syncSelection,
    reset,
    newConsultation,
    acceptRequest,
    loadCustomer,
    retryIntake,
    submit,
    loadResult,
    retryCompletion,
    openSession,
  };
});
