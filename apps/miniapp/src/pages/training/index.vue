<script setup lang="ts">
import type {
  TrainingProductView,
  TrainingEnrollmentView,
  TrainingStudentView,
} from "@yanqing/shared";
import type { TrainingTrialView } from "../../types/training-operations";
import { useStudentRegistration } from "./use-student-registration";
import { useCoursePurchase } from "./use-course-purchase";
import { useTrainingRefund } from "./use-training-refund";
import {
  consumed,
  refundedCents,
  unusedPrepaidCents,
  confirmedRevenueCents,
  receivedPrepaidCents,
  canRequestRefund,
  paymentComposition,
} from "./enrollment-presentation";

import { trainingAudienceLabel } from "@yanqing/shared";
import { computed, ref, watch } from "vue";
import { onLoad, onShow } from "@dcloudio/uni-app";
import { useSessionStore } from "../../stores/session";
import {
  requestMemberLogin,
  openMemberPage,
} from "../../utils/member-navigation";
import GuestState from "../../components/GuestState.vue";
import {
  captureAuthSession,
  isAuthSessionCurrent,
  useAccessToken,
} from "../../services/auth-session";
import SectionEmpty from "../../components/SectionEmpty.vue";
import ReasonForm from "../../components/ReasonForm.vue";
import StatusBadge from "../../components/StatusBadge.vue";
import { endpoints } from "../../services/api";
import { money, shortDate } from "../../utils/format";

const productDetailId = ref(""),
  enrollmentDetailId = ref("");
const showingDetail = computed(() =>
  Boolean(productDetailId.value || enrollmentDetailId.value),
);
function viewCourse(product: TrainingProductView) {
  uni.navigateTo({
    url: "/pages/training/index?productId=" + encodeURIComponent(product.id),
  });
}
function viewEnrollment(item: TrainingEnrollmentView) {
  uni.navigateTo({
    url:
      "/pages/training/index?tab=mine&enrollmentId=" +
      encodeURIComponent(item.id),
  });
}
const session = useSessionStore();
const audience = ref("ALL");
const expandedEnrollments = ref<Record<string, boolean>>({});
const products = ref<TrainingProductView[]>([]);
const enrollments = ref<TrainingEnrollmentView[]>([]);
const students = ref<TrainingStudentView[]>([]);
const trials = ref<TrainingTrialView[]>([]);
const tab = ref<"products" | "mine" | "trials">("products");
const loading = ref(false);
const error = ref("");
function login() {
  return requestMemberLogin(
    "/pages/training/index?tab=" +
      tab.value +
      (productDetailId.value
        ? "&productId=" + encodeURIComponent(productDetailId.value)
        : ""),
  );
}

onLoad((query) => {
  productDetailId.value = String(query?.productId || "");
  enrollmentDetailId.value = String(query?.enrollmentId || "");
  if (productDetailId.value || enrollmentDetailId.value)
    uni.setNavigationBarTitle({ title: "课程详情" });
  const requested = query?.tab;
  if (
    requested === "products" ||
    requested === "mine" ||
    requested === "trials"
  ) {
    tab.value = requested;
  }
});
const visibleProducts = computed(() =>
  products.value.filter((item) =>
    productDetailId.value
      ? item.id === productDetailId.value
      : audience.value === "ALL" ||
        item.audience === "ALL" ||
        item.audience === audience.value,
  ),
);
const {
  purchasingId,
  selectedProductId,
  selectedClassId,
  selectedStudentId,
  purchaseFor,
  purchasingForStudent,
  purchaseError,
  eligibleStudents,
  preparePurchase,
  purchase,
  resetPurchase,
} = useCoursePurchase({
  students,
  login,
  onNeedsStudent: () => {
    audience.value = "YOUTH";
    openStudentForm();
  },
});
const {
  savingStudent,
  showStudentForm,
  studentForm,
  maxBirthMonth,
  setBirthMonth,
  setConsent,
  openStudentForm,
  createStudent,
  resetStudent,
} = useStudentRegistration({
  login,
  reload: load,
  onCreated: (id) => {
    selectedStudentId.value = id;
  },
});
const {
  refundingId,
  refundItemId,
  refundMaximum,
  refundOrder,
  refundError,
  customRefund,
  refundAmount,
  prepareRefund,
  requestTrainingRefund,
  resetRefund,
} = useTrainingRefund({ login, reload: load });

