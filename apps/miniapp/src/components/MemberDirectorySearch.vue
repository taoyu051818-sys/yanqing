<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { captureAuthSession, isAuthSessionCurrent } from "../services/auth-session";
import { endpoints } from "../services/api";
import type { MemberDirectoryItem } from "../types/domain";
const props = withDefaults(
  defineProps<{ note?: string; pageSize?: number }>(),
  { note: "请核对姓名和手机号，订单将归属所选会员。", pageSize: 20 },
);
const emit = defineEmits<{
  (event: "select", member: MemberDirectoryItem): void;
  (event: "close"): void;
  (event: "update:keyword", value: string): void;
}>();
const keyword = ref(""),
  items = ref<MemberDirectoryItem[]>([]),
  total = ref(0),
  page = ref(1);
const loading = ref(false),
  error = ref("");
let sequence = 0;
async function search(more = false) {
  clearTimeout(timer);
  if (more && loading.value) return;
  const owner = captureAuthSession();
  const run = ++sequence,
    nextPage = more ? page.value + 1 : 1;
  loading.value = true;
  error.value = "";
  if (!more) items.value = [];
  try {
    const result = await endpoints.members({
      keyword: keyword.value.trim(),
      page: nextPage,
      pageSize: props.pageSize,
    });
    if (run !== sequence || !isAuthSessionCurrent(owner)) return;
    items.value = more ? [...items.value, ...result.items] : result.items;
    page.value = nextPage;
    total.value = result.total;
  } catch (cause: any) {
    if (run === sequence) error.value = cause.message || "会员查询失败，请重试";
  } finally {
    if (run === sequence) loading.value = false;
  }
}
onMounted(() => search());
let timer: ReturnType<typeof setTimeout> | undefined;
watch(keyword, () => {
  emit("update:keyword", keyword.value);
  sequence++;
  items.value = [];
  error.value = "";
  loading.value = false;
  clearTimeout(timer);
  timer = setTimeout(() => search(), 250);
});
onUnmounted(() => {
  sequence++;
  clearTimeout(timer);
});
</script>

<template>
  <view class="member-directory">
    <text class="sheet-note">{{ note }}</text>
    <view class="member-search"
      ><input
        v-model="keyword"
        class="input"
        placeholder="搜索姓名或手机号"
        aria-label="会员姓名或手机号"
        maxlength="50"
        confirm-type="search"
        :adjust-position="false"
        @confirm="search()"
      /><button class="secondary" :disabled="loading" @tap="search()">
        搜索
      </button></view
    >
    <view class="member-results">
      <button
        v-for="member in items"
        :key="member.id"
        class="member-option"
        :disabled="Boolean(member.status && member.status !== 'ACTIVE')"
        @tap="emit('select', member)"
      >
        <view
          ><text class="member-name">{{ member.displayName }}</text
          ><text class="sheet-note"
            >{{ member.phone || "未绑定手机号" }} · 编号尾号
            {{ member.id.slice(-6) }}</text
          ></view
        ><text class="select-label">{{
          member.status && member.status !== "ACTIVE" ? "已停用" : "选择"
        }}</text>
      </button>
      <view v-if="error" class="member-feedback" role="alert"
        ><text>{{ error }}</text
        ><button class="secondary" @tap="search()">重试</button></view
      >
      <text v-else-if="loading" class="member-feedback" role="status"
        >正在查询会员…</text
      >
      <text v-else-if="!items.length" class="member-feedback"
        >没有找到会员，请换个姓名或手机号搜索。</text
      >
      <button
        v-if="items.length < total"
        class="secondary more"
        :disabled="loading"
        @tap="search(true)"
      >
        查看更多会员
      </button>
    </view>
  </view>
</template>

<style scoped>
.sheet-note {
  display: block;
  color: #5f6f65;
  font-size: 24rpx;
  line-height: 1.6;
}
.member-search {
  display: flex;
  gap: 16rpx;
  margin: 24rpx 0;
}
.member-search input {
  flex: 1;
  min-width: 0;
}
.member-search button {
  margin: 0;
  flex-shrink: 0;
}
.member-results {
  min-height: 120rpx;
}
.member-option {
  display: flex;
  justify-content: space-between;
  width: 100%;
  margin: 0;
  padding: 24rpx 8rpx;
  text-align: left;
  background: #fff;
  border-bottom: 1rpx solid #e5ebe6;
  border-radius: 0;
  gap: 16rpx;
}
.member-option > view {
  flex: 1;
  min-width: 0;
}
.member-name {
  display: block;
  font-size: 30rpx;
  font-weight: 700;
  overflow-wrap: anywhere;
}
.select-label {
  font-size: 26rpx;
  color: #17653d;
  flex-shrink: 0;
}
.member-feedback {
  display: block;
  padding: 30rpx 0;
  color: #5f6f65;
  font-size: 26rpx;
}
.member-feedback button {
  margin-top: 20rpx;
}
.more {
  margin: 20rpx 0;
}
</style>
