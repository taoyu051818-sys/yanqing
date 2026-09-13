<script setup lang="ts">
import { toRefs } from "vue";
import type { GameListItem } from "../../../types/game";
import AppIcon from "../../../components/AppIcon.vue";
import SectionEmpty from "../../../components/SectionEmpty.vue";
import StatusBadge from "../../../components/StatusBadge.vue";
import { money, shortDate } from "../../../utils/format";
import {
  gameDetailPath,
  gameLevelLabel as displayGameLevel,
} from "../../../utils/game-detail";
import { openMemberPage } from "../../../utils/member-navigation";

const props = defineProps<{
  tab: "games" | "events";
  visibleGames: GameListItem[];
  displayRegistrationStatus: (status?: string) => string;
  errorMessage: string;
  view: "browse" | "mine";
}>();
const { tab, visibleGames, displayRegistrationStatus, errorMessage, view } =
  toRefs(props);
</script>

<template>
  <view>
    <template v-if="tab === 'games'">
      <view v-for="game in visibleGames" :key="game.id" class="card activity">
        <view class="row"
          ><StatusBadge :value="game.status" /><text class="muted">{{
            shortDate(game.startsAt)
          }}</text></view
        >
        <view class="activity-title-row"
          ><view class="activity-icon"><AppIcon name="sport" :size="32" /></view
          ><text class="title">{{ game.title }}</text></view
        >
        <text class="muted"
          >主理人 {{ game.host?.displayName || "待显示" }} ·
          {{ displayGameLevel(game.level) }} ·
          {{ game._count?.registrations || 0 }}/{{ game.capacity }} 人</text
        >
        <text v-if="game.myRegistration" class="game-list-status"
          >我的报名：{{
            displayRegistrationStatus(game.myRegistration.status)
          }}</text
        >
        <view class="activity-summary">
          <text class="money">{{ money(game.feeCents) }} / 人</text>
          <button
            class="secondary"
            @tap="openMemberPage(gameDetailPath(game.id))"
          >
            查看球局详情<AppIcon name="chevron" :size="28" />
          </button>
        </view>
      </view>
      <SectionEmpty
        v-if="!visibleGames.length && !errorMessage"
        icon="sport"
        :title="view === 'mine' ? '还没有球局报名' : '暂无开放球局'"
        description="可以切换活动类型，或改天再来看看。"
      />
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