function clearPrivateState() {
  students.value = [];
  enrollments.value = [];
  trials.value = [];
  expandedEnrollments.value = {};
  memberError.value = "";
  resetStudent();
  resetPurchase();
  resetRefund();
}
const memberError = ref("");
watch(useAccessToken(), clearPrivateState, { flush: "sync" });
let loadGeneration = 0;
async function load() {
  const run = ++loadGeneration;
  loading.value = true;
  error.value = "";
  memberError.value = "";
  try {
    const catalog = await endpoints.publicTrainingProducts();
    if (run !== loadGeneration) return;
    products.value = catalog;
    if (!session.isAuthenticated) {
      clearPrivateState();
      return;
    }
    const owner = captureAuthSession();
    try {
      const refreshed = await session.hydrate();
      if (run !== loadGeneration || !isAuthSessionCurrent(owner)) return;
      if (!refreshed) throw new Error("报名人信息暂未同步，请重试");
      const [nextStudents, nextEnrollments, nextTrials] = await Promise.all([
        endpoints.trainingStudents(),
        endpoints.trainingEnrollments(),
        endpoints.myTrainingTrials(),
      ]);
      if (run !== loadGeneration || !isAuthSessionCurrent(owner)) return;
      students.value = nextStudents;
      enrollments.value = nextEnrollments;
      trials.value = nextTrials;
    } catch (cause: any) {
      if (run === loadGeneration && isAuthSessionCurrent(owner))
        memberError.value = cause?.message || "个人课程记录暂未同步";
    }
  } catch (cause: any) {
    if (run === loadGeneration)
      error.value = cause?.message || "课程加载失败，请稍后重试";
  } finally {
    if (run === loadGeneration) loading.value = false;
  }
}

