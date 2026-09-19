<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import BusinessSection from '../../components/BusinessSection.vue'
import InfoRow from '../../components/InfoRow.vue'
import { onLoad, onShow } from '@dcloudio/uni-app'
import OperationsFrame from '../../components/OperationsFrame.vue'
import ActionDialog from '../../../../components/ActionDialog.vue'
import { mutationCommitted } from './use-mutation'
import { useVenueLocation } from './use-location'
import AppIcon from '../../../../components/AppIcon.vue'
import { hourLabel, usages, useVenueSettings } from './use-settings'
const { session, allowed, data, form, loading, saving, error, courtError, courtConflict, court, confirmation, load, resetForm, confirmSave, save, editCourt, reloadCourt, saveCourt, deletingCourt, confirmDeleteCourt, deleteCourt } = useVenueSettings()
const starts = Array.from({ length: 24 }, (_, i) => hourLabel(i))
const ends = Array.from({ length: 24 }, (_, i) => hourLabel(i + 1))
const zones = [{ value: 'EAST', label: '东区' }, { value: 'WEST', label: '西区' }, { value: 'SOUTH', label: '南区' }, { value: 'NORTH', label: '北区' }] as const
const openPrices = () => uni.navigateTo({ url: '/packages/ops/pages/venue/index?view=pricing' })
const view = ref('profile'), courtId = ref('')
const selectedCourt = computed(() => data.value?.courts.find(item => item.id === courtId.value))
const editing = ref<'profile' | 'contact' | 'hours' | null>(null)
const { choosing, hasLocation, locationMessage, chooseLocation, useTextAddress, changeAddress, resetLocationRequest } = useVenueLocation(form, () => allowed.value && !saving.value && editing.value === 'profile')
const courtQuery = ref(''), courtFilter = ref('all')
const filteredCourts = computed(() => (data.value?.courts || []).filter(item => `${item.name} ${item.code}`.includes(courtQuery.value.trim()) && (courtFilter.value === 'all' || item.enabled === (courtFilter.value === 'enabled'))))
const editTitles = { profile:'修改球馆信息', contact:'修改联系方式', hours:'修改营业时间' }
function setTitle() { uni.setNavigationBarTitle({ title: editing.value ? editTitles[editing.value] : courtId.value ? '场地详情' : view.value === 'courts' ? '场地管理' : '球馆信息' }) }
function beginEdit(section: 'profile' | 'contact' | 'hours') { resetLocationRequest(); resetForm(); editing.value = section; setTitle(); void nextTick(() => uni.pageScrollTo({ scrollTop:0, duration:0 })) }
function cancelEdit() { if (saving.value || choosing.value) return; resetLocationRequest(); resetForm(); editing.value = null; setTitle() }
async function submit() { if (mutationCommitted(await save())) { editing.value = null; setTitle() } }
function openCourts() { uni.navigateTo({ url:'/packages/ops/pages/venue-settings/index?view=courts' }) }
function openCourt(id: string) { uni.navigateTo({ url: '/packages/ops/pages/venue-settings/index?view=courts&courtId=' + encodeURIComponent(id) }) }
async function removeCourt() { if ((await deleteCourt()) === 'saved') uni.navigateBack({ fail: () => uni.redirectTo({ url: '/packages/ops/pages/venue-settings/index?view=courts' }) }) }
watch(allowed, value => { if (!value) { resetLocationRequest(); editing.value = null } })
onLoad(options => { courtId.value = options?.courtId ? String(options.courtId) : ''; view.value = options?.view === 'courts' ? 'courts' : 'profile'; setTitle() })
onShow(async () => { await session.hydrate(); if (allowed.value) void load(Boolean(editing.value)) })
</script>
<template>
  <OperationsFrame compact title="球馆信息" eyebrow="" description="" role="管理员" access="venueSettings">
    <view v-if="loading" class="card state">正在加载…</view>
    <view v-if="error && !confirmation" class="card error" role="alert"><text>{{ error }}</text><button v-if="!editing" class="secondary" :disabled="saving" @tap="load()">重新加载</button></view>
    <template v-if="data && !loading">
      <template v-if="editing">
        <BusinessSection :title="editTitles[editing]">
          <view class="fields edit-fields">
            <template v-if="editing === 'profile'">
              <label for="venue-name">球馆名称</label><input id="venue-name" v-model="form.name" :disabled="saving" :maxlength="80" placeholder="填写球馆名称" />
              <label for="venue-address">球馆地址</label><textarea id="venue-address" :value="form.address" :disabled="saving || choosing" :maxlength="300" placeholder="直接填写，例如：延庆区某街道金羽球馆" @input="changeAddress(($event as any).detail.value)" />
              <view class="location-panel">
                <view class="location-heading"><AppIcon name="venue" :size="36" /><text>{{ hasLocation ? '已设置导航位置' : '地图定位（选填）' }}</text></view>
                <text class="muted">{{ hasLocation ? '会员可在球馆信息中点击地图导航。' : '可以只填文字地址；选择地图位置后，会员可一键导航。' }}</text>
                <button class="secondary" :disabled="saving || choosing" :loading="choosing" @tap="chooseLocation">{{ hasLocation ? '重新选择位置' : '地图选点' }}</button>
                <button v-if="hasLocation" class="text-address" :disabled="saving || choosing" @tap="useTextAddress">清除定位，仅保留文字地址</button>
                <text v-if="locationMessage" class="location-message" role="status">{{ locationMessage }}</text>
              </view>
            </template>
            <template v-else-if="editing === 'contact'"><label for="venue-phone">球馆联系电话</label><input id="venue-phone" v-model="form.contactPhone" :disabled="saving" :maxlength="40" placeholder="填写对外联系电话" /></template>
            <template v-else>
              <picker :range="starts" :value="form.opensAtHour" :disabled="saving" @change="form.opensAtHour = Number($event.detail.value)"><view class="choice">开始营业 <text>{{ hourLabel(form.opensAtHour) }} ›</text></view></picker>
              <picker :range="ends" :value="form.closesAtHour - 1" :disabled="saving" @change="form.closesAtHour = Number($event.detail.value) + 1"><view class="choice">结束营业 <text>{{ hourLabel(form.closesAtHour) }} ›</text></view></picker>
              <text class="muted">每天按整点营业，每格1小时。已有订单保留；新增时段需另行定价后才能预约。</text>
            </template>
          </view>
        </BusinessSection>
        <view class="footer-space"><view class="page-footer"><button class="secondary" :disabled="saving || choosing" @tap="cancelEdit">取消</button><button class="primary" :disabled="saving || choosing" @tap="confirmSave">保存修改</button></view></view>
      </template>
      <template v-else-if="courtId">
        <template v-if="selectedCourt">
          <BusinessSection title="场地信息"><InfoRow label="场地名称" :value="selectedCourt.name" /><InfoRow label="场地编号" :value="selectedCourt.code" /><InfoRow label="所在区域" :value="zones.find(z => z.value === selectedCourt?.zone)?.label" /></BusinessSection>
          <BusinessSection title="预约设置"><InfoRow label="用途" :value="usages.find(u => u.value === selectedCourt?.usage)?.label" /><InfoRow label="开放状态" :value="selectedCourt.enabled ? '开放' : '已停用'" /><InfoRow label="显示顺序" :value="selectedCourt.sortOrder" /></BusinessSection>
          <view class="footer-space"><view class="page-footer"><button class="danger" :disabled="saving" @tap="confirmDeleteCourt(selectedCourt)">删除场地</button><button class="primary" :disabled="saving" @tap="editCourt(selectedCourt)">编辑场地</button></view></view>
        </template>
        <view v-else class="card empty">场地不存在或已删除<button class="secondary" @tap="openCourts">返回场地列表</button></view>
      </template>
      <template v-else-if="view === 'courts'">
        <view class="court-search"><input v-model="courtQuery" placeholder="搜索场地名称或编号" /><picker :range="['全部场地','开放场地','停用场地']" @change="courtFilter = ['all','enabled','disabled'][Number($event.detail.value)]"><view class="filter">{{ courtFilter === 'all' ? '全部' : courtFilter === 'enabled' ? '开放' : '停用' }} ▾</view></picker></view>
        <BusinessSection :title="`场地列表 · ${filteredCourts.length}片`"><button v-for="item in filteredCourts" :key="item.id" class="court-row" @tap="openCourt(item.id)"><view><text class="court-name">{{ item.name }}</text><text class="muted">{{ item.code }} · {{ usages.find(u => u.value === item.usage)?.label }}</text></view><view class="court-status"><text>{{ item.enabled ? '开放' : '已停用' }}</text><text class="muted">详情 ›</text></view></button><view v-if="!filteredCourts.length" class="empty">没有匹配的场地</view></BusinessSection>
        <view class="footer-space"><view class="page-footer"><button class="primary" @tap="editCourt()">新增场地</button></view></view>
      </template>
      <template v-else>
        <BusinessSection title="球馆信息" action="修改球馆信息" @action="beginEdit('profile')"><InfoRow label="球馆名称" :value="data.name" /><InfoRow label="球馆地址" :value="data.address" /><InfoRow label="导航位置" :value="data.latitude == null || data.longitude == null ? '仅文字地址' : '已设置地图位置'" /></BusinessSection>
        <BusinessSection title="联系信息" action="修改联系方式" @action="beginEdit('contact')"><InfoRow label="联系电话" :value="data.contactPhone" /></BusinessSection>
        <BusinessSection title="营业设置" action="修改营业时间" @action="beginEdit('hours')"><InfoRow label="营业时间" :value="data.opensAtHour == null || data.closesAtHour == null ? '未设置' : `每日 ${hourLabel(data.opensAtHour)}–${hourLabel(data.closesAtHour)}`" /><InfoRow label="场地管理" :value="`开放 ${data.courtCount} / 共 ${data.courts.length}片`" link @select="openCourts" /><InfoRow label="场地价格" value="查看及设置" link @select="openPrices" /></BusinessSection>
      </template>
    </template>
    <ActionDialog v-if="confirmation" title="确认保存球馆设置" :busy="saving" @close="confirmation = false">
      <view class="fields"><text>{{ form.name }}</text><template v-if="editing === 'profile'"><text>{{ form.address || '暂未填写地址' }}</text><text>{{ hasLocation ? '已设置地图位置' : '仅保存文字地址' }}</text></template><text v-else-if="editing === 'contact'">{{ form.contactPhone || '暂未填写电话' }}</text><text v-else>每日 {{ hourLabel(form.opensAtHour) }}–{{ hourLabel(form.closesAtHour) }}</text><text class="muted">{{ editing === 'hours' ? '营业范围外停止新预约，历史订单保留。' : '公开资料会同步到首页和订场页。' }}</text><text v-if="error" class="error" role="alert">{{ error }}</text></view>
      <template #footer><button class="secondary" :disabled="saving" @tap="confirmation = false">返回修改</button><button class="primary" :loading="saving" :disabled="saving" @tap="submit">确认保存</button></template>
    </ActionDialog>
    <ActionDialog v-if="deletingCourt" title="删除场地" :busy="saving" @close="deletingCourt = null">
      <view class="fields"><text>确认删除「{{ deletingCourt.name }}」？</text><text class="muted">删除后不再显示在场地列表，也不能新增预约。已有订单和记录保留，已预约订单仍需正常履约；临时无法使用可改为停用。</text><text v-if="courtError" class="error" role="alert">{{ courtError }}</text></view>
      <template #footer><button class="secondary" :disabled="saving" @tap="deletingCourt = null">取消</button><button class="danger" :loading="saving" :disabled="saving" @tap="removeCourt">确认删除</button></template>
    </ActionDialog>
    <ActionDialog v-if="court" :title="court.id ? '编辑场地' : '新增场地'" :busy="saving" @close="court = null">
      <view class="fields">
        <label for="court-name">场地名称</label><input id="court-name" v-model="court.name" :disabled="saving" :maxlength="40" placeholder="例如 1号场" />
        <label for="court-code">场地编号（不能重复）</label><input id="court-code" v-model="court.code" :disabled="saving" :maxlength="32" placeholder="例如 C21" /><picker :range="zones.map(z => z.label)" :value="zones.findIndex(z => z.value === court?.zone)" :disabled="saving" @change="court.zone = zones[Number($event.detail.value)].value"><view class="choice">所在区域 <text>{{ zones.find(z => z.value === court?.zone)?.label }} ›</text></view></picker>
        <picker :range="usages.map(u => u.label)" :value="usages.findIndex(u => u.value === court?.usage)" :disabled="saving" @change="court.usage = usages[Number($event.detail.value)].value"><view class="choice">用途 <text>{{ usages.find(u => u.value === court?.usage)?.label }} ›</text></view></picker>
        <label for="court-sort">显示顺序</label><input id="court-sort" v-model.number="court.sortOrder" :disabled="saving" type="number" />
        <view class="choice"><text>开放场地</text><switch :checked="court.enabled" :disabled="saving" color="#17653d" @change="court.enabled = ($event as any).detail.value" /></view>
        <text class="muted">保存后影响后续预约。停用、改用途不自动取消已有订单。</text><text v-if="courtError" class="error" role="alert">{{ courtError }}</text>

      </view>
      <template #footer><text v-if="courtConflict" class="muted">重新加载将放弃本次修改，请核对最新信息。</text><button class="secondary" :disabled="saving" @tap="court = null">取消</button><button v-if="courtConflict" class="primary" :loading="loading" :disabled="saving || loading" @tap="reloadCourt">重新加载场地</button><button v-else class="primary" :loading="saving" :disabled="saving || loading" @tap="saveCourt">确认保存</button></template>
    </ActionDialog>
  </OperationsFrame>
