<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api, date as displayDate, money, query, session } from '../api';
import type { BossSummary, BossBriefing, BossRiskEvent } from '@yanqing/shared';
import Panel from './Panel.vue';
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
}).format(new Date());
const day = ref(today),
  data = ref<BossSummary | null>(null),
  briefing = ref<BossBriefing | null>(null),
  loading = ref(false),
  generating = ref(false),
  error = ref(''),
  notice = ref('');
const selected = ref<BossRiskEvent | null>(null),
  reason = ref(''),
  saving = ref(false),
  actionError = ref(''),
  showHandled = ref(false);
const canResolve = computed(() =>
  session.value?.user.roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r)),
);
const risks = computed(() =>
  (data.value?.events || []).filter(
    (e) => showHandled.value || ['OPEN', 'REVIEWING'].includes(e.status),
  ),
);
const states: Record<string, string> = {
  OPEN: '待处理',
  REVIEWING: '复核中',
  RESOLVED: '已处理',
  DISMISSED: '已排除',
};
const levels: Record<string, string> = {
  LOW: '关注',
  MEDIUM: '提醒',
  HIGH: '重要',
  CRITICAL: '紧急',
};
let sequence = 0;
async function load() {
  if (generating.value) return;
  const run = ++sequence;
  loading.value = true;
  error.value = '';
  data.value = null;
  briefing.value = null;
  try {
    const [s, b] = await Promise.all([
      api<BossSummary>('/boss/summary' + query({ date: day.value })),
      api<BossBriefing | null>('/boss/briefing' + query({ date: day.value })),
    ]);
    if (run === sequence) {
      data.value = s;
      briefing.value = b;
    }
  } catch (e) {
    if (run === sequence) error.value = (e as Error).message;
  } finally {
    if (run === sequence) loading.value = false;
  }
}
async function generate() {
  if (!data.value || loading.value || generating.value) return;
  generating.value = true;
  notice.value = '';
  try {
    briefing.value = await api<BossBriefing>('/boss/briefing', 'POST', {
      date: data.value.date,
    });
    notice.value = briefing.value?.message || '简报已更新';
  } catch (e) {
    notice.value = (e as Error).message;
  } finally {
    generating.value = false;
  }
}
function open(e: BossRiskEvent) {
  selected.value = e;
  reason.value = '';
  actionError.value = '';
}
async function transition(action: string) {
  if (!selected.value || reason.value.trim().length < 2) return;
  saving.value = true;
  actionError.value = '';
  try {
    await api(
      '/governance/risk-events/' + selected.value.id + '/' + action,
      'POST',
      { reason: reason.value.trim(), idempotencyKey: crypto.randomUUID() },
    );
    selected.value = null;
    await load();
  } catch (e) {
    actionError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section>
    <form class="toolbar" @submit.prevent="load">
      <label
        >经营日期<input
          v-model="day"
          type="date"
          :max="today"
          :disabled="loading || generating"
          required /></label
      ><button :disabled="loading || generating">
        {{ loading ? '正在汇总…' : '查询摘要' }}</button
      ><span class="small muted">按北京时间统计，金额来自实际业务记录</span>
    </form>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <template v-if="data">
      <p class="small muted">
        当前指标与简报日期：{{ data.date
        }}<span v-if="day !== data.date">
          · 日期已修改，请点击“查询摘要”应用</span
        >
      </p>
      <div class="boss-metrics">
        <article>
          <span>新增订场</span
          ><strong>{{ data.daily.venueOrderCount }}<small> 笔</small></strong
          ><small
            >其中代会员订场 {{ data.daily.assistedVenueOrderCount }} 笔</small
          >
        </article>
        <article>
          <span>场地确认收入</span
          ><strong>{{ money(data.daily.venueRevenueCents) }}</strong
          ><small>按履约确认，扣除退款反冲</small>
        </article>
        <article>
          <span>全业务已支付</span
          ><strong>{{ money(data.daily.paidCents) }}</strong
          ><small>微信实收 {{ money(data.daily.wechatPaidCents) }}</small>
        </article>
        <article>
          <span>场地使用率</span
          ><strong>{{
            data.venue.utilizationRate == null
              ? '—'
              : data.venue.utilizationRate + '%'
          }}</strong
          ><small>排除封场和未支付占位</small>
        </article>
      </div>
      <div class="surface boss-counts">
        <span
          >当日新建待支付
          <strong>{{ data.daily.pendingOrderCount }}</strong></span
        ><span
          >待支付积压
          <strong>{{ data.daily.pendingBacklogCount }}</strong></span
        ><span
          >当日取消 <strong>{{ data.daily.cancelledOrderCount }}</strong></span
        ><span
          >成功退款订单
          <strong>{{ data.daily.refundedOrderCount }}</strong></span
        ><span
          >退款金额 <strong>{{ money(data.daily.refundedCents) }}</strong></span
        >
      </div>
      <div class="section-bar">
        <h2>老板简报</h2>
        <button :disabled="generating || loading" @click="generate">
          {{
            generating
              ? '正在整理…'
              : data.aiConfigured
                ? '生成 AI 简报'
                : '生成数据摘要'
          }}
        </button>
      </div>
      <div class="surface briefing">
        <template v-if="briefing?.text"
          ><div class="small muted">
            {{ briefing.source === 'AI' ? 'AI 解读' : '数据摘要' }} ·
            {{ displayDate(briefing.generatedAt)
            }}<span v-if="briefing.model"> · {{ briefing.model }}</span>
          </div>
          <p>{{ briefing.text }}</p>
          <small class="muted"
            >以本页实际指标为准；刷新数据后可重新生成简报。</small
          ></template
        >
        <p v-else class="muted">
          点击生成，汇总收入、场地使用、活动进展和待跟进事件。
        </p>
      </div>
      <div class="section-bar">
        <h2>空场最多的时段</h2>
        <span class="small muted">按可售空闲场地时长排序</span>
      </div>
      <div class="surface table-wrap">
        <table>
          <thead>
            <tr>
              <th>时段</th>
              <th>可售场地小时</th>
              <th>空闲场地小时</th>
              <th>使用率</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="slot in data.venue.emptiestSlots" :key="slot.id">
              <td>{{ slot.label }}</td>
              <td>{{ (slot.availableMinutes / 60).toFixed(1) }}</td>
              <td>{{ (slot.emptyMinutes / 60).toFixed(1) }}</td>
              <td>{{ slot.utilizationRate }}%</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!data.venue.emptiestSlots.length" class="empty">
          暂无可售场地时段
        </div>
      </div>
      <div class="section-bar boss-section">
        <h2>活动摘要 · {{ data.activityCount }} 场</h2>
        <span class="small muted">当前开放活动，确认与待支付分别统计</span>
      </div>
      <div class="surface table-wrap">
        <table>
          <thead>
            <tr>
              <th>活动 / 时间</th>
              <th>确认报名</th>
              <th>待支付人数</th>
              <th>剩余名额</th>
              <th>候补人数</th>
              <th>累计净收报名费</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="a in data.activities" :key="a.kind + a.id">
              <td>
                <strong>{{ a.name }}</strong>
                <div class="small muted">
                  {{ a.kind === 'EVENT' ? '积分赛' : '日常球局' }} ·
                  {{ displayDate(a.startsAt) }}
                </div>
              </td>
              <td>{{ a.confirmedPeople }} 人</td>
              <td>{{ a.unpaidPeople }} 人</td>
              <td>{{ a.remainingPeople }} / {{ a.capacityPeople }} 人</td>
              <td>{{ a.waitlistPeople }} 人</td>
              <td>{{ money(a.collectedCents) }}</td>
            </tr>
          </tbody>
        </table>
        <div v-if="!data.activities.length" class="empty">暂无当前开放活动</div>
      </div>
      <div class="section-bar boss-section">
        <h2>关键事件</h2>
        <label class="handled"
          ><input v-model="showHandled" type="checkbox" />显示已处理</label
        >
      </div>
      <p class="small muted">
        每5分钟自动检测 · 最近成功扫描
        {{ displayDate(data.monitor.lastSucceededAt) || '尚未完成' }} ·
        事件保留处理记录，不自动修改订单
      </p>
      <p v-if="data.monitor.error" class="error" role="alert">
        {{ data.monitor.error }}
      </p>
      <div class="surface">
        <button
          v-for="e in risks"
          :key="e.id"
          class="task-row"
          @click="open(e)"
        >
          <span
            class="badge"
            :class="
              ['HIGH', 'CRITICAL'].includes(e.severity) ? 'warn' : 'neutral'
            "
            >{{ levels[e.severity] }}</span
          ><span class="task-copy"
            ><strong>{{ e.summary }}</strong
            ><small
              >{{ displayDate(e.createdAt) }} · {{ states[e.status] }}</small
            ></span
          ><span class="link">查看依据</span>
        </button>
        <div v-if="!risks.length" class="empty">
          {{
            data.monitor.lastSucceededAt
              ? '当前列表没有待跟进事件'
              : '首次扫描尚未完成，请稍后刷新'
          }}
        </div>
      </div>
      <p v-if="data.eventsTruncated" class="muted small">
        共有
        {{ data.eventCount }}
        条相关事件，当前按严重程度展示前100条；其余可在风险治理中查询。
      </p>
      <details class="definitions">
        <summary>统计口径与事件阈值</summary>
        <p v-for="(text, key) in data.definitions" :key="key">{{ text }}</p>
        <p>
          大额订单
          {{ money(data.monitor.thresholds.largeOrderCents) }}，大额充值
          {{
            money(data.monitor.thresholds.largeRechargeCents)
          }}；24小时成功退款
          {{ data.monitor.thresholds.frequentRefundCount }} 笔；支付等待
          {{ data.monitor.thresholds.paymentStuckMinutes }} 分钟；待支付积压
          {{ data.monitor.thresholds.overdueOrderMinutes }} 分钟。临近满员
          {{ data.monitor.thresholds.nearFullPercent }}%；截止前
          {{ data.monitor.thresholds.signupLeadHours }} 小时确认报名不足
          {{
            data.monitor.thresholds.lowSignupPercent
          }}%；近7个完整营业日使用率低于
          {{
            data.monitor.thresholds.lowUtilizationPercent
          }}%（至少3天可售数据）。
        </p>
      </details>
    </template>
    <Panel
      v-if="selected"
      title="关键事件依据与处理"
      :busy="saving"
      @close="selected = null"
      ><h3>{{ selected.summary }}</h3>
      <p>{{ levels[selected.severity] }} · {{ states[selected.status] }}</p>
      <dl class="facts">
        <dt>首次记录</dt>
        <dd>{{ displayDate(selected.createdAt) }}</dd>
        <dt>最近检测</dt>
        <dd>{{ displayDate(selected.lastSeenAt) }}</dd>
        <dt>关联对象</dt>
        <dd class="mono">
          {{ selected.objectType }} / {{ selected.objectId }}
        </dd>
      </dl>
      <details open>
        <summary>触发依据</summary>
        <pre>{{ JSON.stringify(selected.evidence, null, 2) }}</pre>
      </details>
      <template v-if="['OPEN', 'REVIEWING'].includes(selected.status)"
        ><label
          >处理说明<textarea
            v-model="reason"
            minlength="2"
            maxlength="300"
            placeholder="记录核对结果或跟进安排"
          ></textarea>
        </label>
        <p v-if="actionError" class="error" role="alert">{{ actionError }}</p>
        <div class="row-actions">
          <button
            v-if="selected.status === 'OPEN'"
            :disabled="saving || reason.trim().length < 2"
            @click="transition('review')"
          >
            开始复核</button
          ><button
            v-if="canResolve"
            :disabled="saving || reason.trim().length < 2"
            @click="transition('resolve')"
          >
            标记已处理</button
          ><button
            v-if="canResolve"
            class="secondary"
            :disabled="saving || reason.trim().length < 2"
            @click="transition('dismiss')"
          >
            排除提醒
          </button>
        </div></template
      ></Panel
    >
  </section>
</template>
<style scoped>
.boss-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 18px;
}
.boss-metrics article {
  padding: 22px;
  background: white;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.boss-metrics span,
.boss-metrics small {
  color: var(--muted);
  font-size: 13px;
}
.boss-metrics strong {
  display: block;
  font-size: 28px;
  line-height: 1.3;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.boss-counts {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  padding: 20px;
  margin-bottom: 28px;
  font-size: 14px;
}
.briefing {
  padding: 24px;
  margin-bottom: 30px;
}
.briefing p {
  white-space: pre-wrap;
  line-height: 1.9;
  margin: 14px 0;
}
.boss-section {
  margin-top: 30px;
}
.handled {
  display: flex;
  gap: 8px;
  align-items: center;
  font-weight: 400;
  margin: 0;
  font-size: 14px;
}
.handled input {
  width: 18px;
  min-height: 18px;
  margin: 0;
}
.definitions {
  margin-top: 24px;
  color: var(--muted);
  font-size: 13px;
}
.definitions p {
  margin-top: 16px;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f3f6f2;
  padding: 16px;
  font-size: 13px;
}
@media (max-width: 1150px) {
  .boss-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .boss-metrics {
    grid-template-columns: 1fr;
  }
  .section-bar {
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
}
</style>
