<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
defineProps<{ title: string; busy?: boolean }>()
const emit = defineEmits<{ (e:'close'):void }>()
const dialog = ref<HTMLDialogElement>()
let previous: HTMLElement | null = null
onMounted(() => { previous = document.activeElement as HTMLElement; dialog.value?.showModal() })
onUnmounted(() => previous?.focus())
</script>
<template><dialog ref="dialog" class="panel" @cancel.prevent="!busy && emit('close')"><header><h2>{{ title }}</h2><button type="button" class="quiet" :disabled="busy" aria-label="关闭详情" @click="emit('close')">关闭</button></header><div class="panel-content"><slot /></div></dialog></template>
