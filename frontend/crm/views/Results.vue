<script setup>
import { onMounted, ref, reactive, nextTick } from "vue";
import { useRouter } from "vue-router";
import { Button, FormControl } from "frappe-ui";
import StatePanel from "../components/StatePanel.vue";
import ProfileSummary from "../components/ProfileSummary.vue";
import { useBeautyMatch } from "../store.mjs";
import { feedbackMessage } from "../../../beautymatch/public/js/api.mjs";
import { money, number, safeUrl, rejectionReasons } from "../domain.mjs";
import { openNativeTask } from "../integration.mjs";
import ContactConsent from "../components/ContactConsent.vue";
import CatalogPhoto from "../components/CatalogPhoto.vue";
const store = useBeautyMatch();
const router = useRouter();
const loading = ref(true),
	error = ref(""),
	feedbackError = ref(""),
	pending = ref("");
const rejectItem = ref(""),
	reason = ref("");
const confirmations = reactive({});
async function load() {
	loading.value = true;
	error.value = "";
	try {
		await store.loadResult();
	} catch (e) {
		error.value = e.message;
	} finally {
		loading.value = false;
	}
}
async function reject(item) {
	rejectItem.value = item.item_id;
	reason.value = "";
	feedbackError.value = "";
	await nextTick();
	document.getElementById("bm-native-rejection-reason")?.focus();
}
async function send(item, feedback) {
	if (pending.value) return;
	feedbackError.value = "";
	if (feedback === "Not Interested" && !rejectionReasons.includes(reason.value)) {
		feedbackError.value = "Chọn lý do không quan tâm trước khi gửi.";
		return;
	}
	pending.value = item.item_id;
	try {
		const reply = await store.api.feedback({
			session_id: store.result.session_id,
			item_id: item.item_id,
			customer_feedback: feedback,
			...(feedback === "Not Interested" ? { rejection_reason: reason.value } : {}),
		});
		confirmations[item.item_id] = feedbackMessage(reply);
		item.customer_feedback = reply.customer_feedback;
		rejectItem.value = "";
		try {
			store.resultContext = await store.api.context(store.result.session_id);
		} catch {
			confirmations[item.item_id].text +=
				" Thông tin CRM Task sẽ được cập nhật khi tải lại.";
		}
	} catch (e) {
		feedbackError.value = e.message;
	} finally {
		pending.value = "";
	}
}
const follow = (item) => store.resultContext?.items?.find((row) => row.item_id === item.item_id);
const ingredients = (item) =>
	store.resultContext?.products?.find((row) => row.name === item.product)?.key_ingredients;
