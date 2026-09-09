<script setup lang="ts">
import { toRefs, computed } from "vue";
import SectionEmpty from "../../../../../components/SectionEmpty.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import type { GovernanceTab } from "../../../config/governance";
import type { AppRole } from "../../../../../types/domain";

const props = defineProps<{
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
      <view class="card toolbar"
        ><input v-model="userKeyword" placeholder="姓名或手机号" /><button
          size="mini"
          @tap="loadCurrentTab"
        >
          查询
        </button></view
      >
      <SectionEmpty
        v-if="!users.length"
        title="没有组织用户"
        description="首次微信登录后会生成会员账户，超级管理员可在此授予岗位角色。"
      />
      <view v-else class="split">
        <view class="list">
          <view
            v-for="user in users"
            :key="user.id"
            class="card row-card"
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
              ><StatusBadge :value="user.status" /><text
                class="wechat"
                :class="{ bound: user.wechatBound }"
                >{{ user.wechatBound ? "微信已绑定" : "微信未绑定" }}</text
              ></view
            >
          </view>
        </view>
        <view v-if="selectedUser" class="card editor">
          <text class="section-title"
            >{{ selectedUser.displayName }} · 岗位配置</text
          >
          <text class="muted small"
            >真实员工先用微信首次登录生成账户，再由超级管理员在此授权；无需直接改数据库或复制
            OpenID。</text
          >
          <view class="chips"
            ><text
              v-for="option in roleOptions"
              :key="option.value"
              class="chip"
              :class="{ on: selectedRoles.includes(option.value) }"
              @tap="toggleRole(option.value)"
              >{{ option.label }}</text
            ></view
          >
          <picker
            :range="availablePrimaryRoles"
            range-key="label"
            @change="onPrimaryRoleChange"
            ><view class="field"
              >主角色：{{ roleLabel(primaryRole) }} ›</view
            ></picker
          >
          <picker
            v-if="selectedRoles.includes('MERCHANT')"
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
          <textarea
            v-model="roleReason"
            class="textarea"
            maxlength="200"
            placeholder="角色或状态变更原因（必填）"
          />
          <view v-if="canSuperviseUsers" class="actions"
            ><button
              class="primary"
              :loading="acting === `roles:${selectedUser.id}`"
              @tap="saveRoles"
            >
              保存角色</button
            ><button
              v-if="selectedUser.status === 'ACTIVE'"
              class="danger"
              @tap="changeUserStatus('DISABLED')"
            >
              停用</button
            ><button v-else @tap="changeUserStatus('ACTIVE')">
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
