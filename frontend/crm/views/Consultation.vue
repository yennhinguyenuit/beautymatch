<script setup>
import { onMounted, reactive, ref, computed } from "vue";
import { useRouter } from "vue-router";
import { Button, FormControl } from "frappe-ui";
import StatePanel from "../components/StatePanel.vue";
import { useBeautyMatch } from "../store.mjs";
import { emptyForm, skinTypes, concerns, avoids, categories, validateForm } from "../domain.mjs";
const store = useBeautyMatch();
const router = useRouter();
const form = reactive(emptyForm());
const loading = ref(true);
const error = ref("");
const loaded = ref(false);
const concernCount = computed(() => Object.keys(concerns).filter((key) => form[key]).length);
async function load() {
	loading.value = true;
	error.value = "";
	loaded.value = false;
	try {
		const customer = await store.loadCustomer();
		const retry = store.retryIntake();
		if (retry) {
			Object.assign(form, retry.payload);
			delete form.request_id;
		} else if (customer)
			Object.assign(form, emptyForm(), customer.profile, {
				full_name: customer.full_name,
				email: customer.email,
				phone: customer.phone,
				consent: false,
			});
		// Consent is never inherited from a saved profile.
		form.consent = false;
		loaded.value = true;
	} catch (e) {
		error.value = e.message;
	} finally {
		loading.value = false;
	}
}
async function submit() {
	error.value = validateForm(form);
	if (error.value) return;
	try {
		await store.submit({ ...form });
		await router.push({ name: "BeautyMatch", params: { section: "result" } });
	} catch (e) {
		error.value = e.message;
	}
}
onMounted(load);
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">PHIÊN TƯ VẤN</p>
			<h1>Hồ sơ làn da</h1>
			<p>
				{{
					store.selected
						? `Đang tư vấn cho ${store.customer?.full_name || "CRM Lead đã chọn"}.`
						: "Tạo tư vấn mới; backend đối chiếu email/số điện thoại để tránh Lead trùng."
				}}
			</p>
		</div>
		<Button
			label="Chọn khách hàng khác"
			:disabled="store.busy"
			@click="router.push({ name: 'BeautyMatch' })"
		/>
	</div>
	<StatePanel v-if="loading || !loaded" :loading="loading" :error="error" @retry="load" />
	<form v-else class="bm-native-form" @submit.prevent="submit" :aria-busy="store.busy">
		<fieldset :disabled="store.busy">
			<legend>Khách hàng</legend>
			<div class="bm-native-fields">
				<FormControl
					v-model="form.full_name"
					label="Họ và tên"
					name="full_name"
					required
				/><FormControl
					v-model="form.email"
					type="email"
					label="Email"
					name="email"
					:readonly="Boolean(store.customer?.email)"
				/><FormControl
					v-model="form.phone"
					type="tel"
					label="Số điện thoại"
					name="phone"
					:readonly="Boolean(store.customer?.phone)"
				/>
			</div>
			<p class="bm-native-help">
				Cần ít nhất email hoặc số điện thoại. Thông tin đã gắn với Lead được giữ để đối
				chiếu chính xác.
			</p>
		</fieldset>
		<fieldset :disabled="store.busy">
			<legend>Tình trạng làn da</legend>
			<div class="bm-native-fields">
				<FormControl
					v-model="form.skin_type"
					type="select"
					label="Loại da"
					name="skin_type"
					:options="[
						{ label: 'Chọn loại da', value: '' },
						...Object.entries(skinTypes).map(([value, label]) => ({ value, label })),
					]"
					required
				/><FormControl
					v-model="form.sensitivity"
					type="select"
					label="Độ nhạy cảm"
					name="sensitivity"
					:options="[
						{ label: 'Chọn độ nhạy cảm', value: '' },
						{ label: 'Da nhạy cảm', value: 'Sensitive' },
						{ label: 'Không đặc biệt nhạy cảm', value: 'Not specifically sensitive' },
					]"
					required
				/>
			</div>
			<p class="bm-native-group-label">Vấn đề da · {{ concernCount }}/3</p>
			<div class="bm-native-choices">
				<FormControl
					v-for="(label, key) in concerns"
					:key="key"
					v-model="form[key]"
					type="checkbox"
					:label="label"
					:name="key"
					:disabled="concernCount >= 3 && !form[key]"
				/>
			</div>
		</fieldset>
		<fieldset :disabled="store.busy">
			<legend>Nhu cầu chăm sóc</legend>
			<div class="bm-native-fields">
				<FormControl
					v-model="form.requested_category"
					type="select"
					label="Danh mục sản phẩm"
					name="requested_category"
					:options="[
						{ label: 'Chọn danh mục', value: '' },
						...Object.entries(categories).map(([value, label]) => ({ value, label })),
					]"
					required
				/><FormControl
					v-model="form.max_budget"
					type="number"
					min="0"
					step="any"
					label="Ngân sách tối đa (VND)"
					name="max_budget"
					required
				/><FormControl
					v-model="form.preferred_brand"
					label="Thương hiệu ưa thích (không bắt buộc)"
					name="preferred_brand"
					maxlength="140"
				/>
			</div>
			<p class="bm-native-group-label">Thành phần muốn tránh</p>
			<div class="bm-native-choices">
				<FormControl
					v-for="(label, key) in avoids"
					:key="key"
					v-model="form[key]"
					type="checkbox"
					:label="label"
					:name="key"
				/>
			</div>
		</fieldset>
		<fieldset :disabled="store.busy">
			<legend>Xác nhận</legend>
			<FormControl
				v-model="form.consent"
				type="checkbox"
				label="Khách hàng đồng ý lưu thông tin tư vấn và hồ sơ làn da trong CRM."
				name="consent"
			/>
			<p class="bm-native-help">
				Xác nhận mới cho mỗi lần tư vấn; không tự lấy đồng ý từ hồ sơ trước.
			</p>
		</fieldset>
		<p v-if="error" class="bm-native-error" role="alert">{{ error }}</p>
		<div class="bm-native-actions">
			<Button
				type="submit"
				label="Lưu hồ sơ & tạo gợi ý"
				variant="solid"
				:loading="store.busy"
				:disabled="store.busy"
			/><Button
				label="Trở lại hồ sơ"
				:disabled="!store.selected || store.busy"
				@click="router.push({ name: 'BeautyMatch', params: { section: 'customer' } })"
			/>
		</div>
	</form>
</template>
