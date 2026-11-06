<script setup>
import { ref, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "frappe-ui";
import StatePanel from "../components/StatePanel.vue";
import { careCall } from "../care-api.mjs";
import { openNativeTask } from "../integration.mjs";
import { date } from "../domain.mjs";
import { latestRequest } from "../latest-request.mjs";
import { useBeautyMatch } from "../store.mjs";
const next = latestRequest();
onUnmounted(next);
const props = defineProps({ lead: { type: String, default: "" } });
const route = useRoute(),
	router = useRouter();
const rows = ref([]),
	loading = ref(false),
	error = ref(""),
	selected = ref(null),
	busy = ref(false),
	message = ref("");
const outcome = ref("Consulted"),
	from = ref(""),
	started = ref(""),
	duration = ref(""),
	notes = ref(""),
	occurred = ref(false),
	demo = ref(false),
	callback = ref("");
const labels = {
	"Pending Assignment": "Chờ phân công",
	Open: "Chờ chăm sóc",
	"In Progress": "Đang chăm sóc",
	Completed: "Đã hoàn thành",
	Canceled: "Đã hủy công việc",
	"Do Not Contact": "Đã dừng liên hệ",
};
const outcomes = {
	Consulted: "Đã tư vấn thành công",
	"No Answer": "Khách chưa nghe máy",
	"Call Back": "Khách yêu cầu gọi lại",
	"No Longer Interested": "Khách không còn nhu cầu",
	"More Information": "Khách muốn tìm hiểu thêm",
};
let callId = "";
async function load() {
	const current = next();
	loading.value = true;
	error.value = "";
	rows.value = [];
	try {
		const reply =
			route.name === "BeautyMatchContact"
				? [await careCall("get_contact", { request_id: route.params.leadId })]
				: (await careCall("list_contacts", props.lead ? { crm_lead: props.lead } : {}))
						.requests;
		if (current()) {
			rows.value = reply;
			if (route.name === "BeautyMatchContact" && reply[0])
				useBeautyMatch().selectLead(reply[0].crm_lead);
		}
	} catch (e) {
		if (current()) error.value = e.message;
	} finally {
		if (current()) loading.value = false;
	}
}
function begin(row) {
	selected.value = row;
	message.value = "";
	notes.value = "";
	duration.value = "";
	occurred.value = false;
	demo.value = false;
	outcome.value = "Consulted";
	callId = crypto.randomUUID();
	const now = new Date();
	started.value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
async function record() {
	if (busy.value) return;
	busy.value = true;
	message.value = "";
	try {
		const r = await careCall("record_call", {
			request_id: selected.value.request_id,
			payload: {
				call_id: callId,
				outcome: outcome.value,
				from_number: from.value,
				start_time: new Date(started.value).toISOString(),
				duration: duration.value || 0,
				notes: notes.value,
				occurred: occurred.value ? 1 : 0,
				is_demo: demo.value ? 1 : 0,
			},
		});
		message.value = `Đã ghi Call Log ${r.call_id}. Công việc chưa tự hoàn thành.`;
		selected.value = null;
		await load();
	} catch (e) {
		message.value = e.message;
	} finally {
		busy.value = false;
	}
}
async function update(row, action) {
	if (busy.value) return;
	busy.value = true;
	message.value = "";
	try {
		await careCall("update_task", {
			request_id: row.request_id,
			action,
			...(action === "callback" ? { due_date: new Date(callback.value).toISOString() } : {}),
		});
		await load();
		message.value = "Đã cập nhật công việc trong CRM.";
	} catch (e) {
		message.value = e.message;
	} finally {
		busy.value = false;
	}
}
onMounted(load);
watch(() => [props.lead, route.params.leadId], load);
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">CHĂM SÓC SAU TƯ VẤN</p>
			<h1 v-if="!lead">Yêu cầu liên hệ</h1>
			<h2 v-else>Liên hệ & lịch sử cuộc gọi</h2>
			<p>
				Chỉ tiếp tục theo sự đồng ý khách đã xác nhận. Cuộc gọi được ghi bằng Call Logs gốc
				của CRM.
			</p>
		</div>
		<Button label="Cập nhật liên hệ" :loading="loading" @click="load" />
	</div>
	<StatePanel v-if="loading || error" :loading="loading" :error="error" @retry="load" />
	<p role="status">{{ message }}</p>
	<StatePanel
		v-if="!loading && !error && !rows.length"
		title="Chưa có yêu cầu liên hệ"
		text="Khách chỉ quan tâm sản phẩm sẽ chưa tạo công việc chăm sóc."
	/>
	<article
		v-for="row in rows"
		:key="row.request_id"
		class="bm-native-panel bm-care-request"
		:data-contact="row.request_id"
	>
		<p class="bm-native-eyebrow">{{ labels[row.status] }}</p>
		<h2>{{ row.customer_name }}</h2>
		<p>Mã {{ row.request_id.slice(0, 8) }} · {{ date(row.created_at) }}</p>
		<p>{{ row.products.map((p) => p.product_name).join("; ") }}</p>
		<p>
			{{ row.channel === "Phone" ? "Điện thoại" : "Email" }} đã xác nhận:
			<strong>{{ row.contact_value }}</strong>
		</p>
		<p>{{ row.preferred_time }} · {{ row.customer_note }}</p>
		<p>
			Nhân viên: {{ row.assigned_to || "Chờ phân công" }} · CRM Task
			{{ row.task || "chưa tạo" }} · {{ row.task_status || "Chờ xử lý" }}
		</p>
		<div class="bm-native-actions">
			<Button
				label="Mở CRM Lead"
				@click="router.push({ name: 'Lead', params: { leadId: row.crm_lead } })"
			/><Button
				v-if="row.task"
				label="Mở CRM Task"
				@click="openNativeTask(row.task)"
			/><Button
				v-if="
					row.channel === 'Phone' &&
					row.task &&
					!['Completed', 'Do Not Contact', 'Canceled'].includes(row.status)
				"
				label="Ghi nhận cuộc gọi"
				@click="begin(row)"
			/><Button
				v-if="
					row.channel === 'Phone' &&
					row.task &&
					!['Completed', 'Do Not Contact', 'Canceled'].includes(row.status)
				"
				label="Hoàn thành chăm sóc"
				:loading="busy"
				@click="update(row, 'complete')"
			/>
		</div>
		<div
			v-if="row.task && !['Completed', 'Do Not Contact', 'Canceled'].includes(row.status)"
			class="bm-care-form"
		>
			<label>Thời hạn liên hệ lại<input v-model="callback" type="datetime-local" /></label
			><Button
				label="Lên lịch liên hệ lại"
				:loading="busy"
				@click="update(row, 'callback')"
			/>
		</div>
		<form
			v-if="selected?.request_id === row.request_id"
			class="bm-care-form"
			@submit.prevent="record"
		>
			<h3>Ghi cuộc gọi đã thực hiện</h3>
			<p>
				Không thực hiện cuộc gọi từ website. Ghi nhận sau khi bạn đã gọi hoặc thử liên hệ
				ngoài hệ thống.
			</p>
			<label
				>Số điện thoại nhân viên đã dùng<input v-model="from" type="tel" required /></label
			><label
				>Thời điểm thực hiện<input
					v-model="started"
					type="datetime-local"
					required /></label
			><label
				>Kết quả chăm sóc<select v-model="outcome">
					<option v-for="(label, value) in outcomes" :key="value" :value="value">
						{{ label }}
					</option>
				</select></label
			><label
				>Thời lượng giây, nếu biết<input
					v-model="duration"
					type="number"
					min="0"
					max="86400" /></label
			><label>Nội dung trao đổi<textarea v-model="notes" maxlength="2000" required /></label
			><label
				><input v-model="occurred" type="checkbox" required /> Tôi xác nhận đã thực hiện
				hoặc thử cuộc gọi được ghi.</label
			><label
				><input v-model="demo" type="checkbox" /> Cuộc gọi giả lập DEMO, không trình bày là
				cuộc gọi thật.</label
			>
			<div class="bm-native-actions">
				<Button type="submit" label="Lưu Call Log" :loading="busy" /><Button
					label="Đóng biểu mẫu"
					@click="selected = null"
				/>
			</div>
		</form>
		<ol class="bm-care-timeline">
			<li v-for="call in row.calls" :key="call.name">
				<strong
					>{{ call.beautymatch_is_demo ? "[DEMO] " : ""
					}}{{ outcomes[call.beautymatch_outcome] }}</strong
				>
				<p>
					{{ date(call.start_time) }} · {{ call.caller }} · {{ call.duration || 0 }} giây
				</p>
				<p>{{ call.note_text }}</p>
				<Button
					label="Mở Call Log gốc"
					@click="router.push({ name: 'Call Logs', query: { open: call.name } })"
				/>
			</li>
		</ol>
	</article>
</template>
