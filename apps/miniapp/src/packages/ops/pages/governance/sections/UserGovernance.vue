<script setup lang="ts">
import { toRefs, computed } from "vue";
import SectionEmpty from "../../../../../components/SectionEmpty.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import type { GovernanceTab } from "../../../config/governance";
import type { AppRole } from "../../../../../types/domain";

const props = defineProps<{
  userPage: number;
  userTotal: number;
  loading: boolean;
  changeUserPage: (delta: number) => Promise<void>;
  detailMode?: boolean;
  activeTab: GovernanceTab;
  userKeyword: string;
  loadCurrentTab: () => Promise<void>;
  users: any[];
  selectedUserId: string;
  selectUser: (user: any) => void;
  roleLabel: (role: string) => string;
  selectedUser: any;
  roleOptions: { value: AppRole; label: string }[];
  selectedRoles: AppRole[];
  toggleRole: (role: AppRole) => void;
  availablePrimaryRoles: { value: AppRole; label: string }[];
  onPrimaryRoleChange: (event: any) => void;
  primaryRole: AppRole;
  merchantChoices: any[];
  merchantId: string;
  roleReason: string;
  canSuperviseUsers: boolean;
  acting: string;
  saveRoles: () => Promise<void>;
  changeUserStatus: (status: "ACTIVE" | "DISABLED") => Promise<void>;
}>();
const emit = defineEmits<{
  (event: "update:userKeyword", value: string): void;
  (event: "update:merchantId", value: string): void;
  (event: "update:roleReason", value: string): void;
}>();
const {
  activeTab,
  loadCurrentTab,
  users,
  selectedUserId,
  selectUser,
  roleLabel,
  selectedUser,
  roleOptions,
  selectedRoles,
  toggleRole,
  availablePrimaryRoles,
  onPrimaryRoleChange,
  primaryRole,
  merchantChoices,
  canSuperviseUsers,
  acting,
  saveRoles,
  changeUserStatus,
} = toRefs(props);
const userKeyword = computed({
  get: () => props.userKeyword,
  set: (value) => emit("update:userKeyword", value),
});
const merchantId = computed({
  get: () => props.merchantId,
  set: (value) => emit("update:merchantId", value),
});
const roleReason = computed({
  get: () => props.roleReason,
  set: (value) => emit("update:roleReason", value),
});
</script>

<template>
  <view>
    <template v-if="activeTab === 'users'">
      <view v-if="!detailMode" class="card toolbar"
        ><input v-model="userKeyword" placeholder="姓名或手机号" confirm-type="search" @confirm="loadCurrentTab" /><button
          size="mini"
          :disabled="loading"
          @tap="loadCurrentTab"
        >
          查询
        </button></view
      >
      <SectionEmpty
        v-if="!users.length && !detailMode"
        title="没有组织用户"
        description="首次微信登录后会生成会员账户，超级管理员可在此授予岗位角色。"
      />
      <view class="split">
        <view v-if="!detailMode" class="list">
          <view
            v-for="user in users"
            :key="user.id"
            class="card row-card"
            role="button"
            tabindex="0"
            @keyup.enter="selectUser(user)"
            :class="{ selected: user.id === selectedUserId }"
            @tap="selectUser(user)"
          >
            <view
              ><text class="strong">{{ user.displayName }}</text
              ><text class="muted small"
                >{{ user.phone || "未登记手机号" }} ·
                {{ roleLabel(user.primaryRole) }}</text
              ></view
            >
            <view class="right"
              ><StatusBadge :value="user.status" /><text class="detail-link">查看权限 ›</text><text
                class="wechat"
                :class="{ bound: user.wechatBound }"
                >{{ user.wechatBound ? "微信已绑定" : "微信未绑定" }}</text
              ></view
            >
          </view>
        </view>
        <view v-if="!detailMode && userTotal" class="pagination"><button :disabled="loading || userPage <= 1" @tap="changeUserPage(-1)">上一页</button><text>{{ userPage }} / {{ Math.ceil(userTotal / 20) }} · {{ userTotal }}人</text><button :disabled="loading || userPage * 20 >= userTotal" @tap="changeUserPage(1)">下一页</button></view>
        <view v-if="detailMode && selectedUser" class="card editor">
          <text class="section-title"
            >{{ selectedUser.displayName }} · 岗位配置</text
          >
          <text class="muted small"
            >为该人员选择岗位和主角色，填写变更原因后保存。</text
          >
          <view class="chips"
            ><text
              v-for="option in roleOptions"
              :key="option.value"
              class="chip"
              :class="{ on: selectedRoles.includes(option.value) }"
              @tap="!acting && toggleRole(option.value)"
              >{{ option.label }}</text
            ></view
          >
          <picker
            :disabled="!canSuperviseUsers || Boolean(acting)"
            :value="availablePrimaryRoles.findIndex(item => item.value === primaryRole)"
            :range="availablePrimaryRoles"
            range-key="label"
            @change="onPrimaryRoleChange"
            ><view class="field"
              >主角色：{{ roleLabel(primaryRole) }} ›</view
            ></picker
          >
          <picker
            v-if="selectedRoles.includes('MERCHANT')"
            :disabled="!canSuperviseUsers || Boolean(acting)"
            :range="merchantChoices"
            range-key="name"
            @change="
              merchantId =
                merchantChoices[Number(($event as any).detail.value)]?.id || ''
            "
          >
            <view class="field"
              >关联商户（必选）：{{
                merchantChoices.find((item) => item.id === merchantId)?.name ||
                "请选择在营商户"
              }}</view
            >
          </picker>
          <text class="small">变更原因</text>
          <textarea
            v-model="roleReason"
            :disabled="!canSuperviseUsers || Boolean(acting)"
            class="textarea"
            maxlength="200"
            placeholder="角色或状态变更原因（必填）"
          />
          <view v-if="canSuperviseUsers" class="actions"
            ><button
              class="primary"
              :disabled="Boolean(acting)"
              :loading="acting === `roles:${selectedUser.id}`"
              @tap="saveRoles"
            >
              保存角色</button
            ><button
              v-if="selectedUser.status === 'ACTIVE'"
              class="danger"
              :disabled="Boolean(acting)"
              @tap="changeUserStatus('DISABLED')"
            >
              停用</button
            ><button v-else :disabled="Boolean(acting)" @tap="changeUserStatus('ACTIVE')">
              启用
            </button></view
          >
          <text v-else class="notice"
            >管理员可查看；只有超级管理员可变更角色和状态。</text
          >
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
<style scoped>

.editor { margin-bottom:calc(150rpx + env(safe-area-inset-bottom)); }
.editor .actions { position:fixed; bottom:0; left:0; right:0; z-index:30; padding:20rpx 28rpx calc(20rpx + env(safe-area-inset-bottom)); background:#fff; border-top:1rpx solid #dce7de; margin:0; }
.editor .actions button { min-height:88rpx; flex:1; margin:0; }
.detail-link { display:block; color:#17653d; font-size:23rpx; margin:6rpx 0; }


.pagination { display:flex; align-items:center; justify-content:space-between; gap:12rpx; font-size:24rpx; }
.pagination button { margin:0; font-size:24rpx; min-height:88rpx; }


.chip { min-width:88rpx; min-height:88rpx; box-sizing:border-box; display:flex; align-items:center; justify-content:center; }
</style>
