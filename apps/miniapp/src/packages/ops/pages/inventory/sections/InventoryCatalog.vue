<script setup lang="ts">
import { toRefs, computed } from "vue";
import { money } from "../../../../../utils/format";
import { opsDeepLinkDomId } from "../../../../../utils/work-item-deep-link";
import type { Tab, MasterType } from "../page-types.js";

const props = defineProps<{
  errorMessage: string;
  tab: Tab;
  masterType: MasterType;
  selectMasterType: (value: MasterType) => void;
  masterSearch: string;
  masterStatus: "ALL" | "ACTIVE" | "DISABLED";
  isAdmin: boolean;
  saving: boolean;
  openMasterForm: (record?: any) => void;
  showMasterForm: boolean;
  editingMaster: any;
  masterForm: any;
  supplierNames: string[];
  activeSuppliers: any[];
  suppliers: any[];
  locationNames: string[];
  activeLocations: any[];
  locations: any[];
  submitMasterForm: () => Promise<any>;
  masterRecords: any[];
  focusedRecord: string;
  detailId: string;
  loadMasterDetail: (record: any) => Promise<void>;
  toggleMasterStatus: (record: any) => void;
  masterDetail: any;
  loading: boolean;
}>();
const emit = defineEmits<{
  (event: "update:masterSearch", value: string): void;
  (event: "update:masterStatus", value: "ALL" | "ACTIVE" | "DISABLED"): void;
  (event: "update:showMasterForm", value: boolean): void;
}>();
const {
  errorMessage,
  tab,
  masterType,
  selectMasterType,
  isAdmin,
  saving,
  openMasterForm,
  editingMaster,
  masterForm,
  supplierNames,
  activeSuppliers,
  suppliers,
  locationNames,
  activeLocations,
  locations,
  submitMasterForm,
  masterRecords,
  focusedRecord,
  detailId,
  loadMasterDetail,
  toggleMasterStatus,
  masterDetail,
  loading,
} = toRefs(props);
const masterSearch = computed({
  get: () => props.masterSearch,
  set: (value) => emit("update:masterSearch", value),
});
const masterStatus = computed({
  get: () => props.masterStatus,
  set: (value) => emit("update:masterStatus", value),
});
const showMasterForm = computed({
  get: () => props.showMasterForm,
  set: (value) => emit("update:showMasterForm", value),
});
</script>

