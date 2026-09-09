<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  api,
  session,
  type Session,
  type Row,
  roleNames,
  rolesText,
  money,
  date,
  query,
  statusNames,
} from './api';
import Login from './components/Login.vue';
import BossSummary from './components/BossSummary.vue';
import People from './components/People.vue';
import Catalog from './components/Catalog.vue';
import Panel from './components/Panel.vue';
const initial = ref(true),
  tab = ref(location.hash.slice(1) || 'boss'),
  loading = ref(false),
  error = ref(''),
  notice = ref(''),
  items = ref<Row[]>([]),
  total = ref(0),
  page = ref(1),
  filter = ref(''),
  selected = ref<Row | null>(null),
  saving = ref(false);
const isAdmin = computed(() =>
    session.value?.user.roles.some((r) => ['ADMIN', 'SUPER_ADMIN'].includes(r)),
  ),
  allNav = [
    {
      id: 'boss',
      label: '老板摘要',
      letter: '00',
      hint: '经营数据、简报与关键事件',
    },
    { id: 'work', label: '我的工作', letter: '01', hint: '待办与异常' },
    {
      id: 'people',
      label: '人员与权限',
      letter: '02',
      hint: '会员、员工与岗位',
    },
    {
      id: 'catalog',
      label: '业务配置',
      letter: '03',
      hint: '产品、价格与权益',
    },
    { id: 'orders', label: '订单查询', letter: '04', hint: '业务订单与履约' },
    { id: 'audit', label: '操作审计', letter: '05', hint: '变更记录与追溯' },
    { id: 'sessions', label: '登录设备', letter: '06', hint: '会话与退出' },
  ];
const nav = computed(() =>
    allNav.filter(
      (n) => isAdmin.value || !['people', 'catalog'].includes(n.id),
    ),
  ),
  title = computed(
    () => allNav.find((n) => n.id === tab.value)?.label || '我的工作',
  );
