<script setup lang="ts">
import { computed, ref, watch } from "vue";
import MemberDirectorySearch from "../../../../../components/MemberDirectorySearch.vue";
import TrialStudentPicker from "./TrialStudentPicker.vue";
import type {
  TrainingLeadSummary,
  TrainingStudentSummary,
} from "../../../../../types/training-operations";
const props = defineProps<{
  students: TrainingStudentSummary[];
  leads: TrainingLeadSummary[];
}>();
const emit = defineEmits<{
  select: [kind: "member" | "student" | "lead", person: any];
}>();
const keyword = ref(""),
  creating = ref(false),
  studentCount = ref(5),
  leadCount = ref(5);
watch(keyword, () => {
  studentCount.value = 5;
  leadCount.value = 5;
});
const students = computed(() =>
  props.students.filter((person) =>
    `${person.displayName} ${person.guardian?.displayName || ""}`.includes(
      keyword.value.trim(),
    ),
  ),
);
const leads = computed(() =>
  props.leads.filter((person) =>
    person.displayName.includes(keyword.value.trim()),
  ),
);
</script>
<template>
  <view class="person-search">
    <MemberDirectorySearch
      :page-size="3"
      @update:keyword="keyword = $event"
      note="搜索姓名或手机号，核对身份后选择。青少年请选学员档案。"
      @select="emit('select', 'member', $event)"
    />
    <text v-if="students.length" class="group-label">青少年学员</text>
    <button
      v-for="student in students.slice(0, studentCount)"
      :key="student.id"
      class="person"
      :disabled="student.guardianConsentStatus === false"
      @tap="emit('select', 'student', student)"
    >
      <text>{{ student.displayName }}</text
      ><text class="note"
        >监护人：{{ student.guardian?.displayName || "未填写" }} ·
        {{
          student.guardianConsentStatus === false ? "待授权" : "青少年"
        }}</text
      >
    </button>
    <button
      v-if="students.length > studentCount"
      class="secondary"
      @tap="studentCount += 20"
    >
      查看更多学员
    </button>
    <text v-if="leads.length" class="group-label">客户线索</text>
    <button
      v-for="lead in leads.slice(0, leadCount)"
      :key="lead.id"
      class="person"
      @tap="emit('select', 'lead', lead)"
    >
      <text>{{ lead.displayName }}</text
      ><text class="note">客户线索</text>
    </button>
    <button
      v-if="leads.length > leadCount"
      class="secondary"
      @tap="leadCount += 20"
    >
      查看更多线索
    </button>
    <button class="secondary create" @tap="creating = true">
      新增青少年学员
    </button>
    <TrialStudentPicker
      v-if="creating"
      :students="students"
      :initial-keyword="keyword"
      :create-first="true"
      @close="creating = false"
      @select="
        emit('select', 'student', $event);
        creating = false;
      "
    />
  </view>
</template>
<style scoped>
.group-label {
  display: block;
  margin: 24rpx 0 8rpx;
  font-size: 26rpx;
  color: var(--color-muted);
}
.person {
  width: 100%;
  margin: 0;
  background: var(--color-surface);
  text-align: left;
  padding: 20rpx 8rpx;
  min-height: 48px;
  border-radius: 0;
  border-bottom: 1rpx solid var(--color-border);
  line-height: 1.5;
  font-size: 30rpx;
  white-space: normal;
}
.note {
  display: block;
  color: var(--color-muted);
  font-size: 24rpx;
  line-height: 1.6;
}
.create {
  margin: 24rpx 0 0;
  min-height: 48px;
  font-size: 28rpx;
}
</style>
