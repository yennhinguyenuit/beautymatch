<script setup>
import { Button } from "frappe-ui";
defineProps({
	loading: Boolean,
	error: String,
	title: { type: String, default: "Chưa có dữ liệu" },
	text: String,
});
defineEmits(["retry"]);
</script>
<template>
	<div class="bm-native-state" :role="error ? 'alert' : 'status'" :aria-busy="loading">
		<template v-if="loading"
			><div class="bm-native-skeleton" />
			<div class="bm-native-skeleton" />
			<p>Đang tải dữ liệu CRM…</p></template
		>
		<template v-else
			><h2>{{ error ? "Chưa thể tải dữ liệu" : title }}</h2>
			<p>{{ error || text }}</p>
			<Button
				v-if="error"
				label="Thử lại"
				iconLeft="refresh-cw"
				@click="$emit('retry')" /><slot
		/></template>
	</div>
</template>
