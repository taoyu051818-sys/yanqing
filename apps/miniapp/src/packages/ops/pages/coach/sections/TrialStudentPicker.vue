<script setup lang="ts">
import { computed, ref } from 'vue';
import ActionDialog from '../../../../../components/ActionDialog.vue';
import BookingMemberPicker from '../../../../../components/BookingMemberPicker.vue';
import type { MemberDirectoryItem } from '../../../../../types/domain';
import type { TrainingStudentSummary } from '../../../../../types/training-operations';
import { useTrialStudentRegistration } from '../forms/trial-student-registration';
const props = defineProps<{ students: TrainingStudentSummary[] }>();
const emit = defineEmits<{
  (event: 'select', student: TrainingStudentSummary): void;
  (event: 'close'): void;
}>();
const keyword = ref(''), creating = ref(false), choosingGuardian = ref(false);
const form = useTrialStudentRegistration(student => emit('select', student));
const { name, guardian, consent, busy, error, save } = form;
const matches = computed(() => props.students.filter(student =>
  student.displayName.includes(keyword.value.trim()) || student.guardian?.displayName.includes(keyword.value.trim()),
));
function startCreate() { name.value = keyword.value.trim(); creating.value = true; }
function selectGuardian(member: MemberDirectoryItem) { guardian.value = member; consent.value = false; choosingGuardian.value = false; }
</script>
<template>
  <BookingMemberPicker v-if="choosingGuardian" title="选择学员监护人" note="学员档案将关联这位监护人的会员账号。" @select="selectGuardian" @close="choosingGuardian = false" />
  <ActionDialog v-else :title="creating ? '新增试听学员' : '选择试听学员'" :busy="busy" @close="emit('close')">
    <view v-if="!creating" class="student-picker">
      <input v-model="keyword" class="input" placeholder="输入学员或监护人姓名" aria-label="搜索学员姓名" maxlength="40" :adjust-position="false" />
      <text class="note">同名学员请核对监护人。</text>
      <button v-for="student in matches" :key="student.id" class="student-option" :disabled="student.guardianConsentStatus === false" @tap="emit('select', student)">
        <text>{{ student.displayName }}</text>
        <text class="note">监护人：{{ student.guardian?.displayName || '未填写' }} · {{ student.guardianConsentStatus === false ? '待监护人授权' : '选择' }}</text>
      </button>
      <text v-if="!matches.length" class="note empty">未找到学员，可直接新增档案。</text>
    </view>
    <view v-else class="student-picker">
      <text class="field-label">学员姓名</text>
      <input v-model="name" class="input" placeholder="请输入学员姓名" aria-label="学员姓名" maxlength="40" :disabled="busy" :adjust-position="false" />
      <text class="field-label">监护人</text>
      <button class="secondary guardian" :disabled="busy" @tap="choosingGuardian = true">{{ guardian?.displayName || '选择监护人会员' }} ›</button>
      <view class="consent"><text>已确认监护人同意建档和预约试听</text><switch :checked="consent" :disabled="busy" color="#17653d" @change="consent = ($event as any).detail.value" /></view>
      <text v-if="error" class="form-error" role="alert">{{ error }}</text>
    </view>
    <template #footer>
      <view class="actions">
        <button class="secondary" :disabled="busy" @tap="creating ? (creating = false) : emit('close')">{{ creating ? '返回选择' : '取消' }}</button>
        <button v-if="!creating" class="primary" @tap="startCreate">新增学员</button>
        <button v-else class="primary" :loading="busy" :disabled="busy" @tap="save">保存并选择</button>
      </view>
    </template>
  </ActionDialog>
</template>
<style scoped>
.student-picker{min-width:0}.input{width:100%;box-sizing:border-box;min-height:48px;padding:20rpx;background:var(--color-surface-subtle);border-radius:16rpx;color:var(--color-foreground);font-size:28rpx}.note{display:block;font-size:24rpx;color:var(--color-muted);line-height:1.6;margin-top:12rpx;white-space:normal}.student-option{width:100%;text-align:left;white-space:normal;margin:0;padding:24rpx 0;background:transparent;border-radius:0;border-bottom:1rpx solid var(--color-border);font-size:30rpx;line-height:1.5;color:var(--color-foreground)}.field-label{display:block;font-size:28rpx;font-weight:600;margin:20rpx 0 12rpx}.guardian{width:100%;min-height:48px;margin:0}.consent{display:flex;align-items:center;gap:16rpx;margin:28rpx 0;font-size:26rpx;line-height:1.6}.consent text{flex:1}.consent switch{flex-shrink:0}.form-error{display:block;color:var(--color-danger);font-size:26rpx;line-height:1.6}.actions{display:flex;gap:16rpx}.actions button{flex:1;min-width:0;min-height:48px;margin:0;padding:16rpx;font-size:28rpx;line-height:1.6}.empty{padding:28rpx 0}
</style>
