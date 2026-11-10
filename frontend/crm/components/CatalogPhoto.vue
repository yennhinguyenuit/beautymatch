<script setup>
import { computed, ref, watch } from "vue";
import { safeUrl } from "../domain.mjs";
import { catalogImage, catalogCrop } from "../../../beautymatch/public/js/catalog-images.mjs";

const props = defineProps({ source: String, alt: String });
const failed = ref(false);
watch(
	() => props.source,
	() => {
		failed.value = false;
	},
);
const source = computed(() => safeUrl(props.source));
const crop = computed(() => catalogCrop(source.value));
const style = computed(() => {
	const c = crop.value;
	return c
		? {
				aspectRatio: `${c.width}/${c.height}`,
				"--image-width": `${(1200 / c.width) * 100}%`,
				"--image-height": `${(630 / c.height) * 100}%`,
				"--image-x": `${(-c.x / c.width) * 100}%`,
				"--image-y": `${(-c.y / c.height) * 100}%`,
			}
		: null;
});
</script>
<template>
	<div
		v-if="source && !failed"
		class="bm-native-catalog-photo"
		:class="{ 'has-crop': crop }"
		:style="style"
	>
		<img
			:src="catalogImage(source)"
			:alt="alt"
			loading="lazy"
			decoding="async"
			referrerpolicy="no-referrer"
			@error="failed = true"
		/>
	</div>
	<div v-else class="bm-native-photo-fallback">
		<span aria-hidden="true">◇</span>
		<p>Chưa có ảnh catalog</p>
	</div>
</template>
<style scoped>
.bm-native-catalog-photo {
	position: relative;
	width: 100%;
	height: 172px;
	overflow: hidden;
}
.bm-native-catalog-photo.has-crop {
	width: auto;
}
.bm-native-catalog-photo.has-crop img {
	position: absolute;
	width: var(--image-width);
	height: var(--image-height);
	max-width: none;
	max-height: none;
	left: var(--image-x);
	top: var(--image-y);
	object-fit: fill;
}
</style>
