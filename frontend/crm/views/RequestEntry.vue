<script setup>
import { ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "frappe-ui";
import StatePanel from "../components/StatePanel.vue";
import ProfileSummary from "../components/ProfileSummary.vue";
import { portalCall } from "../portal-api.mjs";
import { useBeautyMatch } from "../store.mjs";
import { date } from "../domain.mjs";
import { latestRequest } from "../latest-request.mjs";
const route = useRoute(),
	router = useRouter(),
	store = useBeautyMatch();
const data = ref(null),
	loading = ref(false),
	busy = ref(false),
	error = ref("");
const next = latestRequest();
const statuses = {
	Pending: "Chờ tiếp nhận",
	"In Progress": "Đang tư vấn",
	Completed: "Đã tư vấn",
	Superseded: "Đã có yêu cầu mới hơn",
};
async function load() {
	const current = next();
	data.value = null;
	error.value = "";
	loading.value = true;
	try {
		const reply = await portalCall("get_request", { request_id: route.params.leadId });
		if (current()) {
			data.value = reply;
			store.selectLead(reply.crm_lead);
		}
	} catch (e) {
		if (current()) error.value = e.message;
	} finally {
		if (current()) loading.value = false;
	}
}
async function accept() {
	if (busy.value) return;
	busy.value = true;
	error.value = "";
	try {
		const reply = await portalCall("accept_request", { request_id: data.value.request_id });
		store.acceptRequest(reply);
		await router.push({
			name: "BeautyMatch",
			params: { section: reply.session_id ? "result" : "consultation" },
		});
	} catch (e) {
		error.value = e.message;
	} finally {
		busy.value = false;
	}
}
function openResult() {
	store.openSession({ crm_lead: data.value.crm_lead, session_id: data.value.session_id });
	router.push({ name: "BeautyMatch", params: { section: "result" } });
}
onMounted(load);
watch(() => route.params.leadId, load);
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">YÊU CẦU BEAUTYMATCH</p>
			<h1>Hồ sơ khách đã gửi</h1>
			<p>Kiểm tra yêu cầu và tiếp nhận bằng tài khoản được phân quyền.</p>
		</div>
		<Button
			type="button"
			label="Danh sách yêu cầu"
			@click="router.push({ name: 'BeautyMatch', params: { section: 'requests' } })"
		/>
	</div>
	<StatePanel v-if="loading || error" :loading="loading" :error="error" @retry="load" />
	<article
		v-if="data && !loading"
		class="bm-native-panel"
		:data-request-detail="data.request_id"
	>
		<p class="bm-native-eyebrow">{{ statuses[data.status] }}</p>
		<h2>{{ data.snapshot.full_name }}</h2>
		<p>Mã {{ data.request_id.slice(0, 8) }} · {{ date(data.submitted_at) }}</p>
		<ProfileSummary :profile="data.snapshot" />
		<p v-if="data.status === 'Superseded'" class="bm-native-warning">
			Khách đã gửi nhu cầu mới. Yêu cầu này được giữ trong lịch sử và không thể tiếp nhận
			lại.
		</p>
		<div class="bm-native-actions">
			<Button
				v-if="data.can_accept || data.can_continue"
				type="button"
				variant="solid"
				:label="data.can_accept ? 'Tiếp nhận tư vấn' : 'Tiếp tục tư vấn'"
				:loading="busy"
				@click="accept"
			/>
			<Button
				v-if="data.session_id"
				type="button"
				label="Mở kết quả đã lưu"
				@click="openResult"
			/>
			<Button
				v-if="data.superseded_by"
				type="button"
				label="Xem yêu cầu mới hơn"
				@click="
					router.push({
						name: 'BeautyMatchRequest',
						params: { leadId: data.superseded_by },
					})
				"
			/>
			<Button
				type="button"
				label="Mở CRM Lead"
				@click="router.push({ name: 'Lead', params: { leadId: data.crm_lead } })"
			/>
		</div>
	</article>
</template>