onMounted(load);
</script>
<template>
	<div class="bm-native-intro">
		<div>
			<p class="bm-native-eyebrow">GỢI Ý ĐƯỢC LƯU TRONG CRM</p>
			<h1>Kết quả tư vấn</h1>
			<p v-if="store.result">
				Phiên {{ store.result.session_id }} · {{ store.result.results.length }} sản phẩm
			</p>
		</div>
		<Button
			label="Hồ sơ & lịch sử"
			@click="router.push({ name: 'BeautyMatch', params: { section: 'customer' } })"
		/>
	</div>
	<StatePanel v-if="loading || error" :loading="loading" :error="error" @retry="load" />
	<StatePanel
		v-else-if="!store.result"
		title="Chưa có phiên tư vấn"
		text="Chọn khách hàng và lưu hồ sơ trước khi tạo gợi ý."
		><Button
			label="Bắt đầu tư vấn"
			variant="solid"
			@click="router.push({ name: 'BeautyMatch', params: { section: 'consultation' } })"
	/></StatePanel>
	<template v-else>
		<div
			v-if="store.completionError"
			class="bm-native-warning"
			role="alert"
			data-testid="completion-warning"
		>
			<p>{{ store.completionError }}</p>
			<Button
				type="button"
				label="Thử cập nhật trạng thái yêu cầu"
				:loading="store.completionBusy"
				@click="store.retryCompletion"
			/>
		</div>
		<p
			v-else-if="store.request?.status === 'Completed'"
			class="bm-native-status"
			role="status"
		>
			Đã xử lý yêu cầu · Backend xác nhận hoàn tất.
		</p>
		<ProfileSummary :profile="store.resultContext?.profile || {}" />
		<StatePanel
			v-if="!store.result.results.length"
			title="Chưa có sản phẩm phù hợp"
			:text="store.result.result_message"
			><Button
				label="Điều chỉnh nhu cầu tư vấn"
				@click="router.push({ name: 'BeautyMatch', params: { section: 'consultation' } })"
		/></StatePanel>
		<p v-if="feedbackError" role="alert" class="bm-native-error">{{ feedbackError }}</p>
		<div class="bm-native-products">
			<article
				v-for="item in store.result.results.slice(0, 3)"
				:key="item.item_id"
				class="bm-native-product"
				:data-item-id="item.item_id"
			>
				<div class="bm-native-product-image">
					<span class="bm-native-rank">Top {{ item.rank }}</span>
					<CatalogPhoto :source="item.image_url" :alt="item.product_name" />
				</div>
				<div class="bm-native-product-content">
					<p class="bm-native-eyebrow">{{ item.brand }}</p>
					<h2>{{ item.product_name }}</h2>
					<strong class="bm-native-price">{{ money(item.price) }}</strong>
					<div class="bm-native-score">
						<label :for="`score-${item.item_id}`"
							>{{ number(item.final_match_score) }}% phù hợp</label
						><progress
							:id="`score-${item.item_id}`"
							:value="Math.max(0, Math.min(100, Number(item.final_match_score)))"
							max="100"
						/>
					</div>
					<p>{{ item.why_recommended }}</p>
					<p v-if="item.warning_partial_match" class="bm-native-warning">
						{{
							typeof item.warning_partial_match === "string"
								? item.warning_partial_match
								: "Sản phẩm chỉ đáp ứng một phần nhu cầu đã chọn."
						}}
					</p>
					<details v-if="ingredients(item)">
						<summary>Thành phần chính</summary>
						<p>{{ ingredients(item) }}</p>
					</details>
					<a
						v-if="safeUrl(item.product_url)"
						:href="safeUrl(item.product_url)"
						target="_blank"
						rel="noopener noreferrer"
						class="bm-native-catalog-link"
						>Chi tiết sản phẩm ↗</a
					>
					<p class="bm-native-help">
						Phản hồi:
						{{
							item.customer_feedback === "Interested"
								? "Quan tâm"
								: item.customer_feedback === "Not Interested"
									? "Không quan tâm"
									: "Chưa phản hồi"
						}}
					</p>
					<div class="bm-native-actions">
						<Button
							label="Quan tâm"
							:variant="item.customer_feedback === 'Interested' ? 'solid' : 'subtle'"
							:disabled="Boolean(pending)"
							@click="send(item, 'Interested')"
						/><Button
							label="Không quan tâm"
							:disabled="Boolean(pending)"
							@click="reject(item)"
						/>
					</div>
					<form
						v-if="rejectItem === item.item_id"
						class="bm-native-rejection"
						@submit.prevent="send(item, 'Not Interested')"
					>
						<FormControl
							id="bm-native-rejection-reason"
							v-model="reason"
							type="select"
							label="Lý do không quan tâm"
							:options="[
								{ label: 'Chọn lý do', value: '' },
								...rejectionReasons.map((value) => ({ label: value, value })),
							]"
							required
						/>
						<div class="bm-native-actions">
							<Button
								type="submit"
								label="Gửi phản hồi"
								:loading="Boolean(pending)"
							/><Button
								type="button"
								label="Hủy"
								:disabled="Boolean(pending)"
								@click="rejectItem = ''"
							/>
						</div>
					</form>
					<div
						v-if="confirmations[item.item_id]"
						class="bm-native-confirmation"
						role="status"
					>
						<strong>{{ confirmations[item.item_id].title }}</strong>
						<p>{{ confirmations[item.item_id].text }}</p>
					</div>
					<p
						v-else-if="follow(item)?.follow_up_status === 'PENDING'"
						class="bm-native-warning"
					>
						PENDING · Chờ phân công chăm sóc
					</p>
					<Button
						v-if="follow(item)?.task"
						:label="`Mở CRM Task · ${follow(item).task.status}`"
						iconLeft="check-square"
						@click="openNativeTask(String(follow(item).task.name))"
					/>
				</div>
			</article>
		</div>
		<ContactConsent :session="store.result" :customer="store.customer" />
	</template>
</template>