<template>
  <view>
    <template v-if="!errorMessage && tab === 'MASTER'">
      <view class="master-toolbar">
        <view class="master-kind-row">
          <button
            v-for="entry in [
              ['ITEM', 'SKU'],
              ['SUPPLIER', '供应商'],
              ['LOCATION', '库位'],
            ]"
            :key="entry[0]"
            class="kind-button"
            :class="{ active: masterType === entry[0] }"
            @tap="selectMasterType(entry[0] as MasterType)"
          >
            {{ entry[1] }}
          </button>
        </view>
        <input
          v-model="masterSearch"
          class="field search-field"
          placeholder="按编码、名称或分类搜索"
        />
        <view class="status-filter-row">
          <button
            v-for="entry in [
              ['ALL', '全部'],
              ['ACTIVE', '启用'],
              ['DISABLED', '停用'],
            ]"
            :key="entry[0]"
            class="filter-button"
            :class="{ active: masterStatus === entry[0] }"
            @tap="masterStatus = entry[0] as any"
          >
            {{ entry[1] }}
          </button>
        </view>
        <button
          v-if="isAdmin"
          class="primary create"
          :disabled="saving"
          @tap="openMasterForm()"
        >
          新增{{
            masterType === "ITEM"
              ? "SKU"
              : masterType === "SUPPLIER"
                ? "供应商"
                : "库位"
          }}
        </button>
        <text v-else class="readonly-note"
          >当前身份为只读，可查看状态、关联对象与历史上下文。</text
        >
      </view>

      <view v-if="showMasterForm" class="card master-form">
        <view class="row">
          <text class="title"
            >{{ editingMaster ? "编辑" : "新增"
            }}{{
              masterType === "ITEM"
                ? "SKU"
                : masterType === "SUPPLIER"
                  ? "供应商"
                  : "库位"
            }}</text
          >
          <button class="link-button" @tap="showMasterForm = false">
            取消
          </button>
        </view>

        <template v-if="masterType === 'ITEM'">
          <text class="field-label">SKU 编码</text>
          <input
            v-model="masterForm.sku"
            class="field"
            placeholder="例如 BALL-002"
          />
          <text class="field-label">商品名称</text>
          <input
            v-model="masterForm.name"
            class="field"
            placeholder="商品名称"
          />
          <text class="field-label">分类</text>
          <input
            v-model="masterForm.category"
            class="field"
            placeholder="羽毛球 / 手胶 / 饮品"
          />
          <text class="field-label">经营模式</text>
          <view class="choice-row">
            <button
              class="choice"
              :class="{ active: masterForm.mode === 'PURCHASE' }"
              @tap="masterForm.mode = 'PURCHASE'"
            >
              自营
            </button>
            <button
              class="choice"
              :class="{ active: masterForm.mode === 'CONSIGNMENT' }"
              @tap="masterForm.mode = 'CONSIGNMENT'"
            >
              代销
            </button>
          </view>
          <text class="field-label">供应商</text>
          <picker
            mode="selector"
            :range="supplierNames"
            @change="
              masterForm.supplierId =
                activeSuppliers[Number(($event as any).detail.value)]?.id
            "
            ><view class="picker-field">{{
              suppliers.find((entry) => entry.id === masterForm.supplierId)
                ?.name || "请选择供应商"
            }}</view></picker
          >
          <text class="field-label">默认库位</text>
          <picker
            mode="selector"
            :range="locationNames"
            @change="
              masterForm.defaultLocationId =
                activeLocations[Number(($event as any).detail.value)]?.id
            "
            ><view class="picker-field">{{
              locations.find(
                (entry) => entry.id === masterForm.defaultLocationId,
              )?.name || "请选择库位"
            }}</view></picker
          >
          <view class="field-grid">
            <view
              ><text class="field-label">进价（元）</text
              ><input
                v-model="masterForm.purchasePriceYuan"
                class="field"
                type="digit"
            /></view>
            <view
              ><text class="field-label">售价（元）</text
              ><input
                v-model="masterForm.salePriceYuan"
                class="field"
                type="digit"
            /></view>
          </view>
          <view class="field-grid">
            <view
              ><text class="field-label">安全库存</text
              ><input
                v-model="masterForm.safeStock"
                class="field"
                type="number"
            /></view>
            <view
              ><text class="field-label">默认批次</text
              ><input v-model="masterForm.batchCode" class="field"
            /></view>
          </view>
          <text class="field-label">效期（可空，YYYY-MM-DD）</text>
          <input
            v-model="masterForm.expiresAt"
            class="field"
            placeholder="2027-12-31"
          />
        </template>

        <template v-else-if="masterType === 'SUPPLIER'">
          <text class="field-label">供应商编码</text>
          <input
            v-model="masterForm.code"
            class="field"
            placeholder="例如 VENDOR-001"
          />
          <text class="field-label">供应商名称</text>
          <input v-model="masterForm.name" class="field" />
          <text class="field-label">合作属性</text>
          <view class="choice-row">
            <button
              class="choice"
              :class="{ active: masterForm.type === 'OWNED' }"
              @tap="masterForm.type = 'OWNED'"
            >
              自营采购
            </button>
            <button
              class="choice"
              :class="{ active: masterForm.type === 'CONSIGNMENT' }"
              @tap="masterForm.type = 'CONSIGNMENT'"
            >
              寄售合作
            </button>
          </view>
          <view class="field-grid">
            <view
              ><text class="field-label">联系人</text
              ><input v-model="masterForm.contactName" class="field"
            /></view>
            <view
              ><text class="field-label">联系电话</text
              ><input v-model="masterForm.contactPhone" class="field"
            /></view>
          </view>
          <text class="field-label">结算周期</text>
          <picker
            mode="selector"
            :range="['PER_ORDER · 逐单', 'WEEKLY · 周结', 'MONTHLY · 月结']"
            @change="
              masterForm.settlementCycle = ['PER_ORDER', 'WEEKLY', 'MONTHLY'][
                Number(($event as any).detail.value)
              ]
            "
            ><view class="picker-field">{{
              masterForm.settlementCycle
            }}</view></picker
          >
          <template v-if="masterForm.type === 'CONSIGNMENT'">
            <text class="field-label">场馆分成比例（%）</text>
            <input
              v-model="masterForm.commissionRatePercent"
              class="field"
              type="digit"
            />
          </template>
          <template v-else>
            <text class="field-label">采购账期（天）</text>
            <input
              v-model="masterForm.paymentTermsDays"
              class="field"
              type="number"
            />
          </template>
        </template>

        <template v-else>
          <text class="field-label">库位编码</text>
          <input
            v-model="masterForm.code"
            class="field"
            placeholder="例如 FRONT-02"
          />
          <text class="field-label">库位名称</text>
          <input
            v-model="masterForm.name"
            class="field"
            placeholder="前台展示仓"
          />
        </template>

        <text class="field-label">变更原因</text>
        <textarea
          v-model="masterForm.reason"
          class="field reason-field"
          placeholder="说明新增或修改原因，写入审计日志"
        />
        <button
          class="primary form-submit"
          :loading="saving"
          :disabled="saving"
          @tap="submitMasterForm"
        >
          确认保存
        </button>
      </view>

      <view
        v-for="record in masterRecords"
        :id="opsDeepLinkDomId('inventory-master', record.id)"
        :key="record.id"
        class="card document master-card"
        :class="{
          'deep-link-target': focusedRecord === `inventory-master:${record.id}`,
        }"
      >
        <view class="row">
          <view>
            <text class="title">{{ record.name }}</text>
            <text class="muted">
              <template v-if="masterType === 'ITEM'"
                >{{ record.sku }} · {{ record.category }} ·
                {{ record.mode === "CONSIGNMENT" ? "代销" : "自营" }}</template
              >
              <template v-else-if="masterType === 'SUPPLIER'"
                >{{ record.code }} ·
                {{
                  record.type === "CONSIGNMENT" ? "寄售合作" : "自营采购"
                }}</template
              >
              <template v-else
                >{{ record.code }} · 库存
                {{
                  (record.stockBalances || []).reduce(
                    (sum: number, entry: any) =>
                      sum + Number(entry.quantity || 0),
                    0,
                  )
                }}</template
              >
            </text>
          </view>
          <text
            class="status"
            :class="{ disabled: record.enabled === false }"
            >{{ record.enabled === false ? "已停用" : "启用中" }}</text
          >
        </view>
        <text v-if="masterType === 'ITEM'" class="muted"
          >库存 {{ record.stock }} / 安全线 {{ record.safeStock }} · 售价
          {{ money(record.salePriceCents) }}</text
        >
        <text v-else-if="masterType === 'SUPPLIER'" class="muted"
          >SKU {{ record._count?.items ?? record.items?.length ?? 0 }} ·
          历史采购
          {{
            record._count?.purchaseOrders ?? record.purchaseOrders?.length ?? 0
          }}</text
        >
        <text v-else class="muted"
          >默认 SKU
          {{ record._count?.defaultItems ?? record.defaultItems?.length ?? 0 }}
          · 库位分账
          {{
            record._count?.stockBalances ?? record.stockBalances?.length ?? 0
          }}</text
        >
        <view class="master-actions">
          <button
            class="secondary mini-action"
            :loading="saving && detailId !== record.id"
            @tap="loadMasterDetail(record)"
          >
            {{ detailId === record.id ? "收起详情" : "查看详情" }}
          </button>
          <button
            v-if="isAdmin"
            class="secondary mini-action"
            @tap="openMasterForm(record)"
          >
            编辑
          </button>
          <button
            v-if="isAdmin"
            class="danger-action mini-action"
            @tap="toggleMasterStatus(record)"
          >
            {{ record.enabled === false ? "启用" : "停用" }}
          </button>
        </view>
        <view
          v-if="detailId === record.id && masterDetail"
          class="detail-panel"
        >
          <template v-if="masterType === 'ITEM'">
            <text
              >供应商：{{ masterDetail.supplierRecord?.name || "未配置" }}</text
            >
            <text
              >默认库位：{{
                masterDetail.defaultLocation?.name || "未配置"
              }}</text
            >
            <text
              >库位/批次余额：{{
                masterDetail.stockBalances?.length || 0
              }}
              条</text
            >
            <text
              >最近库存流水：{{
                masterDetail.transactions?.length || 0
              }}
              条</text
            >
          </template>
          <template v-else-if="masterType === 'SUPPLIER'">
            <text
              >联系人：{{ masterDetail.contactName || "未填写" }}
              {{ masterDetail.contactPhone || "" }}</text
            >
            <text
              >结算：{{ masterDetail.settlementRule?.settlementCycle
              }}<template v-if="masterDetail.type === 'CONSIGNMENT'">
                · 分成
                {{
                  Number(masterDetail.settlementRule?.commissionRateBps || 0) /
                  100
                }}%</template
              ><template v-else>
                · 账期
                {{ masterDetail.settlementRule?.paymentTermsDays || 0 }}
                天</template
              ></text
            >
            <text
              >关联 SKU：{{ masterDetail.items?.length || 0 }} · 最近采购单：{{
                masterDetail.purchaseOrders?.length || 0
              }}</text
            >
          </template>
          <template v-else>
            <text>默认 SKU：{{ masterDetail.defaultItems?.length || 0 }}</text>
            <text>库存分账：{{ masterDetail.stockBalances?.length || 0 }}</text>
            <text
              >最近盘点：{{ masterDetail.stocktakes?.length || 0 }} · 调出单
              {{ masterDetail.sourceOperations?.length || 0 }} · 调入单
              {{ masterDetail.targetOperations?.length || 0 }}</text
            >
          </template>
        </view>
      </view>
      <view v-if="!loading && !masterRecords.length" class="card empty"
        >当前筛选下暂无基础资料。</view
      >
    </template>
  </view>
</template>

<style scoped src="../page.css"></style>
