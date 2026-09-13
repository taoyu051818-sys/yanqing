<script setup lang="ts">
import type { EventDetail, InventoryItem } from "../page-types";

import type { EventMatch } from "../page-types";
import { toRefs, computed } from "vue";
import MetricCard from "../../../../../components/MetricCard.vue";
import { shortDate } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";
import type {
  EventStatus,
  MatchStatus,
  EventTeam,
  EventPrizeAward,
} from "../page-types.js";

const props = defineProps<{
  eventDetail: EventDetail | null;
  metrics: string[][];
  focusedRecord: string;
  statusLabel: (status?: string) => string;
  workflowHint: string;
  showPublish: boolean;
  showPromoteWaitlist: boolean;
  showCancel: boolean;
  showNextRound: boolean;
  showFinish: boolean;
  actionKey: string;
  loading: boolean;
  publishEvent: () => void;
  promoteWaitlist: () => Promise<void>;
  cancelEvent: () => void;
  roundReady: boolean;
  nextRound: () => Promise<void>;
  currentRound: number;
  allRoundsComplete: boolean;
  finishEvent: () => Promise<void>;
  activeTeams: EventTeam[];
  waitlistedTeams: EventTeam[];
  paidTeams: EventTeam[];
  checkedTeams: EventTeam[];
  teams: EventTeam[];
  showParticipantContacts: (team: EventTeam) => void;
  canCheckInTeam: (team: EventTeam) => boolean;
  canHistoricallyCheckIn: (team: EventTeam) => boolean;
  checkIn: (team: EventTeam, historical?: boolean) => void;
  mayOperatePrizes: boolean;
  prizeAwards: EventPrizeAward[];
  pendingPrizeReceipts: number;
  prizePoolEntries: { id: string; label: string; value: string }[];
  completedTeams: EventTeam[];
  choosePrizeTeam: (event: any) => void;
  selectedPrizeTeam: EventTeam | undefined;
  availablePrizeItems: InventoryItem[];
  choosePrizeItem: (event: any) => void;
  selectedPrizeItem: InventoryItem | undefined;
  prizeAwardName: string;
  prizeQuantity: number;
  issuePrize: () => Promise<void>;
  receivePrize: (award: EventPrizeAward) => void;
  roundOptions: number[];
  selectedRound: number;
  mayManageEvent: boolean;
  currentRoundMatches: EventMatch[];
  pairingOptions: string[];
  pairingLeftIndex: number;
  pairingRightIndex: number;
  pairingsEditable: boolean;
  correctPairings: () => void;
  visibleMatches: EventMatch[];
  teamName: (teamId: string | null) => string;
  canSubmitScore: (match: EventMatch) => boolean;
  canCorrectScore: (match: EventMatch) => boolean;
  score: (match: EventMatch) => void;
  correctScore: (match: EventMatch) => void;
}>();
const emit = defineEmits<{
  (event: "update:prizeAwardName", value: string): void;
  (event: "update:prizeQuantity", value: number): void;
  (event: "update:selectedRound", value: number): void;
  (event: "update:pairingLeftIndex", value: number): void;
  (event: "update:pairingRightIndex", value: number): void;
}>();
const {
  eventDetail,
  metrics,
  focusedRecord,
  statusLabel,
  workflowHint,
  showPublish,
  showPromoteWaitlist,
  showCancel,
  showNextRound,
  showFinish,
  actionKey,
  loading,
  publishEvent,
  promoteWaitlist,
  cancelEvent,
  roundReady,
  nextRound,
  currentRound,
  allRoundsComplete,
  finishEvent,
  activeTeams,
  waitlistedTeams,
  paidTeams,
  checkedTeams,
  teams,
  showParticipantContacts,
  canCheckInTeam,
  canHistoricallyCheckIn,
  checkIn,
  mayOperatePrizes,
  prizeAwards,
  pendingPrizeReceipts,
  prizePoolEntries,
  completedTeams,
  choosePrizeTeam,
  selectedPrizeTeam,
  availablePrizeItems,
  choosePrizeItem,
  selectedPrizeItem,
  issuePrize,
  receivePrize,
  roundOptions,
  mayManageEvent,
  currentRoundMatches,
  pairingOptions,
  pairingsEditable,
  correctPairings,
  visibleMatches,
  teamName,
  canSubmitScore,
  canCorrectScore,
  score,
  correctScore,
} = toRefs(props);
const prizeAwardName = computed({
  get: () => props.prizeAwardName,
  set: (value) => emit("update:prizeAwardName", value),
});
const prizeQuantity = computed({
  get: () => props.prizeQuantity,
  set: (value) => emit("update:prizeQuantity", value),
});
const selectedRound = computed({
  get: () => props.selectedRound,
  set: (value) => emit("update:selectedRound", value),
});
const pairingLeftIndex = computed({
  get: () => props.pairingLeftIndex,
  set: (value) => emit("update:pairingLeftIndex", value),
});
const pairingRightIndex = computed({
  get: () => props.pairingRightIndex,
  set: (value) => emit("update:pairingRightIndex", value),
});
</script>

