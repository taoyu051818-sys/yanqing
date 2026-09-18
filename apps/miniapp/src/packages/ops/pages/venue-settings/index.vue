<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../components/OperationsFrame.vue'
import ActionDialog from '../../../../components/ActionDialog.vue'
import { hourLabel, usages, useVenueSettings } from './use-settings'
const { session, allowed, data, form, loading, saving, error, courtError, court, confirmation, load, confirmSave, save, editCourt, saveCourt } = useVenueSettings()
const starts = Array.from({ length: 24 }, (_, i) => hourLabel(i))
const ends = Array.from({ length: 24 }, (_, i) => hourLabel(i + 1))
const zones = [{ value: 'EAST', label: '东区' }, { value: 'WEST', label: '西区' }, { value: 'SOUTH', label: '南区' }, { value: 'NORTH', label: '北区' }] as const
const openPrices = () => uni.navigateTo({ url: '/packages/ops/pages/venue/index?view=pricing' })
onShow(async () => { await session.hydrate(); if (allowed.value) void load(Boolean(data.value)) })
</script>
<template>
  <OperationsFrame title="球馆设置" eyebrow="场馆管理" description="维护公开资料、营业时间、场地及收费" role="管理员" access="venueSettings" icon="venue" :venue="data?.name" :shift="data && data.opensAtHour != null && data.closesAtHour != null ? `${hourLabel(data.opensAtHour)}–${hourLabel(data.closesAtHour)}` : '营业时间待配置'">
    <view v-if="loading" class="card state">正在加载球馆设置…</view>
    <view v-if="error && !confirmation" class="card error" role="alert"><text>{{ error }}</text><button class="secondary" :disabled="saving" @tap="load()">重新加载</button></view>
    <template v-if="data && !loading">
      <view class="section-title">球馆信息</view>
      <view class="card fields">
        <label for="venue-name">球馆名称</label><input id="venue-name" v-model="form.name" :disabled="saving" :maxlength="80" placeholder="填写球馆名称" />
        <label for="venue-address">详细地址</label><textarea id="venue-address" v-model="form.address" :disabled="saving" :maxlength="300" placeholder="街道、门牌号及楼层" />
        <label for="venue-phone">球馆联系电话</label><input id="venue-phone" v-model="form.contactPhone" :disabled="saving" :maxlength="40" placeholder="填写对外联系电话（选填）" />
        <text class="muted">地图位置（选填）：填写腾讯地图 / 高德地图的 GCJ-02 经纬度，保存后会员可点击导航。</text>
        <label for="venue-latitude">纬度</label><input id="venue-latitude" v-model="form.latitude" :disabled="saving" :maxlength="20" placeholder="例如 40.45" />
        <label for="venue-longitude">经度</label><input id="venue-longitude" v-model="form.longitude" :disabled="saving" :maxlength="20" placeholder="例如 115.97" />
      </view>
      <view class="section-title">每日营业时间</view>
      <view class="card fields">
        <text class="muted">每格1小时，按整点设置；结束时间可选24:00。修改后会员只能预约营业时间内的场次，已生成订单保留。</text>
        <picker :range="starts" :value="form.opensAtHour" :disabled="saving" @change="form.opensAtHour = Number($event.detail.value)"><view class="choice">开始营业 <text>{{ hourLabel(form.opensAtHour) }} ›</text></view></picker>
        <picker :range="ends" :value="form.closesAtHour - 1" :disabled="saving" @change="form.closesAtHour = Number($event.detail.value) + 1"><view class="choice">结束营业 <text>{{ hourLabel(form.closesAtHour) }} ›</text></view></picker>
        <text class="muted">新增营业时段需要配置价格；未配置价格的时段会显示“未定价”，不会按0元出售。</text>
        <button class="primary" :disabled="saving" @tap="confirmSave">保存球馆信息与营业时间</button>
      </view>
      <view class="section-title">场地管理</view>
      <view class="card fields">
        <text>开放 {{ data.courts.filter(c => c.enabled).length }} 片 · 共 {{ data.courts.length }} 片</text>
        <text class="muted">通过新增或停用调整开放数量。停用后停止新预约，原有订单不会删除，请安排好已预约会员。</text>
        <button class="secondary" :disabled="saving" @tap="editCourt()">新增场地</button>
        <button v-for="item in data.courts" :key="item.id" class="court-row" :disabled="saving" @tap="editCourt(item)"><view><text>{{ item.name }}</text><text class="muted">{{ item.code }} · {{ usages.find(u => u.value === item.usage)?.label }}</text></view><text>{{ item.enabled ? '开放' : '已停用' }} · 编辑 ›</text></button>
      </view>
      <view class="section-title">场地收费</view>
      <view class="card fields"><text>按时段、星期及生效日期设置价格</text><text class="muted">价格规则需启用后才生效，历史订单金额保留。</text><button class="secondary" @tap="openPrices">管理场地价格</button></view>
    </template>
    <ActionDialog v-if="confirmation" title="确认保存球馆设置" :busy="saving" @close="confirmation = false">
      <view class="fields"><text>{{ form.name }}</text><text>每日 {{ hourLabel(form.opensAtHour) }}–{{ hourLabel(form.closesAtHour) }}</text><text class="muted">公开资料会同步到首页和订场页。营业范围外停止新预约，历史订单保留。</text><text v-if="error" class="error" role="alert">{{ error }}</text></view>
      <template #footer><button class="secondary" :disabled="saving" @tap="confirmation = false">返回修改</button><button class="primary" :loading="saving" :disabled="saving" @tap="save">确认保存</button></template>
    </ActionDialog>
    <ActionDialog v-if="court" :title="court.id ? '编辑场地' : '新增场地'" :busy="saving" @close="court = null">
      <view class="fields">
        <label for="court-name">场地名称</label><input id="court-name" v-model="court.name" :disabled="saving" :maxlength="40" placeholder="例如 1号场" />
        <template v-if="!court.id"><label for="court-code">场地编号（不能重复）</label><input id="court-code" v-model="court.code" :disabled="saving" :maxlength="32" placeholder="例如 C21" /><picker :range="zones.map(z => z.label)" :disabled="saving" @change="court.zone = zones[Number($event.detail.value)].value"><view class="choice">所在区域 <text>{{ zones.find(z => z.value === court?.zone)?.label }} ›</text></view></picker></template>
        <picker :range="usages.map(u => u.label)" :value="usages.findIndex(u => u.value === court?.usage)" :disabled="saving" @change="court.usage = usages[Number($event.detail.value)].value"><view class="choice">用途 <text>{{ usages.find(u => u.value === court?.usage)?.label }} ›</text></view></picker>
        <label for="court-sort">显示顺序</label><input id="court-sort" v-model.number="court.sortOrder" :disabled="saving" type="number" />
        <view class="choice"><text>开放场地</text><switch :checked="court.enabled" :disabled="saving" color="#17653d" @change="court.enabled = ($event as any).detail.value" /></view>
        <text class="muted">保存后影响后续预约。停用、改用途不自动取消已有订单。</text><text v-if="courtError" class="error" role="alert">{{ courtError }}</text>
      </view>
      <template #footer><button class="secondary" :disabled="saving" @tap="court = null">取消</button><button class="primary" :loading="saving" :disabled="saving" @tap="saveCourt">确认保存</button></template>
    </ActionDialog>
  </OperationsFrame>
</template>
<style scoped>
.fields { display:grid; gap:18rpx; }
.fields label { font-size:27rpx; font-weight:650; }
.fields input,.fields textarea { width:100%; box-sizing:border-box; border:1rpx solid var(--color-border); border-radius:14rpx; background:var(--color-background); padding:20rpx; font-size:28rpx; }
.fields input { min-height:88rpx; height:88rpx; }
.fields textarea { height:150rpx; }
.fields button { width:100%; margin:0; min-height:88rpx; }
.choice { display:flex; justify-content:space-between; gap:18rpx; align-items:center; min-height:88rpx; font-size:28rpx; }
.choice>text:last-child { color:var(--color-primary); }
.court-row { display:flex; align-items:center; justify-content:space-between; gap:16rpx; background:var(--color-background); padding:20rpx; text-align:left; font-size:25rpx; }
.court-row>view { flex:1; min-width:0; }
.court-row text { display:block; overflow-wrap:anywhere; }
.error { color:var(--color-destructive,#a52626); line-height:1.6; }
.state { margin-top:24rpx; }
</style>