const today = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
}).format(new Date());
let sequence = 0;
let detailSequence = 0;
function go(id: string) {
  sequence += 1;
  detailSequence += 1;
  if (!nav.value.some((n) => n.id === id)) id = 'work';
  tab.value = id;
  location.hash = id;
  page.value = 1;
  filter.value = '';
  selected.value = null;
  notice.value = '';
  load();
}
async function load() {
  if (!session.value || ['boss', 'people', 'catalog'].includes(tab.value))
    return;
  const run = ++sequence;
  loading.value = true;
  error.value = '';
  items.value = [];
  try {
    let r: any;
    if (tab.value === 'work') r = await api('/work-items?limit=100');
    else if (tab.value === 'orders')
      r = await api(
        '/orders/admin/all' +
          query({ page: page.value, pageSize: 20, status: filter.value }),
      );
    else if (tab.value === 'audit')
      r = await api(
        '/audit-logs' +
          query({ page: page.value, pageSize: 20, objectType: filter.value }),
      );
    else r = await api('/admin-auth/sessions');
    if (run === sequence) {
      items.value = Array.isArray(r) ? r : r.items;
      total.value = r.total ?? r.length;
    }
  } catch (e) {
    if (run === sequence) error.value = (e as Error).message;
  } finally {
    if (run === sequence) loading.value = false;
  }
}
async function init() {
  try {
    session.value = await api<Session>('/admin-auth/me');
  } catch {
  } finally {
    initial.value = false;
  }
  if (session.value) go(tab.value);
}
async function logout() {
  saving.value = true;
  try {
    await api('/admin-auth/logout', 'POST', {});
    session.value = null;
    items.value = [];
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function revoke(row: Row) {
  saving.value = true;
  try {
    await api(`/admin-auth/sessions/${row.id}/revoke`, 'POST', {});
    notice.value = '该电脑登录已撤销';
    selected.value = null;
    if (row.id === session.value?.sessionId) {
      session.value = null;
      items.value = [];
    } else await load();
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
async function open(row: Row) {
  const run = ++detailSequence;
  const owner = session.value;
  selected.value = row;
  const current = () => run === detailSequence && session.value === owner &&
    tab.value === 'orders' && selected.value?.id === row.id;
  if (tab.value === 'orders')
    try {
      const detail = await api('/orders/' + encodeURIComponent(row.id));
      if (current()) selected.value = detail;
    } catch (e) {
      if (current()) error.value = (e as Error).message;
    }
}
const groups: Record<string, string> = {
  CUSTOMER: '客户服务',
  REFUND: '退款与复核',
  TRAINING: '培训',
  EVENT: '赛事',
  ALLIANCE: '联盟商户',
  INVENTORY: '库存',
  FULFILLMENT: '履约',
  RECONCILIATION: '结算',
  GOVERNANCE: '权限治理',
};
const workGroups = computed(
  () => new Set(items.value.map((r) => r.group)).size,
);
const overdue = computed(
  () =>
    items.value.filter((r) => r.dueAt && Date.parse(r.dueAt) < Date.now())
      .length,
);
function focusMain() {
  document.getElementById('main')?.focus();
}
function onHash() {
  const id = location.hash.slice(1);
  if (id !== tab.value) go(id);
}
import { watch } from 'vue';
watch(
  session,
  (value) => {
    sequence += 1;
    detailSequence += 1;
    selected.value = null;
    items.value = [];
    total.value = 0;
    error.value = '';
    notice.value = '';
    loading.value = false;
    if (value && !initial.value) go(tab.value);
  },
  { flush: 'sync' },
);
onMounted(() => {
  init();
  window.addEventListener('hashchange', onHash);
});
onUnmounted(() => window.removeEventListener('hashchange', onHash));
const auditObjectNames: Record<string, string> = {
  User: '人员授权',
  AdminLogin: '登录确认',
  AdminBrowserSession: '电脑会话',
  MembershipProduct: '会员产品',
  PriceRule: '场地价格',
  RechargePlan: '充值方案',
  TrainingProduct: '培训产品',
  CouponTemplate: '联盟券',
  Order: '订单',
  Refund: '退款',
  HttpMutation: '接口操作',
  Payment: '支付',
  TrainingSettlement: '培训结算',
  ReconciliationPeriod: '营业日对账',
};
</script>
<template>
  <div v-if="initial" class="initial" role="status">正在恢复登录…</div>
  <Login v-else-if="!session" />
  <div v-else class="app-shell">
    <a href="#main" class="skip" @click.prevent="focusMain">跳到工作内容</a>
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-mark">羽</div>
        <div><strong>延庆金羽</strong><span>经营管理</span></div>
      </div>
      <p class="nav-label">场馆工作区</p>
      <nav aria-label="主导航">
        <button
          v-for="item in nav"
          :key="item.id"
          :class="{ active: tab === item.id }"
          :aria-current="tab === item.id ? 'page' : undefined"
          @click="go(item.id)"
        >
          <span class="nav-number">{{ item.letter }}</span
          ><span
            >{{ item.label }}<small>{{ item.hint }}</small></span
          >
        </button>
      </nav>
      <div class="sidebar-bottom">
        <span class="status-dot"></span>正式业务数据
        <p>延庆金羽主馆</p>
      </div>
    </aside>
    <div class="main-shell">
      <header class="topbar">
        <span
          >场馆经营 / <strong>{{ title }}</strong></span
        >
        <div class="account">
          <div class="avatar">{{ session.user.displayName.slice(0, 1) }}</div>
          <div>
            <strong>{{ session.user.displayName }}</strong
            ><small>{{
              rolesText(session.user.roles.filter((r) => r !== 'MEMBER'))
            }}</small>
          </div>
          <button class="quiet" :disabled="saving" @click="logout">退出</button>
        </div>
      </header>
      <main id="main" tabindex="-1">
        <div class="page-heading">
          <div>
            <p class="eyebrow">{{ today }}</p>
            <h1>{{ title }}</h1>
            <p class="muted">
              {{
                tab === 'work'
                  ? '先处理到期事项，再安排今天的工作。'
                  : allNav.find((n) => n.id === tab)?.hint
              }}
            </p>
          </div>
          <button
            v-if="!['boss', 'people', 'catalog'].includes(tab)"
            class="secondary"
            :disabled="loading"
            @click="load"
          >
            {{ loading ? '同步中…' : '刷新数据' }}
          </button>
        </div>
        <BossSummary v-if="tab === 'boss'" /><People
          v-else-if="tab === 'people'"
        /><Catalog v-else-if="tab === 'catalog'" /><template v-else
          ><p v-if="error" class="error" role="alert">{{ error }}</p>
          <p v-if="notice" class="notice" role="status">{{ notice }}</p>
          <template v-if="tab === 'work'"
            ><div class="metrics">
              <article>
                <span>当前待办</span
                ><strong>{{ loading || error ? '—' : items.length }}</strong
                ><small>本次最多展示 100 项</small>
              </article>
              <article>
                <span>已到期</span
                ><strong class="danger-text">{{
                  loading || error ? '—' : overdue
                }}</strong
                ><small>优先核实与跟进</small>
              </article>
              <article>
                <span>涉及业务</span
                ><strong>{{ loading || error ? '—' : workGroups }}</strong
                ><small>按本人职责汇总</small>
              </article>
            </div>
            <div class="section-bar">
              <h2>待处理事项</h2>
              <span class="muted small">按服务端优先级排序</span>
            </div>
            <div class="surface task-list">
              <button
                v-for="item in items"
                :key="item.id"
                class="task-row"
                @click="open(item)"
              >
                <span class="task-symbol">{{
                  (groups[item.group] || '待办').slice(0, 1)
                }}</span
                ><span class="task-copy"
                  ><strong>{{ item.title }}</strong
                  ><small>{{ item.description }}</small></span
                ><span class="badge neutral">{{
                  groups[item.group] || '业务待办'
                }}</span
                ><span class="task-date">{{
                  item.dueAt ? date(item.dueAt) : '待处理'
                }}</span
                ><span class="link">查看详情</span>
              </button>
              <div v-if="!items.length" class="empty">
                {{
                  loading
                    ? '正在同步待办…'
                    : error
                      ? '暂时无法读取待办'
                      : '当前没有待处理事项'
                }}
              </div>
            </div></template
          ><template v-else-if="tab === 'sessions'"
            ><div class="surface session-list">
              <article v-for="item in items" :key="item.id">
                <div class="grow">
                  <strong>{{
                    item.browserLabel.includes('Edg')
                      ? 'Edge'
                      : item.browserLabel.includes('Chrome')
                        ? 'Chrome'
                        : item.browserLabel.includes('Safari')
                          ? 'Safari'
                          : '电脑浏览器'
                  }}</strong
                  ><span v-if="item.id === session.sessionId" class="badge good"
                    >当前电脑</span
                  >
                  <p class="muted small">
                    登录于 {{ date(item.createdAt) }} · 到期
                    {{ date(item.expiresAt) }}
                  </p>
                </div>
                <button class="secondary" @click="selected = item">
                  撤销登录
                </button>
              </article>
              <div v-if="!items.length" class="empty">
                {{ loading ? '正在读取会话…' : '暂无有效电脑会话' }}
              </div>
            </div></template
          ><template v-else
            ><form
              class="toolbar"
              @submit.prevent="
                page = 1;
                load();
              "
            >
              <label v-if="tab === 'orders'"
                >订单状态<select v-model="filter">
                  <option value="">全部状态</option>
                  <option
                    v-for="s in [
                      'PENDING_PAYMENT',
                      'PAID',
                      'COMPLETED',
                      'CANCELLED',
                      'REFUND_PENDING',
                      'REFUNDED',
                    ]"
                    :value="s"
                  >
                    {{ statusNames[s] }}
                  </option>
                </select></label
              ><label v-else class="grow"
                >审计对象<select v-model="filter">
                  <option value="">本人可见的全部记录</option>
                  <option
                    v-for="s in isAdmin
                      ? [
                          'User',
                          'AdminLogin',
                          'AdminBrowserSession',
                          'MembershipProduct',
                          'PriceRule',
                          'RechargePlan',
                          'TrainingProduct',
                          'CouponTemplate',
                          'Order',
                          'Refund',
                          'HttpMutation',
                        ]
                      : [
                          'Order',
                          'Refund',
                          'Payment',
                          'TrainingSettlement',
                          'ReconciliationPeriod',
                        ]"
                    :value="s"
                  >
                    {{ auditObjectNames[s] }}
                  </option>
                </select></label
              ><button :disabled="loading">查询</button>
            </form>
            <div class="surface table-wrap">
              <table v-if="tab === 'orders'">
                <thead>
                  <tr>
                    <th>订单</th>
                    <th>业务</th>
                    <th>会员</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in items" :key="item.id">
                    <td class="mono">{{ item.orderNo || item.id }}</td>
                    <td>
                      {{ statusNames[item.businessType] || item.businessType }}
                    </td>
                    <td>{{ item.member?.displayName || '—' }}</td>
                    <td>{{ money(item.payableCents ?? item.totalAmount) }}</td>
                    <td>
                      <span class="badge neutral">{{
                        statusNames[item.status] || item.status
                      }}</span>
                    </td>
                    <td>{{ date(item.createdAt) }}</td>
                    <td>
                      <button class="link" @click="open(item)">详情</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <table v-else>
                <thead>
                  <tr>
                    <th>操作时间</th>
                    <th>操作者</th>
                    <th>动作</th>
                    <th>对象</th>
                    <th>结果</th>
                    <th>详情</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in items" :key="item.id">
                    <td>{{ date(item.createdAt) }}</td>
                    <td>{{ item.actor?.displayName || '系统 / 运维' }}</td>
                    <td>{{ item.action }}</td>
                    <td>{{ item.objectType }}</td>
                    <td>{{ statusNames[item.result] || item.result }}</td>
                    <td>
                      <button class="link" @click="open(item)">查看</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div v-if="!items.length" class="empty">
                {{ loading ? '正在查询…' : '暂无符合条件的记录' }}
              </div>
            </div>
            <div class="pagination">
              <span>共 {{ total }} 条 · 第 {{ page }} 页</span
              ><button
                class="secondary"
                :disabled="page <= 1 || loading"
                @click="
                  page--;
                  load();
                "
              >
                上一页</button
              ><button
                class="secondary"
                :disabled="page * 20 >= total || loading"
                @click="
                  page++;
                  load();
                "
              >
                下一页
              </button>
            </div></template
          ></template
        >
      </main>
      <footer class="workspace-footer">
        金羽经营管理 · 操作按本人权限执行并留存审计
      </footer>
    </div>
    <Panel
      v-if="selected"
      :title="
        tab === 'sessions'
          ? '撤销电脑登录'
          : tab === 'audit'
            ? '操作记录'
            : '业务详情'
      "
      :busy="saving"
      @close="selected = null"
      ><template v-if="tab === 'sessions'"
        ><p>
          撤销后，这台电脑将立即无法继续访问业务。需要再次在小程序确认才能登录。
        </p>
        <p class="muted">登录时间：{{ date(selected.createdAt) }}</p>
        <button :disabled="saving" @click="revoke(selected)">
          {{ saving ? '正在撤销…' : '确认撤销' }}
        </button></template
      ><template v-else
        ><h3>{{ selected.title || selected.orderNo || selected.action }}</h3>
        <p>{{ selected.description || selected.reason }}</p>
        <dl class="facts">
          <dt>状态 / 结果</dt>
          <dd>
            {{
              statusNames[selected.status || selected.result] ||
              selected.status ||
              selected.result
            }}
          </dd>
          <dt>创建时间</dt>
          <dd>{{ date(selected.createdAt) }}</dd>
          <dt>关联编号</dt>
          <dd class="mono">{{ selected.objectId || selected.id }}</dd>
          <template v-if="tab === 'orders'"
            ><dt>应付金额</dt>
            <dd>{{ money(selected.payableCents ?? selected.totalAmount) }}</dd>
            <dt>会员</dt>
            <dd>{{ selected.member?.displayName || '—' }}</dd></template
          >
        </dl>
        <template v-if="tab === 'work'"
          ><p class="muted">
            此事项的履约与复核，请在小程序「经营工作台」中继续处理。
          </p>
          <button class="secondary" @click="selected = null">
            返回待办
          </button></template
        ><template v-if="tab === 'audit'"
          ><details v-if="selected.oldValue">
            <summary>变更前</summary>
            <pre>{{ JSON.stringify(selected.oldValue, null, 2) }}</pre>
          </details>
          <details v-if="selected.newValue" open>
            <summary>变更后</summary>
            <pre>{{ JSON.stringify(selected.newValue, null, 2) }}</pre>
          </details>
          <p class="small muted">{{ selected.reason }}</p></template
        >
        <div v-if="tab === 'orders' && selected.items?.length">
          <h3>订单明细</h3>
          <article v-for="item in selected.items" class="order-line">
            <span
              >{{
                item.name || item.title || item.businessType || '业务项目'
              }}
              × {{ item.quantity }}</span
            ><strong>{{ money(item.amountCents ?? item.totalCents) }}</strong>
          </article>
        </div></template
      ></Panel
    >
  </div>
</template>
