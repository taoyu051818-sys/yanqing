<script setup lang="ts">
import ReasonForm from "../../../../components/ReasonForm.vue";
import ActionDialog from "../../../../components/ActionDialog.vue";
import { money, today, venueDateKey } from "../../../../utils/format";
import { weekdays, weekdayLabel, priceStatus } from "./price-editor";
import { usePriceManagement } from "./use-price-management";
const props = defineProps<{
  editing: boolean;
  sourceId: string;
  canManage: boolean;
}>();
const {
  rules,
  source,
  form,
  loading,
  busy,
  loadError,
  error,
  advanced,
  history,
  initialized,
  preview,
  saved,
  currentRules,
  otherRules,
  slotOptions,
  slotIndex,
  slotLabel,
  load,
  open,
  back,
  review,
  confirm,
  toggleDay,
  expandedId,
  stoppingPrice,
  stopPrice,
} = usePriceManagement(props);
</script>

<template>
  <view class="price-management" :class="{ editing }">
    <view v-if="loadError" class="card failure" role="alert"
      ><text>{{ loadError }}</text
      ><button class="secondary" @tap="load">重新加载</button></view
    >
    <view v-else-if="loading && !rules.length" class="card muted"
      >正在加载价格…</view
    >
    <template v-else-if="!editing">
      <view class="list-heading"
        ><text>当前与即将生效的价格</text
        ><button v-if="canManage" class="primary" @tap="open()">
          新增价格
        </button></view
      >
      <text class="scope-note"
        >按时段设置，适用于全部可售场地；单独定价优先于默认价。</text
      >
      <view v-if="!currentRules.length" class="card"
        ><text>暂无生效中的价格</text
        ><text class="muted block"
          >设置价格后，会员才能按对应时段订场。</text
        ></view
      >
      <view class="price-list">
        <view v-for="rule in currentRules" :key="rule.id" class="price-row">
          <view class="price-row-main">
            <button class="price-row-edit" :disabled="!canManage" :aria-label="'修改' + (rule.timeSlot?.label || '默认') + '价格'" @tap="open(rule.id)">
              <view class="price-row-copy"><text class="name">{{ rule.timeSlot?.label || '默认价格' }}</text><text class="muted">{{ weekdayLabel(rule.weekdayMask) }} · {{ priceStatus(rule) }}</text></view>
              <view class="price-row-value"><text class="amount">{{ money(rule.priceCents) }}</text><text v-if="rule.newcomerPriceCents != null" class="muted">新客 {{ money(rule.newcomerPriceCents) }}</text></view><text v-if="canManage" class="row-chevron">›</text>
            </button>
            <button class="price-details-button" :aria-expanded="expandedId === rule.id" :aria-label="(rule.timeSlot?.label || '默认价格') + '详情'" @tap="expandedId = expandedId === rule.id ? '' : rule.id">{{ expandedId === rule.id ? '收起' : '详情' }}</button>
          </view>
          <view v-if="expandedId === rule.id" class="price-more">
            <text class="muted">{{ rule.name }} · {{ venueDateKey(rule.effectiveFrom) }} 起{{ rule.effectiveTo ? '，至 ' + venueDateKey(rule.effectiveTo) + ' 前' : '，长期有效' }}</text>
            <text class="muted">{{ rule.timeSlot ? '每场次' : '每计价时段' }}计价 · 版本 {{ rule.version }}</text>
            <button v-if="canManage" class="secondary" :disabled="busy" @tap="stoppingPrice = rule; error = '';">停用此价格</button>
          </view>
        </view>
      </view>
      <button
        v-if="otherRules.length"
        class="disclosure"
        :aria-expanded="history"
        @tap="history = !history"
      >
        {{ history ? "收起" : "查看" }}未启用与历史价格（{{
          otherRules.length
        }}）
      </button>
      <template v-if="history"
        ><view
          v-for="rule in otherRules"
          :key="rule.id"
          class="card history-item"
          ><text class="name"
            >{{ rule.name }} · {{ money(rule.priceCents) }}</text
          ><text class="muted block"
            >{{ priceStatus(rule) }} · {{ weekdayLabel(rule.weekdayMask) }} ·
            {{ venueDateKey(rule.effectiveFrom) }} 起</text
          ><button
            v-if="
              canManage && !rule.enabled && rule.timeSlot?.enabled !== false
            "
            class="secondary edit-button"
            @tap="open(rule.id)"
          >
            核对并使用此价格
          </button></view
        ></template
      >
    </template>
    <template v-else-if="initialized && !saved">
      <view class="card editor">
        <view v-if="source" class="scope"
          ><text class="name"
            >{{ slotLabel }} · {{ weekdayLabel(source.weekdayMask) }}</text
          ><text class="muted block"
            >全部可售场地 · 当前普通价 {{ money(source.priceCents) }}</text
          ></view
        >
        <template v-else>
          <label for="price-name">价格名称</label
          ><input
            id="price-name"
            v-model="form.name"
            class="input"
            maxlength="80"
            placeholder="例如：工作日晚场"
          />
          <text class="label">计价时段</text
          ><picker
            :range="slotOptions"
            range-key="label"
            :value="slotIndex"
            @change="
              form.timeSlotId =
                slotOptions[Number(($event.detail as any).value)].id
            "
            ><view class="choice"
              >{{ slotLabel }}<text>选择</text></view
            ></picker
          >
        </template>
        <label for="price-amount"
          >普通价格（元 /
          {{
            source?.timeSlot || form.timeSlotId ? "场次" : "计价时段"
          }}）</label
        >
        <input
          id="price-amount"
          v-model="form.priceYuan"
          class="input amount-input"
          type="digit"
          maxlength="9"
          placeholder="请输入金额"
          :disabled="busy"
        />
        <text class="label">生效时间</text>
        <view class="date-options"
          ><button
            class="date-option"
            :aria-pressed="form.date === today()"
            :class="{ selected: form.date === today() }"
            @tap="form.date = today()"
          >
            今天起</button
          ><picker
            class="date-option"
            mode="date"
            :start="today()"
            :value="form.date"
            @change="form.date = ($event.detail as any).value"
            ><view class="choice">{{
              form.date === today() ? "指定日期" : form.date
            }}</view></picker
          ></view
        >
        <text v-if="source?.enabled" class="muted"
          >生效前沿用原价格。{{
            source.effectiveTo
              ? "结束日期保持 " +
                venueDateKey(source.effectiveTo) +
                "（不含当天）。"
              : ""
          }}</text
        >
        <button
          class="disclosure"
          :aria-expanded="advanced"
          @tap="advanced = !advanced"
        >
          {{ advanced ? "收起高级设置" : "高级设置"
          }}<text v-if="!advanced && form.newcomerYuan"> · 已配置新客价</text>
        </button>
        <view v-if="advanced" class="advanced-fields">
          <template v-if="!source"
            ><text class="label">适用星期</text
            ><view class="weekdays"
              ><button
                v-for="day in weekdays"
                :key="day.bit"
                :class="{ selected: form.weekdayMask & day.bit }"
                :aria-pressed="Boolean(form.weekdayMask & day.bit)"
                @tap="toggleDay(day.bit)"
              >
                周{{ day.label }}
              </button></view
            ></template
          >
          <label for="price-newcomer">新客价格（元，选填）</label
          ><input
            id="price-newcomer"
            v-model="form.newcomerYuan"
            class="input"
            type="digit"
            placeholder="留空表示不单独设置新客价"
          />
          <template v-if="!source?.enabled"
            ><text class="label">结束日期（选填，不含当天）</text
            ><picker
              mode="date"
              :start="form.date"
              :value="form.endDate || form.date"
              @change="form.endDate = ($event.detail as any).value"
              ><view class="choice"
                >{{ form.endDate || "长期有效" }}<text>选择</text></view
              ></picker
            ><button
              v-if="form.endDate"
              class="disclosure"
              @tap="form.endDate = ''"
            >
              改为长期有效
            </button></template
          >
          <label for="price-reason">备注（选填）</label
          ><input
            id="price-reason"
            v-model="form.reason"
            class="input"
            maxlength="300"
            placeholder="例如：旺季价格调整"
          />
        </view>
      </view>
      <view class="card effect"
        ><text class="name">本次适用范围</text
        ><text>{{ slotLabel }} · {{ weekdayLabel(form.weekdayMask) }}</text
        ><text>全部可售场地 · {{ form.date }} 起</text
        ><text class="muted">已有订单金额保持不变。</text></view
      >
      <view class="price-footer"
        ><text v-if="error && !preview" class="failure" role="alert">{{
          error
        }}</text
        ><button
          class="primary"
          :disabled="busy || !canManage || Boolean(loadError)"
          @tap="review"
        >
          核对并确认
        </button></view
      >
    </template>
    <view v-if="saved" class="card saved" role="status"
      ><text class="name">{{
        priceStatus(saved) === "待生效" ? "新价格已安排" : "价格已更新"
      }}</text
      ><text class="amount">{{ money(saved.priceCents) }}</text
      ><text>{{ venueDateKey(saved.effectiveFrom) }} 起按新价格订场。</text
      ><text class="muted">已有订单金额保持不变，无需另行启用。</text
      ><button class="primary" @tap="back">返回价格列表</button></view
    >
    <ReasonForm
      v-if="stoppingPrice"
      title="停用此价格"
      :description="
        stoppingPrice.name +
        '。停用后，如果没有其他适用价格，该时段将无法订场。已有订单不受影响。'
      "
      :reasons="['停止销售此时段', '价格配置有误', '其他原因']"
      :busy="busy"
      :error="error"
      confirm-text="确认停用"
      @cancel="
        stoppingPrice = null;
        error = '';
      "
      @submit="stopPrice"
    />
    <ActionDialog
      v-if="preview"
      title="确认价格修改"
      :busy="busy"
      @close="
        preview = null;
        error = '';
      "
    >
      <view class="preview"
        ><text class="name"
          >{{ slotLabel }} · {{ weekdayLabel(preview.weekdayMask) }}</text
        ><text class="muted">适用于全部可售场地</text
        ><text class="preview-amount"
          >{{ source ? money(source.priceCents) + " → " : ""
          }}{{ money(preview.priceCents) }}</text
        ><text
          >新客价：{{
            preview.newcomerPriceCents == null
              ? "不单独设置"
              : money(preview.newcomerPriceCents)
          }}</text
        ><text>生效：{{ venueDateKey(preview.effectiveFrom) }} 起</text
        ><text
          >结束：{{
            preview.effectiveTo
              ? venueDateKey(preview.effectiveTo) + " 前"
              : "长期有效"
          }}</text
        ><text class="muted">原价格自动衔接，已有订单金额保持不变。</text
        ><text v-if="error" class="failure" role="alert">{{
          error
        }}</text></view
      >
      <template #footer
        ><view class="preview-actions"
          ><button
            class="secondary"
            :disabled="busy"
            @tap="
              preview = null;
              error = '';
            "
          >
            返回修改</button
          ><button
            class="primary"
            :loading="busy"
            :disabled="busy || !canManage"
            @tap="confirm"
          >
            {{ busy ? "正在提交" : "确认修改价格" }}
          </button></view
        ></template
      >
    </ActionDialog>
  </view>
</template>

<style scoped src="./price-management.css"></style>
