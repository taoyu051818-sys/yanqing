<script setup lang="ts">
import { toRefs, computed, ref, watch, nextTick } from "vue";
import BusinessSection from "../../../components/BusinessSection.vue";
import InfoRow from "../../../components/InfoRow.vue";
import SectionEmpty from "../../../../../components/SectionEmpty.vue";
import StatusBadge from "../../../../../components/StatusBadge.vue";
import type { GovernanceTab } from "../../../config/governance";
import type { AppRole } from "../../../../../types/domain";

const props = defineProps<{
  resetEditor: () => void;
  userRole: string;
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
  (event: "update:userRole", value: string): void;
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
const editing = ref<'roles' | 'status' | null>(null);
function beginEdit(mode: 'roles' | 'status') { props.resetEditor(); editing.value = mode; void nextTick(() => uni.pageScrollTo({ scrollTop:0, duration:0 })); }
function cancelEdit() { if (!props.acting) { props.resetEditor(); editing.value = null; } }
watch(() => props.selectedUser, () => { editing.value = null; });
const storedRoles = computed(() => [...new Set([props.selectedUser?.primaryRole, ...(props.selectedUser?.roles || []).map((item: any) => typeof item === 'string' ? item : item.role)])].filter(Boolean).map(props.roleLabel).join('、'));
const filterRoles = computed(() => [{ value:'', label:'全部岗位' }, ...props.roleOptions]);
function filterChanged(event: any) { emit('update:userRole', filterRoles.value[Number(event.detail.value)].value); props.loadCurrentTab(); }
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
      <view v-if="!detailMode" class="list-filterbar"><text>共 {{ userTotal }} 位人员</text><picker :range="filterRoles" range-key="label" :value="filterRoles.findIndex(item => item.value === userRole)" @change="filterChanged"><view class="role-filter">{{ filterRoles.find(item => item.value === userRole)?.label || '全部岗位' }} ▾</view></picker></view>
      <SectionEmpty
        v-if="!users.length && !detailMode"
        title="没有匹配的人员"
        description="首次微信登录后会生成会员账户，超级管理员可在此授予岗位角色。"
      />
      <view class="split">
        <view v-if="!detailMode" class="list business-list">
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
        <template v-if="detailMode && selectedUser && !editing">
          <BusinessSection title="人员信息"><InfoRow label="姓名" :value="selectedUser.displayName" /><InfoRow label="联系电话" :value="selectedUser.phone" /><InfoRow label="微信绑定" :value="selectedUser.wechatBound ? '已绑定' : '未绑定'" /></BusinessSection>
          <BusinessSection title="岗位权限" :action="canSuperviseUsers ? '修改岗位' : undefined" @action="beginEdit('roles')"><InfoRow label="主角色" :value="roleLabel(selectedUser.primaryRole)" /><InfoRow label="可用岗位" :value="storedRoles" /></BusinessSection>
          <BusinessSection title="账号状态" :action="canSuperviseUsers ? '修改状态' : undefined" @action="beginEdit('status')"><InfoRow label="当前状态"><StatusBadge :value="selectedUser.status" /></InfoRow></BusinessSection>
        </template>
        <view v-if="detailMode && selectedUser && editing" class="card editor">
          <text class="section-title">{{ editing === 'roles' ? '修改岗位权限' : '修改账号状态' }}</text>
          <text class="muted small">{{ selectedUser.displayName }}</text>
          <template v-if="editing === 'roles'">
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
          </template>
          <text v-else class="status-description">{{ selectedUser.status === 'ACTIVE' ? '停用后，该账号将无法登录。' : '启用后，该账号可恢复登录。' }}</text>
          <text class="small">变更原因</text>
          <textarea
            v-model="roleReason"
            :disabled="!canSuperviseUsers || Boolean(acting)"
            class="textarea"
            maxlength="200"
            placeholder="角色或状态变更原因（必填）"
          />
          <view v-if="canSuperviseUsers" class="actions"><button class="secondary" :disabled="Boolean(acting)" @tap="cancelEdit">取消</button><button v-if="editing === 'roles'" class="primary" :loading="Boolean(acting)" :disabled="Boolean(acting)" @tap="saveRoles">保存角色</button><button v-else :class="selectedUser.status === 'ACTIVE' ? 'danger' : 'primary'" :disabled="Boolean(acting)" :loading="Boolean(acting)" @tap="changeUserStatus(selectedUser.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE')">{{ selectedUser.status === 'ACTIVE' ? '确认停用' : '确认启用' }}</button></view>
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
<style scoped>
.split { gap:0; }
.business-list { display:block; background:#fff; border-radius:16rpx; overflow:hidden; }
.business-list .row-card { border:0; border-bottom:1rpx solid #edf0f2; margin:0; border-radius:0; box-shadow:none; padding:28rpx 24rpx; }
.business-list .wechat { display:none; }.business-list .strong { font-size:30rpx; }.business-list .small { font-size:25rpx; }
.toolbar { margin:16rpx 0 24rpx; padding:8rpx 20rpx; box-shadow:none; border-radius:16rpx; }
.toolbar input { height:88rpx; font-size:28rpx; }.toolbar button { background:transparent; color:#17653d; padding:0 12rpx; font-size:26rpx; }
.role-filter { min-height:88rpx; display:flex; align-items:center; font-size:25rpx; color:#555e65; }
.editor { display:grid; gap:22rpx; box-shadow:none; }.editor .section-title { margin:0; font-size:30rpx; }.editor .small { font-size:26rpx; }
.status-description { font-size:28rpx; color:#687079; line-height:1.6; }
</style>
<style scoped>
.toolbar { flex-direction:row; align-items:center; gap:12rpx; padding:0 22rpx; margin-bottom:0; }
.toolbar input { flex:1; width:0; min-width:0; }.toolbar button { width:auto; flex:0 0 auto; margin:0; min-width:72rpx; }.toolbar button::after { border:0; }
.list-filterbar { display:flex; align-items:center; justify-content:space-between; padding:4rpx 8rpx; color:#727982; font-size:26rpx; }
</style>
