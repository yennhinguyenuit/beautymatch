<script setup>
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { Button, FormControl } from "frappe-ui";
import StatePanel from "../components/StatePanel.vue";
import ProfileSummary from "../components/ProfileSummary.vue";
import { useBeautyMatch } from "../store.mjs";
import { portalCall } from "../portal-api.mjs";
import { latestRequest } from "../latest-request.mjs";
import { date } from "../domain.mjs";
const store = useBeautyMatch(),
	router = useRouter();
const statuses = {
	Pending: "Chờ tiếp nhận",
	"In Progress": "Đang tư vấn",
	Completed: "Đã tư vấn",
	Superseded: "Đã có yêu cầu mới",
};
const status = ref("Pending"),
	data = ref(null),
	loading = ref(false),
	error = ref(""),
	pending = ref(""),
	start = ref(0);
const search = ref("");
const next = latestRequest();
onUnmounted(next);
async function load(offset = 0) {
	const current = next();
	loading.value = true;
	error.value = "";
	data.value = null;
	start.value = offset;
	try {
		const reply = await portalCall("list_requests", {
			status: status.value,
			start: offset,
			search: search.value,
		});
		if (current()) data.value = reply;
	} catch (e) {
		if (current()) error.value = e.message;
	} finally {
		if (current()) loading.value = false;
	}
}
async function accept(request) {
	if (pending.value) return;
	pending.value = request.name;
	error.value = "";
	try {
		const reply = await portalCall("accept_request", { request_id: request.name });
		store.acceptRequest(reply);
		await router.push({
			name: "BeautyMatch",
			params: { section: reply.session_id ? "result" : "consultation" },
		});
	} catch (e) {
		error.value = e.message;
	} finally {
		pending.value = "";
	}
}
function open(request) {
	store.selectLead(request.crm_lead);
	router.push({ name: "BeautyMatch", params: { section: "customer" } });
}
onMounted(() => load());
watch(status, () => load(0));
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">TIẾP NHẬN KHÁCH HÀNG</p>
			<h1>Yêu cầu tư vấn từ phiên bản trước</h1>
			<p>
				Giữ lịch sử và tiếp tục các hồ sơ cũ. Khách mới nhận gợi ý ngay; chăm sóc tại Yêu
				cầu liên hệ.
			</p>
		</div>
		<Button
			label="Làm mới yêu cầu"
			iconLeft="refresh-cw"
			:loading="loading"
			@click="load(start)"
		/>
	</div>
	<form class="bm-native-toolbar" @submit.prevent="load(0)">
		<FormControl
			v-model="search"
			label="Tìm yêu cầu"
			placeholder="Tên khách hoặc mã yêu cầu"
		/>
		<FormControl
			v-model="status"
			type="select"
			label="Trạng thái yêu cầu"
			:options="Object.entries(statuses).map(([value, label]) => ({ value, label }))"
		/><Button label="Xem yêu cầu" type="submit" :loading="loading" />
	</form>
	<StatePanel v-if="loading" loading />
	<StatePanel v-if="error" :error="error" @retry="load(start)" />
	<StatePanel
		v-if="!loading && data && !data.requests.length"
		title="Chưa có yêu cầu trong nhóm này"
		text="Yêu cầu mới xuất hiện sau khi khách hàng gửi hồ sơ thành công."
	/>
	<div v-if="!loading && data" class="bm-native-request-list">
		<article
			v-for="request in data.requests"
			:key="request.name"
			class="bm-native-panel"
			:data-request="request.name"
		>
			<div class="bm-native-section-heading">
				<div>
					<p class="bm-native-eyebrow">{{ statuses[request.status] }}</p>
					<h2>{{ request.full_name }}</h2>
					<p>CRM Lead · {{ request.crm_lead }}</p>
					<p>{{ date(request.submitted_at) }} · Mã {{ request.name.slice(0, 8) }}</p>
					<p>Phụ trách: {{ request.assigned_name || "Chưa tiếp nhận" }}</p>
				</div>
				<div class="bm-native-actions">
					<Button
						v-if="request.can_accept || request.can_continue"
						:label="
							request.status === 'Pending' ? 'Tiếp nhận tư vấn' : 'Tiếp tục tư vấn'
						"
						variant="solid"
						:loading="pending === request.name"
						:disabled="Boolean(pending)"
						@click="accept(request)"
					/><Button label="Xem hồ sơ" @click="open(request)" />
				</div>
			</div>
			<ProfileSummary :profile="request.profile" />
		</article>
		<div class="bm-native-pagination">
			<Button
				label="Trang trước"
				:disabled="start === 0"
				@click="load(Math.max(0, start - 20))"
			/><span>Trang {{ Math.floor(start / 20) + 1 }} · {{ data.total }} yêu cầu</span
			><Button label="Trang tiếp" :disabled="!data.has_more" @click="load(start + 20)" />
		</div>
	</div>
</template>
