<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { api, session, type Row, type Session } from '../api';
const challenge = ref<Row | null>(null),
  error = ref(''),
  busy = ref(false),
  status = ref(''),
  remaining = ref(120);
let timeout: ReturnType<typeof setTimeout> | undefined,
  clock: ReturnType<typeof setInterval> | undefined,
  disposed = false,
  generation = 0;
async function start() {
  if (busy.value) return;
  const run = ++generation;
  clearTimeout(timeout);
  error.value = '';
  busy.value = true;
  status.value = '';
  challenge.value = null;
  try {
    const result = await api<Row>('/admin-auth/challenges', 'POST', {});
    if (disposed || run !== generation) return;
    challenge.value = result;
    remaining.value = Math.max(
      0,
      Math.ceil((Date.parse(result.expiresAt) - Date.now()) / 1000),
    );
    poll(run);
  } catch (e) {
    if (!disposed && run === generation) error.value = (e as Error).message;
  } finally {
    if (!disposed && run === generation) busy.value = false;
  }
}
async function poll(run: number) {
  if (disposed || run !== generation || !challenge.value) return;
  try {
    const state = await api<Row>(
      `/admin-auth/challenges/${challenge.value.id}`,
    );
    if (disposed || run !== generation) return;
    status.value = state.status;
    if (state.status === 'APPROVED') {
      busy.value = true;
      const result = await api<Session>(
        `/admin-auth/challenges/${challenge.value.id}/exchange`,
        'POST',
        {},
      );
      if (!disposed && run === generation) session.value = result;
      return;
    }
    if (state.status !== 'WAITING') return;
    timeout = setTimeout(() => poll(run), 1800);
  } catch (e) {
    if (!disposed && run === generation) {
      error.value = (e as Error).message;
      status.value = 'ERROR';
    }
  } finally {
    if (!disposed && run === generation) busy.value = false;
  }
}
onMounted(() => {
  start();
  clock = setInterval(() => {
    if (challenge.value)
      remaining.value = Math.max(
        0,
        Math.ceil((Date.parse(challenge.value.expiresAt) - Date.now()) / 1000),
      );
  }, 1000);
});
onUnmounted(() => {
  disposed = true;
  clearTimeout(timeout);
  clearInterval(clock);
});
</script>
<template>
  <main class="login-shell">
    <div class="login-brand">
      <div class="brand-mark">羽</div>
      <span>延庆金羽</span><span class="muted">经营管理</span>
    </div>
    <section class="login-card">
      <div class="login-intro">
        <p class="eyebrow">场馆经营 · 电脑工作台</p>
        <h1>用微信小程序<br />确认登录</h1>
        <p>统一处理人员权限、业务配置与经营待办。</p>
        <ol>
          <li>打开「延庆金羽」微信小程序</li>
          <li>进入经营工作台，点击「电脑后台登录」</li>
          <li>扫描右侧二维码，核对识别码并确认</li>
        </ol>
        <p class="small muted">仅限已授权的管理员与财务。普通会员无法登录。</p>
      </div>
      <div class="login-qr">
        <div class="qr-box">
          <img
            v-if="
              challenge &&
              remaining &&
              ['', 'WAITING', 'APPROVED'].includes(status)
            "
            :src="challenge.qrImage"
            alt="请用金羽小程序电脑后台登录入口扫描"
            width="280"
            height="280"
          />
          <div v-else class="qr-message">
            {{
              busy
                ? '正在生成二维码…'
                : status === 'CANCELLED'
                  ? '已取消登录'
                  : '请刷新二维码'
            }}
          </div>
        </div>
        <p
          v-if="challenge && remaining && status === 'WAITING'"
          class="muted small"
        >
          {{ remaining }} 秒后过期
        </p>
        <p v-if="challenge" class="verify-code">
          识别码 <strong>{{ challenge.confirmationCode }}</strong>
        </p>
        <p v-if="error" role="alert" class="error">{{ error }}</p>
        <button class="secondary" :disabled="busy" @click="start">
          {{ busy ? '正在准备…' : '刷新二维码' }}
        </button>
      </div>
    </section>
    <footer class="login-footer">
      延庆金羽羽毛球馆 · 与小程序共用同一套业务数据
    </footer>
  </main>
</template>