onShow(load);
</script>
<template>
  <view class="page safe-bottom" :class="{ 'course-detail': showingDetail }">
    <view v-if="session.isAuthenticated && memberError" class="card load-error"
      ><text>{{ memberError }}</text
      ><button class="secondary retry" @tap="load">重试</button></view
    >
    <GuestState
      v-if="!session.isAuthenticated && tab !== 'products'"
      :title="tab === 'mine' ? '我的课程' : '试听记录'"
      description="这里展示你报名的课程、剩余课时和试听安排。可以先切换到“找课程”浏览在售课程。"
      @login="login"
    />
    <view v-if="error" class="card load-error"
      ><text>{{ error }}</text
      ><button class="secondary retry" @tap="load">重试</button></view
    >
    <view v-if="!showingDetail" class="tabs"
      ><button :class="{ active: tab === 'products' }" @tap="tab = 'products'">
        找课程</button
      ><button :class="{ active: tab === 'mine' }" @tap="tab = 'mine'">
        我的课程</button
      ><button
        v-if="trials.length || tab === 'trials'"
        :class="{ active: tab === 'trials' }"
        @tap="tab = 'trials'"
      >
        试听记录
      </button></view
    >
    <template v-if="tab === 'products'">
      <view v-if="!showingDetail" class="audience-tabs"
        ><button
          v-for="option in [
            { value: 'ALL', label: '全部' },
            { value: 'ADULT', label: '成人课程' },
            { value: 'YOUTH', label: '青少年课程' },
          ]"
          :key="option.value"
          :class="{ selected: audience === option.value }"
          @tap="audience = option.value"
        >
          {{ option.label }}
        </button></view
      >
      <view
        v-if="session.isAuthenticated && productDetailId && showStudentForm"
        class="card student-card"
      >
        <view class="row"
          ><view
            ><text class="student-title">我的青少年学员</text
            ><text class="student-tip">监护人主账号负责授权与报名</text></view
          ><button class="mini" @tap="showStudentForm = !showStudentForm">
            {{ showStudentForm ? "收起" : "添加学员" }}
          </button></view
        >
        <view v-if="students.length" class="student-list">
          <view
            v-for="student in students"
            :key="student.id"
            class="student-row"
            ><text>{{ student.displayName }}</text
            ><text
              :class="
                student.guardianConsentStatus ? 'consent-ok' : 'consent-warn'
              "
              >{{ student.guardianConsentStatus ? "已授权" : "待授权" }}</text
            ></view
          >
        </view>
        <view v-else-if="!showStudentForm" class="student-tip empty-student"
          >尚未建立学员档案，青少年课包暂不能报名。</view
        >
        <view v-if="showStudentForm" class="student-form">
          <text class="student-tip">学员姓名或常用称呼</text
          ><input
            v-model="studentForm.displayName"
            aria-label="学员姓名"
            maxlength="40"
            placeholder="请填写学员姓名或常用称呼"
          />
          <picker
            mode="date"
            fields="month"
            :value="studentForm.birthMonth"
            :end="maxBirthMonth"
            @change="setBirthMonth"
            ><view class="picker-row"
              ><text>出生月份</text
              ><text>{{ studentForm.birthMonth }}</text></view
            ></picker
          >
          <view class="consent-row"
            ><text
              >我确认是该学员监护人，并授权用于课程报名、出勤与紧急联系</text
            ><switch
              color="#17653d"
              :checked="studentForm.guardianConsentStatus"
              @change="setConsent"
          /></view>
          <button
            class="primary save-student"
            :loading="savingStudent"
            :disabled="savingStudent"
            @tap="createStudent"
          >
            保存并完成授权
          </button>
        </view>
      </view>
      <view
        v-for="product in visibleProducts"
        :key="product.id"
        class="card product"
      >
        <view class="row"
          ><text class="pill">{{
            trainingAudienceLabel(product.audience)
          }}</text
          ><text class="muted">有效期 {{ product.validityDays }} 天</text></view
        >
        <text class="title">{{ product.name }}</text>
        <view class="details"
          ><text>{{ product.totalSessions }}次课</text
          ><text>{{ product.classes?.length || 0 }}个可选班级</text></view
        >
        <view class="row footer"
          ><text class="money">{{ money(product.priceCents) }}</text
          ><button
            class="secondary buy"
            :loading="purchasingId === product.id"
            :disabled="Boolean(purchasingId)"
            @tap="
              productDetailId ? preparePurchase(product) : viewCourse(product)
            "
          >
            {{ productDetailId ? "选择学员与班级" : "查看课程" }}
          </button></view
        >
        <view v-if="selectedProductId === product.id" class="enroll-form">
          <text class="student-title">确认报名信息</text>
          <text class="muted"
            >所选课程：{{ product.name }} ·
            {{ money(product.priceCents) }}</text
          >
          <view v-if="product.classes?.length">
            <text class="student-tip">上课班级</text>
            <picker
              :range="product.classes"
              range-key="name"
              :value="
                Math.max(
                  0,
                  product.classes.findIndex(
                    (item: any) => item.id === selectedClassId,
                  ),
                )
              "
              :disabled="Boolean(purchasingId)"
              @change="
                selectedClassId =
                  product.classes[Number($event.detail.value)]?.id || ''
              "
              ><view class="picker-row"
                >{{
                  product.classes.find(
                    (item: any) => item.id === selectedClassId,
                  )?.name || "请选择班级"
                }}
                · 点击选择</view
              ></picker
            >
          </view>
          <view v-if="product.audience === 'ALL'" class="purchase-subject">
            <text class="student-tip">为谁报名</text>
            <view class="subject-options">
              <button
                :class="purchaseFor === 'SELF' ? 'primary' : 'secondary'"
                :disabled="Boolean(purchasingId)"
                @tap="
                  purchaseFor = 'SELF';
                  purchaseError = '';
                "
              >
                本人
              </button>
              <button
                :class="purchaseFor === 'STUDENT' ? 'primary' : 'secondary'"
                :disabled="Boolean(purchasingId)"
                @tap="
                  purchaseFor = 'STUDENT';
                  purchaseError = '';
                "
              >
                青少年学员
              </button>
            </view>
          </view>
          <view v-if="purchasingForStudent(product)">
            <text class="student-tip">报名学员</text>
            <picker
              v-if="eligibleStudents.length"
              :range="eligibleStudents"
              range-key="displayName"
              :disabled="Boolean(purchasingId)"
              @change="
                selectedStudentId =
                  eligibleStudents[Number($event.detail.value)]?.id || ''
              "
              ><view class="picker-row"
                >{{
                  eligibleStudents.find((item) => item.id === selectedStudentId)
                    ?.displayName || "请选择已授权学员"
                }}
                · 点击选择</view
              ></picker
            >
            <button class="secondary" @tap="openStudentForm">
              新建学员档案
            </button>
          </view>
          <text v-else class="muted"
            >报名人：{{ session.user?.displayName }}（本人）</text
          >
          <text v-if="purchaseError" class="form-error" role="alert">{{
            purchaseError
          }}</text>
          <view class="course-dock"
            ><text>{{ product.name }} · {{ money(product.priceCents) }}</text
            ><button
              class="primary"
              :loading="purchasingId === product.id"
              :disabled="Boolean(purchasingId)"
              @tap="purchase(product)"
            >
              确认报名，下一步付款
            </button></view
          >
          <button
            class="secondary"
            :disabled="Boolean(purchasingId)"
            @tap="selectedProductId = ''"
          >
            暂不报名
          </button>
        </view>
      </view>
      <SectionEmpty
        v-if="!visibleProducts.length && !loading && !error"
        title="暂无在售课程"
      />
    </template>
    <template v-else-if="tab === 'mine'">
      <view
        v-for="item in enrollments.filter(
          (item) => !enrollmentDetailId || item.id === enrollmentDetailId,
        )"
        :key="item.id"
        class="card enrollment"
      >
        <view class="row"
          ><text class="title compact">{{ item.product?.name }}</text
          ><StatusBadge :value="item.status"
        /></view>
        <text v-if="item.student" class="student-tip"
          >学员：{{ item.student.displayName }}</text
        >
        <text class="remaining"
          >剩余
          {{ Math.max(0, Number(item.totalSessions - consumed(item))) }}
          次课</text
        >
        <view class="progress"
          ><view
            :style="{
              width: `${Math.min(100, item.totalSessions ? (consumed(item) / item.totalSessions) * 100 : 0)}%`,
            }"
          ></view
        ></view>
        <view class="row"
          ><text class="muted"
            >已消 {{ consumed(item) }}/{{ item.totalSessions }} 次</text
          ><text class="muted"
            >有效至 {{ shortDate(item.expiresAt) }}</text
          ></view
        >
        <button
          v-if="!enrollmentDetailId"
          class="secondary"
          @tap="viewEnrollment(item)"
        >
          课程详情与退费 ›
        </button>
        <template v-if="enrollmentDetailId">
          <button
            class="details-toggle"
            @tap="expandedEnrollments[item.id] = !expandedEnrollments[item.id]"
          >
            {{ expandedEnrollments[item.id] ? "收起费用明细" : "查看费用明细" }}
          </button>
          <view v-if="expandedEnrollments[item.id]" class="training-ledger">
            <view
              ><text class="ledger-label">实付学费</text
              ><text class="ledger-value">{{
                money(receivedPrepaidCents(item))
              }}</text></view
            >
            <view
              ><text class="ledger-label">已使用课时费用</text
              ><text class="ledger-value confirmed">{{
                money(confirmedRevenueCents(item))
              }}</text></view
            >
            <view
              ><text class="ledger-label">未使用课时金额</text
              ><text class="ledger-value">{{
                money(unusedPrepaidCents(item))
              }}</text></view
            >
            <view
              ><text class="ledger-label">累计退费</text
              ><text class="ledger-value refunded">{{
                money(refundedCents(item))
              }}</text></view
            >
          </view>
          <text v-if="expandedEnrollments[item.id]" class="ledger-note"
            >费用按上课与退费记录更新；如发现上课记录有误，请联系教练核实。</text
          >
          <view
            v-if="item.regulatoryWarnings?.length"
            class="regulatory-warning"
            ><text v-for="warning in item.regulatoryWarnings" :key="warning">{{
              warning
            }}</text></view
          >
          <view v-if="canRequestRefund(item)" class="refund-actions">
            <text class="refund-limit"
              >未使用课时金额
              {{
                money(unusedPrepaidCents(item))
              }}，可退金额以申请时核对为准</text
            >
            <button
              class="secondary refund-button"
              :loading="refundingId === item.id"
              :disabled="Boolean(refundingId)"
              @tap="prepareRefund(item)"
            >
              申请退费
            </button>
          </view>
          <view
            v-if="refundItemId === item.id && !refundOrder"
            class="enroll-form"
            ><text v-if="refundingId" class="muted">正在核对可退金额…</text
            ><text v-if="refundError" class="form-error" role="alert">{{
              refundError
            }}</text
            ><button
              class="secondary"
              @tap="
                openMemberPage(
                  '/pages/order/index?id=' +
                    encodeURIComponent(item.orderId || ''),
                )
              "
            >
              查看相关订单
            </button></view
          >
          <ReasonForm
            v-if="refundItemId === item.id && refundOrder"
            :key="item.id"
            title="申请未使用课时退费"
            :description="
              '最多可退 ' +
              money(refundMaximum) +
              '；原支付方式：' +
              paymentComposition(refundOrder) +
              '。提交后等待审核，按原支付规则退回，已使用课时不在退费范围。'
            "
            :busy="Boolean(refundingId)"
            :error="refundError"
            confirm-text="确认申请退费"
            @cancel="refundItemId = ''"
            @submit="requestTrainingRefund(item, $event)"
          >
            <view class="refund-amount">
              <button
                class="secondary"
                :aria-pressed="!customRefund"
                :disabled="Boolean(refundingId)"
                @tap="
                  customRefund = false;
                  refundError = '';
                "
              >
                全部可退余额 {{ money(refundMaximum) }}
              </button>
              <button
                class="secondary"
                :aria-pressed="customRefund"
                :disabled="Boolean(refundingId)"
                @tap="
                  customRefund = true;
                  refundError = '';
                "
              >
                指定退费金额
              </button>
              <view v-if="customRefund"
                ><text class="student-tip">申请金额（元）</text
                ><input
                  v-model="refundAmount"
                  class="input"
                  aria-label="申请退费金额"
                  type="digit"
                  :adjust-position="false"
                  :disabled="Boolean(refundingId)"
              /></view>
            </view>
          </ReasonForm>
          <view v-if="item.attendances?.[0]" class="feedback"
            >最近：{{ item.attendances[0].feedback || "已完成签到消课" }}</view
          >
        </template>
      </view>
      <SectionEmpty
        v-if="
          session.isAuthenticated &&
          !enrollments.length &&
          !loading &&
          !error &&
          !memberError
        "
        title="还没有课程"
        description="找到合适的课程并报名后，可以在这里查看课时。"
      />
      <button
        v-if="!enrollments.length && !loading"
        class="secondary"
        @tap="tab = 'products'"
      >
        去找课程
      </button>
    </template>
    <template v-else>
      <view v-for="trial in trials" :key="trial.id" class="card trial-result">
        <view class="row"
          ><view
            ><text class="title compact">{{
              trial.student?.displayName ||
              trial.member?.displayName ||
              "我的试听"
            }}</text
            ><text class="student-tip"
              >{{ trial.product?.name }} ·
              {{ shortDate(trial.scheduledStartsAt) }}</text
            ></view
          ><StatusBadge :value="trial.status"
        /></view>
        <text class="trial-coach"
          >教练：{{ trial.coach?.displayName || "到店后由课程老师接待" }} ·
          试听编号 {{ trial.trialNo }}</text
        >
        <view v-if="trial.assessmentDimensions?.length" class="trial-scores">
          <view
            v-for="dimension in trial.assessmentDimensions"
            :key="dimension.key"
            ><text>{{ dimension.label }}</text
            ><text>{{ dimension.score }}/5</text
            ><text v-if="dimension.note" class="dimension-note">{{
              dimension.note
            }}</text></view
          >
        </view>
        <view v-if="trial.recommendation" class="trial-recommendation"
          ><text class="recommendation-title">教练建议</text
          ><text>{{ trial.recommendation }}</text
          ><text v-if="trial.assessmentNote" class="dimension-note">{{
            trial.assessmentNote
          }}</text></view
        >
        <text v-else class="student-tip">{{
          trial.status === "CHECKED_IN"
            ? "已签到，等待教练提交测评。"
            : trial.status === "RESERVED"
              ? "预约成功，请按时到场。"
              : "当前暂无测评结果。"
        }}</text>
        <text v-if="trial.student" class="privacy-note"
          >该结果仅对本学员监护人账号和授权经营人员可见。</text
        >
      </view>
      <SectionEmpty
        v-if="
          session.isAuthenticated &&
          !trials.length &&
          !loading &&
          !error &&
          !memberError
        "
        title="还没有试听记录"
      />
    </template>
  </view>
</template>
<style scoped src="./training.css"></style>
