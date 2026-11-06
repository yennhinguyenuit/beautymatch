<script setup>
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "frappe-ui";
import LayoutHeader from "@/components/LayoutHeader.vue";
import { nativeAccess } from "./integration.mjs";
import { useBeautyMatch } from "./store.mjs";
import Overview from "./views/Overview.vue";
import Consultation from "./views/Consultation.vue";
import Results from "./views/Results.vue";
import Customer from "./views/Customer.vue";
import Analytics from "./views/Analytics.vue";
import "./native.css";

const route = useRoute();
const router = useRouter();
const store = useBeautyMatch();
store.syncSelection();
const tabs = [
	["", "Tổng quan"],
	["consultation", "Phiên tư vấn"],
	["customer", "Hồ sơ da"],
	["feedback", "Phản hồi khách hàng"],
	["dashboard", "Báo cáo tư vấn"],
];
const section = computed(() => route.params.section || "");
const title = computed(() =>
	section.value === "result"
		? "Kết quả tư vấn"
		: tabs.find(([key]) => key === section.value)?.[1] || "BeautyMatch",
);
const view = computed(
	() =>
		({
			"": Overview,
			consultation: Consultation,
			result: Results,
			customer: Customer,
			feedback: Customer,
			dashboard: Analytics,
		})[section.value],
);
const to = (key) => ({ name: "BeautyMatch", params: { section: key || undefined } });
</script>

<template>
	<LayoutHeader>
		<template #left-header
			><span class="bm-native-header"
				>BeautyMatch <span aria-hidden="true">/</span> {{ title }}</span
			></template
		>
		<template #right-header
			><Button
				v-if="store.selected"
				label="Mở CRM Lead"
				iconLeft="users"
				@click="router.push({ name: 'Lead', params: { leadId: store.selected } })"
		/></template>
	</LayoutHeader>
	<section class="bm-native" aria-label="BeautyMatch CRM" data-testid="beautymatch-native">
		<nav class="bm-native-tabs" aria-label="Các màn hình BeautyMatch">
			<RouterLink
				v-for="[key, label] in tabs"
				:key="key"
				:to="to(key)"
				:aria-current="
					section === key || (key === 'consultation' && section === 'result')
						? 'page'
						: undefined
				"
				>{{ label }}</RouterLink
			>
		</nav>
		<div v-if="!nativeAccess.allowed" class="bm-native-state" role="alert">
			<h1>Chưa có quyền truy cập BeautyMatch</h1>
			<p>
				Cần vai trò tư vấn và quyền đọc CRM Lead. Các quyền nghiệp vụ tiếp tục được kiểm
				tra tại backend.
			</p>
			<Button label="Trở lại Leads" @click="router.push({ name: 'Leads' })" />
		</div>
		<component :is="view" v-else :key="section" />
	</section>
</template>
