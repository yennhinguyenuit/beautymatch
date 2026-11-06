<script setup>
import { onMounted, onUnmounted, ref, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Button } from "frappe-ui";
import StatePanel from "../components/StatePanel.vue";
import ProfileSummary from "../components/ProfileSummary.vue";
import { useBeautyMatch } from "../store.mjs";
import { categories, money, number, date } from "../domain.mjs";
import { openNativeTask } from "../integration.mjs";
import { latestRequest } from "../latest-request.mjs";
const store = useBeautyMatch(),
	router = useRouter(),
	route = useRoute();
const data = ref(null),
	loading = ref(false),
	error = ref(""),
	start = ref(0);
const feedbackOnly = ref(route.params.section === "feedback");
const sessions = computed(() => data.value?.history.sessions || []);
const next = latestRequest();
onUnmounted(next);
watch(feedbackOnly, () => load(0));
async function load(offset = 0) {
	store.syncSelection();
	if (!store.selected) return;
	const current = next();
	data.value = null;
	loading.value = true;
	error.value = "";
	try {
		const reply = await store.api.customerView(store.selected, offset, feedbackOnly.value);
		if (current()) {
			data.value = reply;
			start.value = offset;
		}
	} catch (e) {
		if (current()) error.value = e.message;
	} finally {
		if (current()) loading.value = false;
	}
}
function open(session) {
	store.openSession({ ...session, crm_lead: store.selected });
	router.push({ name: "BeautyMatch", params: { section: "result" } });
}
const follow = (session, item) => session.follow_ups?.find((row) => row.item_id === item.item_id);
onMounted(() => load());
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">CHĂM SÓC KHÁCH HÀNG</p>
			<h1>{{ feedbackOnly ? "Phản hồi khách hàng" : "Hồ sơ & lịch sử tư vấn" }}</h1>
			<p>{{ data?.customer.full_name || "Thông tin gắn với CRM Lead được chọn." }}</p>
		</div>
		<div class="bm-native-actions">
			<Button
				label="Tư vấn mới"
				variant="solid"
				:disabled="!store.selected"
				@click="
					store.newConsultation();
					router.push({ name: 'BeautyMatch', params: { section: 'consultation' } });
				"
			/><Button
				label="Cập nhật"
				:disabled="!store.selected"
				:loading="loading"
				@click="load(start)"
			/>
		</div>
	</div>
	<StatePanel
		v-if="!store.selected"
		title="Chọn khách hàng để tiếp tục"
		text="Mở từ CRM Lead hoặc chọn khách hàng trong tổng quan BeautyMatch."
		><Button label="Chọn khách hàng" @click="router.push({ name: 'BeautyMatch' })"
	/></StatePanel>
	<StatePanel
		v-else-if="loading || error"
		:loading="loading"
		:error="error"
		@retry="load(start)"
	/>
	<template v-else-if="data">
		<label class="bm-native-filter"
			><input v-model="feedbackOnly" type="checkbox" /> Chỉ phiên có phản hồi</label
		>
		<div class="bm-native-kpis bm-native-kpis-three">
			<article>
				<span>Phiên tư vấn</span><strong>{{ number(data.summary.total_sessions) }}</strong>
			</article>
			<article>
				<span>Hồ sơ da</span><strong>{{ data.summary.beauty_profiles.length }}</strong>
			</article>
			<article>
				<span>Lượt quan tâm</span
				><strong>{{ data.summary.interested_products.length }}</strong>
			</article>
		</div>
		<ProfileSummary v-if="!feedbackOnly" :profile="data.customer.profile" />
		<section v-if="!feedbackOnly" class="bm-native-panel">
			<h2>Sản phẩm đã quan tâm</h2>
			<ul v-if="data.summary.interested_products.length" class="bm-native-interest-list">
				<li
					v-for="(item, index) in data.summary.interested_products"
					:key="`${item.item_id}-${index}`"
				>
					<strong>{{ item.product_name }}</strong
					><span>{{ number(item.final_match_score) }}% phù hợp</span>
				</li>
			</ul>
			<p v-else>Chưa có sản phẩm được đánh dấu quan tâm.</p>
		</section>
		<StatePanel
			v-if="!sessions.length"
			:title="
				feedbackOnly ? 'Chưa có phản hồi trong nhóm phiên này' : 'Chưa có lịch sử tư vấn'
			"
			text="Dữ liệu sẽ xuất hiện sau khi hoàn tất tư vấn và ghi nhận phản hồi."
		/>
		<div v-else class="bm-native-timeline">
			<article
				v-for="session in sessions"
				:key="session.session_id"
				class="bm-native-panel bm-native-session"
			>
				<div class="bm-native-section-heading">
					<div>
						<p class="bm-native-eyebrow">{{ date(session.created_at) }}</p>
						<h2>
							{{ categories[session.requested_category] }} ·
							{{ money(session.max_budget) }}
						</h2>
						<p>Phiên {{ session.session_id }} · {{ session.results.length }} gợi ý</p>
					</div>
					<Button label="Mở kết quả" @click="open(session)" />
				</div>
				<div
					v-for="item in session.results"
					:key="item.item_id"
					class="bm-native-history-product"
				>
					<div>
						<strong>{{ item.product_name }}</strong>
						<p>
							{{ number(item.final_match_score) }}% phù hợp ·
							{{
								item.customer_feedback === "Interested"
									? "Quan tâm"
									: item.customer_feedback === "Not Interested"
										? "Không quan tâm"
										: "Chưa phản hồi"
							}}
						</p>
						<span
							v-if="follow(session, item)?.follow_up_status === 'PENDING'"
							class="bm-native-status"
							>PENDING · Chờ phân công</span
						>
					</div>
					<Button
						v-if="follow(session, item)?.task"
						:label="`CRM Task · ${follow(session, item).task.status}`"
						@click="openNativeTask(String(follow(session, item).task.name))"
					/>
				</div>
				<p v-if="!session.results.length">Phiên này chưa có sản phẩm đạt điều kiện.</p>
			</article>
		</div>
		<div class="bm-native-pagination">
			<Button
				label="Mới hơn"
				:disabled="start === 0"
				@click="load(Math.max(0, start - 10))"
			/><span>{{ data.history.total }} phiên tư vấn</span
			><Button
				label="Cũ hơn"
				:disabled="start + data.history.sessions.length >= data.history.total"
				@click="load(start + 10)"
			/>
		</div>
	</template>
</template>
