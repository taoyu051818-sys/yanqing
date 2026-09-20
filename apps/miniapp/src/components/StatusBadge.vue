<script setup lang="ts">
import { statusLabel, type StatusDomain } from '../config/status-labels'
const props = defineProps<{ value?: string; label?: string; domain?: StatusDomain }>()
</script>

<template><text class="badge" :class="(props.value || '').toLowerCase()">{{ props.label || statusLabel(props.value, props.domain) }}</text></template>

<style scoped>
.badge { display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; max-width: 100%; min-height:40rpx; padding: 6rpx 14rpx; overflow:hidden; color: #456052; background: #eef2ef; border:1rpx solid rgba(69,96,82,.08); border-radius: 999rpx; font-size: 22rpx; line-height: 1.35; text-align: center; text-overflow:ellipsis; white-space: nowrap; }
.paid,.confirmed,.active,.completed,.checked_in,.redeemed { color: #17653d; background: #e5f3e9; }
.pending_payment,.pending,.refunding,.refund_pending,.requested,.reviewing { color: #9b6300; background: #fff2d6; }
.cancelled,.refunded,.failed,.rejected,.dismissed,.void { color: #8a3636; background: #fbeaea; }
</style>
