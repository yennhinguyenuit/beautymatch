<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Button, FormControl } from "frappe-ui";
import StatePanel from "../components/StatePanel.vue";
import { useBeautyMatch } from "../store.mjs";
import { portalCall } from "../portal-api.mjs";
import { date } from "../domain.mjs";
const store = useBeautyMatch();
const router = useRouter();
const search = ref("");
const data = ref(null);
const error = ref("");
const loading = ref(false);
const start = ref(0);
const queue = ref(null),
	queueError = ref("");
async function loadQueue() {
	queueError.value = "";
	queue.value = null;
	try {
		queue.value = await portalCall("list_requests");
	} catch (e) {
		queueError.value = e.message;
	}
}
async function load(offset = 0) {
	if (loading.value) return;
	loading.value = true;
	error.value = "";
	try {
		data.value = await store.api.workspace(search.value, offset);
		start.value = offset;
	} catch (e) {
		error.value = e.message;
	} finally {
		loading.value = false;
	}
}
function open(lead, section) {
	if (section === "consultation") store.newConsultation(lead);
	else store.selectLead(lead);
	router.push({ name: "BeautyMatch", params: { section } });
}
onMounted(() => {
	load();
	loadQueue();
});
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">KHÔNG GIAN TƯ VẤN</p>
			<h1>BeautyMatch</h1>
			<p>Hồ sơ da, gợi ý sản phẩm và chăm sóc khách hàng trong CRM.</p>
		</div>
		<Button
			label="Tư vấn khách hàng mới"
			variant="solid"
			iconLeft="plus"
			@click="open('', 'consultation')"
		/>
	</div>
	<div class="bm-native-panel bm-native-section-heading" style="margin-bottom: 24px">
		<div>
			<h2>{{ queue ? queue.total : "…" }} yêu cầu chờ tiếp nhận</h2>
			<p>Tiếp nhận yêu cầu mới và bắt đầu tư vấn trên đúng CRM Lead.</p>
		</div>
		<Button
			label="Tiếp nhận yêu cầu"
			@click="router.push({ name: 'BeautyMatch', params: { section: 'requests' } })"
		/>
	</div>
	<StatePanel v-if="queueError" :error="queueError" @retry="loadQueue" />
	<ul v-if="queue?.requests.length" class="bm-native-panel bm-native-queue-preview">
		<li v-for="entry in queue.requests.slice(0, 3)" :key="entry.name">
			<strong>{{ entry.full_name }}</strong
			><span>{{ date(entry.submitted_at) }} · {{ entry.name.slice(0, 8) }}</span
			><Button
				type="button"
				label="Xem yêu cầu"
				@click="router.push({ name: 'BeautyMatch', params: { section: 'requests' } })"
			/>
		</li>
	</ul>
	<form class="bm-native-toolbar" @submit.prevent="load(0)">
		<FormControl
			v-model="search"
			type="text"
			label="Tìm khách hàng"
			placeholder="Tên hoặc mã CRM Lead"
		/><Button type="submit" label="Tìm kiếm" :loading="loading" /><Button
			label="Mở danh sách Leads"
			@click="router.push({ name: 'Leads' })"
		/>
	</form>
	<StatePanel v-if="loading || error" :loading="loading" :error="error" @retry="load(start)" />
	<div v-else-if="data?.leads.length" class="bm-native-panel bm-native-table-wrap">
		<table>
			<caption class="bm-native-sr-only">
				CRM Leads có quyền truy cập
			</caption>
			<thead>
				<tr>
					<th>Khách hàng</th>
					<th>CRM Lead</th>
					<th>Trạng thái</th>
					<th>Thao tác</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="lead in data.leads" :key="lead.name">
					<td>
						{{
							[lead.first_name, lead.last_name].filter(Boolean).join(" ") ||
							lead.name
						}}
					</td>
					<td>{{ lead.name }}</td>
					<td>{{ lead.status }}</td>
					<td>
						<div class="bm-native-actions">
							<Button
								label="Tư vấn"
								@click="open(lead.name, 'consultation')"
							/><Button
								label="Hồ sơ & lịch sử"
								@click="open(lead.name, 'customer')"
							/>
						</div>
					</td>
				</tr>
			</tbody>
		</table>
	</div>
	<StatePanel
		v-else
		title="Chưa có khách hàng phù hợp"
		text="Điều chỉnh tìm kiếm hoặc mở một CRM Lead được phân công cho bạn."
	/>
	<div class="bm-native-pagination">
		<Button
			label="Trang trước"
			:disabled="start === 0 || loading"
			@click="load(Math.max(0, start - 20))"
		/><span>Từ {{ start + 1 }}</span
		><Button
			label="Trang sau"
			:disabled="!data?.has_more || loading"
			@click="load(start + 20)"
		/>
	</div>
</template>
