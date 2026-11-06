<script setup>
import { onMounted, ref, computed } from "vue";
import { Button } from "frappe-ui";
import { careCall } from "../care-api.mjs";
import StatePanel from "../components/StatePanel.vue";
import { useBeautyMatch } from "../store.mjs";
import { number } from "../domain.mjs";
import { buildConcernSegments } from "../../../beautymatch/public/js/dashboard-view.mjs";
const store = useBeautyMatch();
const care = ref(null);
const careLabels = {
	contact_requests: "Yêu cầu liên hệ",
	pending_requests: "Chờ chăm sóc",
	open_tasks: "Công việc đang xử lý",
	completed_tasks: "Công việc hoàn thành",
	calls: "Cuộc gọi đã ghi nhận",
	callback_customers: "Khách cần liên hệ lại",
};
const data = ref(null),
	loading = ref(true),
	error = ref("");
const metrics = [
	["total_sessions", "Phiên tư vấn", ""],
	["leads_with_profile", "Khách hàng có hồ sơ da", ""],
	["interest_rate", "Tỷ lệ quan tâm", "%"],
	["average_top1_score", "Điểm phù hợp Top 1 trung bình", "%"],
];
const concerns = computed(() => buildConcernSegments(data.value?.charts.top_skin_concerns || []));
const products = computed(() => data.value?.charts.top_interested_products || []);
const maxCount = computed(() =>
	Math.max(1, ...products.value.map((row) => Number(row.count) || 0)),
);
const chartColor = (color) => `color-mix(in srgb, ${color}, #f7f6f0 var(--bm-chart-lift, 0%))`;
async function load() {
	loading.value = true;
	error.value = "";
	try {
		const values = await Promise.all([store.api.dashboard(), careCall("care_metrics")]);
		data.value = values[0];
		care.value = values[1];
	} catch (e) {
		error.value = e.message;
	} finally {
		loading.value = false;
	}
}
onMounted(load);
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">BÁO CÁO TƯ VẤN</p>
			<h1>Phân tích BeautyMatch</h1>
			<p>Toàn bộ thời gian · Dữ liệu thuộc các CRM Lead bạn có quyền truy cập.</p>
		</div>
		<Button label="Cập nhật báo cáo" iconLeft="refresh-cw" :loading="loading" @click="load" />
	</div>
	<StatePanel v-if="loading || error" :loading="loading" :error="error" @retry="load" />
	<template v-else-if="data"
		><div class="bm-native-kpis">
			<article v-for="[key, label, suffix] in metrics" :key="key" :data-metric="key">
				<span>{{ label }}</span
				><strong>{{ number(data.kpis[key]) }}{{ suffix }}</strong>
			</article>
		</div>
		<section v-if="care" class="bm-native-panel">
			<h2>Chăm sóc sau tư vấn</h2>
			<p>
				Dữ liệu công việc và Call Logs riêng biệt với lượt Quan tâm. Có
				{{ care.demo_calls }} cuộc gọi gắn nhãn DEMO.
			</p>
			<div class="bm-native-kpis">
				<article v-for="(label, key) in careLabels" :key="key" :data-care-metric="key">
					<span>{{ label }}</span
					><strong>{{ number(care[key]) }}</strong>
				</article>
			</div>
		</section>
		<div class="bm-native-charts">
			<section class="bm-native-panel">
				<h2>Vấn đề da phổ biến</h2>
				<p class="bm-native-help">Tỷ trọng tính trên tổng lượt ghi nhận vấn đề da.</p>
				<div v-if="concerns.total" class="bm-native-concern-layout">
					<svg
						viewBox="0 0 160 160"
						role="img"
						:aria-label="`${concerns.total} lượt ghi nhận vấn đề da`"
					>
						<circle
							cx="80"
							cy="80"
							r="59"
							fill="none"
							stroke="var(--surface-gray-2)"
							stroke-width="22"
						/>
						<circle
							v-for="item in concerns.items"
							:key="item.label"
							cx="80"
							cy="80"
							r="59"
							fill="none"
							:stroke="chartColor(item.color)"
							stroke-width="22"
							pathLength="100"
							:stroke-dasharray="`${item.share} ${100 - item.share}`"
							:stroke-dashoffset="-item.offset"
							transform="rotate(-90 80 80)"
						>
							<title>{{ item.label }}: {{ item.count }} lượt</title>
						</circle>
						<text
							x="80"
							y="85"
							text-anchor="middle"
							fill="currentColor"
							font-size="24"
						>
							{{ concerns.total }}
						</text>
					</svg>
					<ul>
						<li v-for="item in concerns.items" :key="item.label">
							<i
								:style="{ background: chartColor(item.color) }"
								aria-hidden="true"
							/><span>{{ item.label }}</span
							><strong>{{ number(item.share) }}%</strong>
						</li>
					</ul>
				</div>
				<p v-else>Chưa có dữ liệu vấn đề da.</p>
				<details>
					<summary>Xem bảng dữ liệu</summary>
					<table>
						<caption class="bm-native-sr-only">
							Lượt ghi nhận vấn đề da
						</caption>
						<thead>
							<tr>
								<th>Vấn đề da</th>
								<th>Số lượt</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="item in concerns.items" :key="item.label">
								<th>{{ item.label }}</th>
								<td>{{ item.count }}</td>
							</tr>
						</tbody>
					</table>
				</details>
			</section>
			<section class="bm-native-panel">
				<h2>Sản phẩm được quan tâm nhiều nhất</h2>
				<div v-if="products.length" class="bm-native-bars">
					<div v-for="item in products" :key="item.product_name">
						<div>
							<span>{{ item.product_name }}</span
							><strong>{{ item.count }}</strong>
						</div>
						<meter
							min="0"
							:max="maxCount"
							:value="item.count"
							:aria-label="`${item.product_name}: ${item.count} lượt quan tâm`"
						/>
					</div>
				</div>
				<p v-else>Chưa có sản phẩm được đánh dấu quan tâm.</p>
				<details>
					<summary>Xem bảng dữ liệu</summary>
					<table>
						<caption class="bm-native-sr-only">
							Sản phẩm được quan tâm
						</caption>
						<thead>
							<tr>
								<th>Sản phẩm</th>
								<th>Số lượt</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="item in products" :key="item.product_name">
								<th>{{ item.product_name }}</th>
								<td>{{ item.count }}</td>
							</tr>
						</tbody>
					</table>
				</details>
			</section>
		</div></template
	>
</template>
