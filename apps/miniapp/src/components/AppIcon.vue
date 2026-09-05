<script setup lang="ts">
import { computed } from 'vue'

export type AppIconTone = 'primary' | 'muted' | 'inverse' | 'accent' | 'danger'

const props = withDefaults(defineProps<{
  name: string
  size?: number
  tone?: AppIconTone
  label?: string
  decorative?: boolean
}>(), {
  size: 36,
  tone: 'primary',
  label: '',
  decorative: true,
})

const source = computed(() => `/static/icons/lucide/${props.name}-${props.tone}.svg`)
const dimensions = computed(() => ({
  width: `${props.size}rpx`,
  height: `${props.size}rpx`,
}))
</script>

<template>
  <image
    class="app-icon"
    :src="source"
    mode="aspectFit"
    :style="dimensions"
    :alt="props.decorative ? '' : (props.label || props.name)"
    :aria-hidden="props.decorative ? 'true' : undefined"
    :aria-label="props.decorative ? undefined : (props.label || props.name)"
  />
</template>

<style scoped>
.app-icon {
  display: block;
  flex: 0 0 auto;
}
</style>
