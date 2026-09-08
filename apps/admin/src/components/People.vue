<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import {
  api,
  query,
  session,
  roleNames,
  rolesText,
  date,
  statusNames,
  type Row,
} from '../api';
import Panel from './Panel.vue';
const people = ref<Row[]>([]),
  total = ref(0),
  page = ref(1),
  keyword = ref(''),
  role = ref(''),
  status = ref(''),
  loading = ref(false),
  error = ref(''),
  notice = ref(''),
  selected = ref<Row | null>(null),
  saving = ref(false),
  formError = ref(''),
  merchants = ref<Row[]>([]);
const draft = ref<Row>({}),
  superAdmin = computed(() =>
    session.value?.user.roles.includes('SUPER_ADMIN'),
  );
let sequence = 0;
async function load() {
  const run = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const r = await api(
      '/governance/users' +
        query({
          keyword: keyword.value,
          role: role.value,
          status: status.value,
          page: page.value,
          pageSize: 20,
        }),
    );
    if (run !== sequence) return;
    people.value = r.items;
    total.value = r.total;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    if (run === sequence) loading.value = false;
  }
}
async function open(row: Row) {
  selected.value = row;
  formError.value = '';
  draft.value = {
    roles: row.roles.map((r: Row) => r.role),
    primaryRole: row.primaryRole,
    merchantId:
      row.roles.find((r: Row) => r.role === 'MERCHANT')?.merchantId || '',
    reason: '',
    status: row.status,
    idempotencyKey: crypto.randomUUID(),
  };
  if (superAdmin.value)
    try {
      merchants.value = await api('/alliance/merchants');
    } catch (e) {
      formError.value = (e as Error).message;
    }
}
async function save(kind: 'roles' | 'status') {
  if (!selected.value) return;
  saving.value = true;
  formError.value = '';
  try {
    const d = draft.value;
    const body =
      kind === 'roles'
        ? {
            roles: d.roles,
            primaryRole: d.primaryRole,
            ...(d.roles.includes('MERCHANT')
              ? { merchantId: d.merchantId }
              : {}),
            reason: d.reason,
            idempotencyKey: d.idempotencyKey,
          }
        : {
            status: d.status,
            reason: d.reason,
            idempotencyKey: d.idempotencyKey,
          };
    await api(`/governance/users/${selected.value.id}/${kind}`, 'POST', body);
    notice.value = `${selected.value.displayName} 的${kind === 'roles' ? '岗位' : '账号状态'}已更新`;
    selected.value = null;
    await load();
  } catch (e) {
    formError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>
<template>
  <section>
    <div v-if="notice" class="notice" role="status">{{ notice }}</div>
    <form
      class="toolbar"
      @submit.prevent="
        page = 1;
        load();
      "
    >
      <label class="grow"
        >查找人员<input
          v-model="keyword"
          placeholder="昵称或手机号"
          maxlength="50" /></label
      ><label
        >岗位<select v-model="role">
          <option value="">全部岗位</option>
          <option v-for="(name, key) in roleNames" :value="key">
            {{ name }}
          </option>
        </select></label
      ><label
        >账号状态<select v-model="status">
          <option value="">全部状态</option>
          <option value="ACTIVE">正常</option>
          <option value="DISABLED">停用</option>
        </select></label
      ><button :disabled="loading">查询</button>
    </form>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="surface table-wrap" :aria-busy="loading">
      <table>
        <thead>
          <tr>
            <th>人员</th>
            <th>联系手机</th>
            <th>已授权岗位</th>
            <th>状态</th>
            <th>微信绑定</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="person in people" :key="person.id">
            <td>
              <strong>{{ person.displayName }}</strong>
              <div class="small muted">加入于 {{ date(person.createdAt) }}</div>
            </td>
            <td>{{ person.phone || '未绑定' }}</td>
            <td>{{ rolesText(person.roles) }}</td>
            <td>
              <span
                class="badge"
                :class="person.status === 'ACTIVE' ? 'good' : 'warn'"
                >{{ statusNames[person.status] || person.status }}</span
              >
            </td>
            <td>{{ person.wechatBound ? '已绑定' : '未绑定' }}</td>
            <td>
              <button class="link" @click="open(person)">
                {{ superAdmin ? '管理' : '查看' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!people.length" class="empty">
        {{ loading ? '正在加载人员…' : '没有符合条件的人员' }}
      </div>
    </div>
    <div class="pagination">
      <span>共 {{ total }} 人 · 第 {{ page }} 页</span
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
    </div>
    <Panel
      v-if="selected"
      :title="selected.displayName + ' · 人员详情'"
      :busy="saving"
      @close="selected = null"
      ><dl class="facts">
        <dt>用户编号</dt>
        <dd class="mono">{{ selected.id }}</dd>
        <dt>当前岗位</dt>
        <dd>{{ rolesText(selected.roles) }}</dd>
        <dt>微信绑定</dt>
        <dd>{{ selected.wechatBound ? '已绑定' : '未绑定' }}</dd>
      </dl>
      <template v-if="superAdmin"
        ><form @submit.prevent="save('roles')">
          <h3>岗位授权</h3>
          <fieldset class="role-grid">
            <legend class="sr-only">选择允许使用的岗位</legend>
            <label v-for="(name, key) in roleNames" :key="key" class="check"
              ><input v-model="draft.roles" type="checkbox" :value="key" />{{
                name
              }}</label
            >
          </fieldset>
          <label
            >默认岗位<select v-model="draft.primaryRole" required>
              <option v-for="r in draft.roles" :value="r">
                {{ roleNames[r] }}
              </option>
            </select></label
          ><label v-if="draft.roles.includes('MERCHANT')"
            >所属联盟商户<select v-model="draft.merchantId" required>
              <option value="" disabled>请选择商户</option>
              <option v-for="m in merchants" :value="m.id">{{ m.name }}</option>
            </select></label
          ><label
            >变更依据<textarea
              v-model="draft.reason"
              minlength="2"
              maxlength="200"
              required
              placeholder="例如：任命为前台负责人"
            ></textarea>
          </label>
          <p v-if="formError" class="error" role="alert">{{ formError }}</p>
          <button :disabled="saving || !draft.roles.length">
            {{ saving ? '正在保存…' : '保存岗位' }}
          </button>
        </form>
        <hr />
        <form @submit.prevent="save('status')">
          <h3>账号状态</h3>
          <p class="muted small">停用后，已有登录会话将无法继续访问业务。</p>
          <label
            >状态<select v-model="draft.status">
              <option value="ACTIVE">正常</option>
              <option value="DISABLED">停用</option>
            </select></label
          >
          <p class="small muted">使用上方填写的变更依据。</p>
          <button
            class="secondary"
            :disabled="
              saving ||
              draft.reason.trim().length < 2 ||
              draft.status === selected.status
            "
          >
            更新账号状态
          </button>
        </form></template
      ></Panel
    >
  </section>
</template>
