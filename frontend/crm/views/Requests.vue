<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Button, FormControl } from "frappe-ui";
import StatePanel from "../components/StatePanel.vue";
import ProfileSummary from "../components/ProfileSummary.vue";
import { useBeautyMatch } from "../store.mjs";
import { portalCall } from "../portal-api.mjs";
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
async function load(offset = 0) {
	loading.value = true;
	error.value = "";
	try {
		data.value = await portalCall("list_requests", { status: status.value, start: offset });
		start.value = offset;
	} catch (e) {
		error.value = e.message;
	} finally {
		loading.value = false;
	}
}
async function accept(request) {
	if (pending.value) return;
	pending.value = request.name;
	error.value = "";
	try {
		const reply = await portalCall("accept_request", { request_id: request.name });
		store.selectLead(reply.crm_lead);
		sessionStorage.setItem("beautymatch_staff_request_v1", JSON.stringify(reply));
		await router.push({ name: "BeautyMatch", params: { section: "consultation" } });
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
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">TIẾP NHẬN KHÁCH HÀNG</p>
			<h1>Yêu cầu tư vấn</h1>
			<p>Hồ sơ do khách hàng gửi, trong phạm vi CRM Lead bạn được phép quản lý.</p>
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
			v-model="status"
			type="select"
			label="Trạng thái yêu cầu"
			:options="Object.entries(statuses).map(([value, label]) => ({ value, label }))"
		/><Button label="Xem yêu cầu" type="submit" :loading="loading" />
	</form>
	<StatePanel v-if="loading" loading />
	<p v-if="error" class="bm-native-error" role="alert">{{ error }}</p>
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
				</div>
				<div class="bm-native-actions">
					<Button
						v-if="['Pending', 'In Progress'].includes(request.status)"
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
			/><span>Trang {{ Math.floor(start / 20) + 1 }}</span
			><Button label="Trang tiếp" :disabled="!data.has_more" @click="load(start + 20)" />
		</div>
	</div>
</template>