<template>
  <view>
    <template v-if="eventDetail">
      <view class="metric-grid">
        <MetricCard
          v-for="item in metrics"
          :key="item[0]"
          :label="item[0]"
          :value="item[1]"
          :note="item[2]"
        />
      </view>

      <view
        :id="opsDeepLinkDomId('event-summary', eventDetail.id)"
        class="card event-summary"
        :class="{
          'deep-link-target':
            focusedRecord === `event-summary:${eventDetail.id}`,
        }"
      >
        <view class="row summary-top">
          <view class="summary-copy">
            <text class="event-title">{{ eventDetail.name }}</text>
            <text class="muted"
              >{{ eventDetail.code || "未显示赛事编码" }} ·
              {{ shortDate(eventDetail.startsAt) }}</text
            >
            <text class="muted"
              >固定双打 · 24人起赛 · 最多{{
                eventDetail.capacityPeople || 48
              }}人 · 五轮瑞士制</text
            >
          </view>
          <text
            class="status-badge"
            :class="eventDetail.status.toLowerCase()"
            >{{ statusLabel(eventDetail.status) }}</text
          >
        </view>
        <view class="workflow-hint">{{ workflowHint }}</view>
        <view
          v-if="
            showPublish ||
            showPromoteWaitlist ||
            showCancel ||
            showNextRound ||
            showFinish
          "
          class="event-actions"
        >
          <button
            v-if="showPublish"
            class="primary"
            :loading="actionKey === `publish:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="publishEvent"
          >
            发布赛事
          </button>
          <button
            v-if="showPromoteWaitlist"
            class="secondary"
            :loading="actionKey === `promote:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="promoteWaitlist"
          >
            重试候补晋级
          </button>
          <button
            v-if="showCancel"
            class="danger"
            :loading="actionKey === `cancel:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="cancelEvent"
          >
            取消赛事
          </button>
          <button
            v-if="showNextRound"
            class="primary"
            :loading="actionKey === `round:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey) || !roundReady"
            @tap="nextRound"
          >
            {{
              currentRound === 0 ? "生成首轮" : `生成第 ${currentRound + 1} 轮`
            }}
          </button>
          <button
            v-if="showFinish"
            class="primary"
            :loading="actionKey === `finish:${eventDetail.id}`"
            :disabled="loading || Boolean(actionKey) || !allRoundsComplete"
            @tap="finishEvent"
          >
            完成赛事
          </button>
        </view>
      </view>

      <view class="section-title">
        报名与签到
        <text class="section-note"
          >有效 {{ activeTeams.length }} · 候补 {{ waitlistedTeams.length }} ·
          已支付 {{ paidTeams.length }} · 已签到 {{ checkedTeams.length }}</text
        >
      </view>
      <view
        v-for="team in teams"
        :id="opsDeepLinkDomId('event-team', team.id)"
        :key="team.id"
        class="card team-row"
        :class="{
          'deep-link-target': focusedRecord === `event-team:${team.id}`,
        }"
      >
        <view class="team-copy">
          <view class="row team-heading"
            ><text class="team-name">{{ team.name }}</text
            ><text class="status-badge" :class="team.status.toLowerCase()">{{
              statusLabel(team.status)
            }}</text></view
          >
          <text class="muted"
            >{{ team.playerAName }} / {{ team.playerBName }} ·
            {{ team.category || "固定双打" }}</text
          >
          <button
            v-if="team.playerAPhone || team.playerBPhone"
            class="secondary"
            @tap="showParticipantContacts(team)"
          >
            查看选手联系方式
          </button>
          <text v-if="team.status === 'WAITLISTED'" class="team-stat"
            >候补不生成订单、不收费；按进入队列时间 FIFO 晋级。</text
          >
          <text
            v-else-if="team.status === 'REGISTERED' && team.paymentDueAt"
            class="team-stat"
            >支付保留至 {{ new Date(team.paymentDueAt).toLocaleString() }}</text
          >
          <text v-if="team.cancellationPending" class="team-stat warning"
            >队长已申请退出：{{
              team.cancelReason || "待补充原因"
            }}。退款待财务审批，当前保留席位并禁止签到。</text
          >
          <text
            v-else-if="
              team.status === 'PAID' &&
              team.cancelRequestedAt &&
              team.cancellationResolvedAt
            "
            class="team-stat warning"
            >退出退款未通过或已撤销，报名已恢复；如有疑问请联络财务。</text
          >
          <text
            v-else-if="
              ['CANCELLED', 'REFUNDED'].includes(team.status) &&
              team.cancelReason
            "
            class="team-stat"
            >退出原因：{{ team.cancelReason }} · 席位已释放。</text
          >
          <text v-if="currentRound > 0" class="team-stat"
            >{{ team.finalRank ? `第${team.finalRank}名 · ` : ""
            }}{{ team.points || 0 }} 分 · {{ team.wins || 0 }}胜{{
              team.losses || 0
            }}负 · 净胜分 {{ team.scoreDiff || 0 }}</text
          >
        </view>
        <button
          v-if="canCheckInTeam(team)"
          class="secondary inline"
          :loading="actionKey === `checkin:${team.id}`"
          :disabled="loading || Boolean(actionKey)"
          @tap="checkIn(team)"
        >
          签到
        </button>
        <button v-if="canHistoricallyCheckIn(team)" class="secondary inline" :disabled="loading || Boolean(actionKey)" @tap="checkIn(team, true)">历史补录</button>
      </view>
      <view v-if="!teams.length" class="empty card">该赛事尚无报名队伍</view>

      <template v-if="eventDetail.status === 'COMPLETED' && mayOperatePrizes">
        <view class="section-title">
          奖品出库与签收
          <text class="section-note"
            >已发 {{ prizeAwards.length }} 笔 · 待签收
            {{ pendingPrizeReceipts }} 笔</text
          >
        </view>
        <view class="card prize-pool-card">
          <text class="panel-title">本场奖池</text>
          <text v-if="!prizePoolEntries.length" class="muted"
            >尚未配置奖池；发放记录仍会保留当时的业务配置用于追溯。</text
          >
          <text
            v-for="entry in prizePoolEntries"
            :key="entry.id"
            class="prize-pool-line"
            >{{ entry.label }}：{{ entry.value }}</text
          >
        </view>
        <view class="card prize-form">
          <text class="panel-title">新增奖品发放</text>
          <view class="prize-field">
            <text class="field-label">获奖队伍</text>
            <picker
              :range="completedTeams"
              range-key="name"
              @change="choosePrizeTeam"
            >
              <view class="picker-value">{{
                selectedPrizeTeam
                  ? `第${selectedPrizeTeam.finalRank}名 · ${selectedPrizeTeam.name}`
                  : "请选择已完赛队伍"
              }}</view>
            </picker>
          </view>
          <view class="prize-field">
            <text class="field-label">库存 SKU</text>
            <picker
              :range="availablePrizeItems"
              range-key="name"
              @change="choosePrizeItem"
            >
              <view class="picker-value">{{
                selectedPrizeItem
                  ? `${selectedPrizeItem.name} · 库存 ${selectedPrizeItem.stock}`
                  : "没有可用库存"
              }}</view>
            </picker>
          </view>
          <view class="prize-inputs">
            <view class="prize-field"
              ><text class="field-label">奖项</text
              ><input
                v-model="prizeAwardName"
                class="text-input"
                maxlength="80"
                placeholder="如：冠军奖"
            /></view>
            <view class="prize-field quantity-field"
              ><text class="field-label">数量</text
              ><input
                v-model.number="prizeQuantity"
                class="text-input"
                type="number"
            /></view>
          </view>
          <button
            class="primary"
            :disabled="
              loading ||
              Boolean(actionKey) ||
              !selectedPrizeTeam ||
              !selectedPrizeItem
            "
            @tap="issuePrize"
          >
            确认出库并生成发放记录
          </button>
        </view>
        <view
          v-for="award in prizeAwards"
          :id="opsDeepLinkDomId('event-prize', award.id)"
          :key="award.id"
          class="card prize-award"
          :class="{
            'deep-link-target': focusedRecord === `event-prize:${award.id}`,
          }"
        >
          <view class="row prize-heading">
            <view
              ><text class="team-name">{{ award.awardName }}</text
              ><text class="muted"
                >第{{ award.finalRank }}名 · {{ award.team?.name }} ·
                {{ award.recipientNames.join(" / ") }}</text
              ></view
            >
            <text class="status-badge" :class="award.status.toLowerCase()">{{
              statusLabel(award.status)
            }}</text>
          </view>
          <text class="team-stat"
            >{{ award.inventoryItem?.sku }} · {{ award.inventoryItem?.name }} ×
            {{ award.quantity }} · 发放人
            {{ award.operator?.displayName || "已记录" }}</text
          >
          <text v-if="award.status === 'RECEIVED'" class="receipt-note"
            >签收人 {{ award.receivedByName }} · 经办
            {{ award.signedBy?.displayName || "已记录" }}</text
          >
          <button
            v-else
            class="secondary inline receipt-button"
            :disabled="loading || Boolean(actionKey)"
            @tap="receivePrize(award)"
          >
            登记签收
          </button>
        </view>
        <view v-if="!prizeAwards.length" class="empty card"
          >尚未发放奖品。发放会原子扣减库存并写入审计。</view
        >
      </template>

      <view class="round-heading">
        <view
          ><text class="section-title round-title">轮次与比分</text
          ><text class="section-note"
            >确认后纠错必须填写原因并留审计</text
          ></view
        >
        <scroll-view
          v-if="roundOptions.length"
          class="round-scroll"
          scroll-x
          enable-flex
        >
          <view class="round-tabs">
            <button
              v-for="round in roundOptions"
              :key="round"
              class="round-tab"
              :class="{ selected: selectedRound === round }"
              @tap="selectedRound = round"
            >
              第{{ round }}轮
            </button>
          </view>
        </scroll-view>
      </view>

      <view
        v-if="
          mayManageEvent &&
          selectedRound === currentRound &&
          currentRoundMatches.length
        "
        class="card pairing-correction"
      >
        <view
          ><text class="panel-title">配对异常处理</text
          ><text class="muted"
            >仅在本轮任何实际对阵尚未录分前，可选择两场互换第二支队伍；轮空也可参与互换。</text
          ></view
        >
        <view class="pairing-picker-grid">
          <picker
            :range="pairingOptions"
            :value="pairingLeftIndex"
            @change="pairingLeftIndex = Number(($event.detail as any).value)"
          >
            <view
              ><text class="field-label">对阵 A</text
              ><view class="picker-value"
                >{{ pairingOptions[pairingLeftIndex] || "请选择" }} ›</view
              ></view
            >
          </picker>
          <picker
            :range="pairingOptions"
            :value="pairingRightIndex"
            @change="pairingRightIndex = Number(($event.detail as any).value)"
          >
            <view
              ><text class="field-label">对阵 B</text
              ><view class="picker-value"
                >{{ pairingOptions[pairingRightIndex] || "请选择" }} ›</view
              ></view
            >
          </picker>
        </view>
        <button
          class="secondary pairing-button"
          :loading="actionKey === `pairings:${eventDetail.id}:${currentRound}`"
          :disabled="
            loading ||
            Boolean(actionKey) ||
            !pairingsEditable ||
            pairingLeftIndex === pairingRightIndex
          "
          @tap="correctPairings"
        >
          互换对手并留审计
        </button>
        <text v-if="!pairingsEditable" class="correction-note"
          >本轮已有实际比分或确认动作，配对已锁定；后续只能走比分纠错。</text
        >
      </view>

      <view
        v-for="match in visibleMatches"
        :id="opsDeepLinkDomId('event-match', match.id)"
        :key="match.id"
        class="card match-card"
        :class="{
          'deep-link-target': focusedRecord === `event-match:${match.id}`,
        }"
      >
        <view class="row match-heading"
          ><text class="court-label"
            >第 {{ match.round }} 轮 ·
            {{ match.courtLabel || "待分配场地" }}</text
          ><text class="status-badge" :class="match.status.toLowerCase()">{{
            statusLabel(match.status)
          }}</text></view
        >
        <view class="score-line">
          <text class="match-team">{{ teamName(match.teamAId) }}</text>
          <view class="score-block">
            <text class="final-score"
              >{{ match.scoreA ?? match.startingScoreA }} :
              {{ match.scoreB ?? match.startingScoreB }}</text
            >
            <text class="starting-score"
              >起始分 {{ match.startingScoreA }} :
              {{ match.startingScoreB }}</text
            >
          </view>
          <text class="match-team right">{{ teamName(match.teamBId) }}</text>
        </view>
        <text v-if="match.correctionReason" class="correction-note"
          >最近纠错：{{ match.correctionReason }}</text
        >
        <view
          v-if="canSubmitScore(match) || canCorrectScore(match)"
          class="match-actions"
        >
          <button
            v-if="canSubmitScore(match)"
            class="primary inline"
            :loading="actionKey === `score:${match.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="score(match)"
          >
            录入比分
          </button>
          <button
            v-if="canCorrectScore(match)"
            class="secondary inline"
            :loading="actionKey === `correct:${match.id}`"
            :disabled="loading || Boolean(actionKey)"
            @tap="correctScore(match)"
          >
            纠错
          </button>
        </view>
      </view>
      <view v-if="currentRound === 0" class="empty card">尚未生成首轮对阵</view>
      <view v-else-if="!visibleMatches.length" class="empty card"
        >第 {{ selectedRound }} 轮没有对阵记录，请刷新或检查赛事数据</view
      >

      <view class="card boundary">
        <text class="boundary-title">操作边界</text>
        <text class="muted"
          >前台负责签到、未确认比分和库存实物经办；赛事管理员及管理员可以发布、生成轮次、纠错和完赛。奖品只能在完赛后发放，出库即原子扣减库存，签收另留操作者和审计证据。</text
        >
      </view>
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
