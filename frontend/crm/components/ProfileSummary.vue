<script setup>
import { skinTypes, concerns, categories, money } from "../domain.mjs";
defineProps({ profile: { type: Object, default: () => ({}) } });
</script>
<template>
	<dl v-if="profile.skin_type" class="bm-native-profile">
		<div>
			<dt>Loại da</dt>
			<dd>{{ skinTypes[profile.skin_type] || profile.skin_type }}</dd>
		</div>
		<div>
			<dt>Vấn đề da</dt>
			<dd>
				{{
					Object.entries(concerns)
						.filter(([key]) => profile[key])
						.map(([, label]) => label)
						.join(" · ")
				}}
			</dd>
		</div>
		<div>
			<dt>Độ nhạy cảm</dt>
			<dd>
				{{
					profile.sensitivity === "Sensitive" ? "Da nhạy cảm" : "Không đặc biệt nhạy cảm"
				}}
			</dd>
		</div>
		<div>
			<dt>Danh mục / ngân sách</dt>
			<dd>{{ categories[profile.requested_category] }} · {{ money(profile.max_budget) }}</dd>
		</div>
	</dl>
</template>
