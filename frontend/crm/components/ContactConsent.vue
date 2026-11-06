<script setup>
import { ref, computed } from "vue";
import { Button } from "frappe-ui";
import { careCall } from "../care-api.mjs";
const props = defineProps({ session: Object, customer: Object });
const interested = computed(
	() => props.session?.results?.filter((i) => i.customer_feedback === "Interested") || [],
);
const open = ref(false),
	consent = ref(false),
	channel = ref("Email"),
	contact = ref(""),
	time = ref(""),
	note = ref(""),
	busy = ref(false),
	message = ref("");
let signature = "",
	uuid = "";
function begin() {
	open.value = true;
	consent.value = false;
	contact.value = props.customer?.email || "";
}
async function send() {
	if (busy.value) return;
	if (!consent.value) {
		message.value = "Cần khách đồng ý được liên hệ ở bước riêng.";
		return;
	}
	const values = {
		item_ids: interested.value.map((i) => i.item_id),
		channel: channel.value,
		contact_value: contact.value,
		preferred_time: time.value,
		customer_note: note.value,
		contact_consent: 1,
	};
	const next = JSON.stringify(values);
	if (next !== signature) {
		signature = next;
		uuid = crypto.randomUUID();
	}
	busy.value = true;
	try {
		const r = await careCall("request_staff_contact", {
			session_id: props.session.session_id,
			payload: { ...values, request_id: uuid },
		});
		message.value = `Đã lưu yêu cầu ${r.request_id.slice(0, 8)} · ${r.follow_up_status === "CREATED" ? "Đã giao công việc" : "Chờ phân công"}`;
		signature = "";
		uuid = "";
		open.value = false;
	} catch (e) {
		message.value = e.message;
	} finally {
		busy.value = false;
	}
}
</script>
<template>
	<section v-if="interested.length" class="bm-native-panel bm-care-form">
		<h2>Khách có muốn chuyên viên liên hệ thêm?</h2>
		<p>Phản hồi Quan tâm đã lưu riêng. Chỉ gửi công việc sau khi khách xác nhận đồng ý.</p>
		<Button label="Ghi nhận khách đồng ý liên hệ" @click="begin" />
		<form v-if="open" @submit.prevent="send">
			<p>Sản phẩm: {{ interested.map((i) => i.product_name).join("; ") }}</p>
			<label
				>Phương thức<select v-model="channel">
					<option value="Email">Email</option>
					<option value="Phone">Điện thoại</option>
				</select></label
			>
			<label>Liên hệ đã xác nhận<input v-model="contact" required maxlength="140" /></label>
			<label>Khung thời gian mong muốn<input v-model="time" maxlength="140" /></label>
			<label>Lời nhắn của khách<textarea v-model="note" maxlength="1000" /></label>
			<label
				><input v-model="consent" type="checkbox" required /> Khách đã đồng ý được liên hệ
				theo thông tin này.</label
			>
			<Button type="submit" label="Gửi yêu cầu tư vấn thêm" :loading="busy" />
			<Button label="Đóng" @click="open = false" />
		</form>
		<p role="status">{{ message }}</p>
	</section>
</template>