</template>
<style scoped>
.location-panel { display:grid; gap:18rpx; padding:24rpx; background:var(--color-surface-subtle); border:1rpx solid var(--color-border); border-radius:16rpx; }
.location-heading { display:flex; align-items:center; gap:12rpx; font-size:28rpx; font-weight:600; }
.text-address { background:transparent; color:var(--color-primary); font-size:26rpx; }
.text-address::after { border:0; }
.location-message { color:var(--color-muted); font-size:26rpx; line-height:1.6; }
.danger { background:#fff1f0; color:#b42318; }
.edit-fields { padding:28rpx; }
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
.page-footer { position:fixed; bottom:0; left:0; right:0; z-index:30; display:flex; gap:20rpx; padding:20rpx 24rpx calc(20rpx + env(safe-area-inset-bottom)); background:#fff; border-top:1rpx solid #e9ecef; }
.page-footer button { flex:1; margin:0; min-height:88rpx; font-size:28rpx; }
.footer-space { height:calc(150rpx + env(safe-area-inset-bottom)); }
.court-row { width:100%; border-radius:0; background:#fff; margin:0; border-bottom:1rpx solid #edf0f2; padding:28rpx; font-size:28rpx; }
.court-row::after { border:0; }.court-row:last-child { border-bottom:0; }
.court-row .court-status { flex:0 0 auto; text-align:right; color:#17653d; }
.court-name { font-size:30rpx; font-weight:600; margin-bottom:8rpx; }
.court-search { display:flex; align-items:center; gap:16rpx; background:#fff; border-radius:16rpx; padding:0 24rpx; margin-top:16rpx; }
.court-search input { flex:1; min-width:0; height:96rpx; font-size:28rpx; }
.filter { min-height:96rpx; display:flex; align-items:center; color:#17653d; font-size:26rpx; }
.empty { padding:32rpx; text-align:center; color:#727982; }
</style>
