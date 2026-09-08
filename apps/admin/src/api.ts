import { ref } from 'vue';
export type Row = Record<string, any>;
export interface Session {
  user: { id: string; displayName: string; roles: string[] };
  csrfToken: string;
  sessionId: string;
  expiresAt: string;
}
export const session = ref<Session | null>(null);
export const roleNames: Record<string, string> = {
  MEMBER: '会员',
  FRONT_DESK: '前台',
  COACH: '教练',
  HOST: '主理人',
  MERCHANT: '联盟商户',
  FINANCE: '财务',
  EVENT_MANAGER: '赛事管理员',
  ADMIN: '管理员',
  SUPER_ADMIN: '超级管理员',
};
export const rolesText = (roles: any[]) =>
  roles
    .map((r) => roleNames[typeof r === 'string' ? r : r.role] || r.role || r)
    .join('、');
export const money = (value?: number) =>
  typeof value === 'number'
    ? new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
      }).format(value / 100)
    : '—';
export const date = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'short',
        timeStyle: 'short',
        hour12: false,
      }).format(new Date(value))
    : '—';
export const statusNames: Record<string, string> = {
  ACTIVE: '正常',
  DISABLED: '停用',
  DELETED: '已删除',
  PENDING: '待处理',
  PENDING_PAYMENT: '待支付',
  PAID: '已支付',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  REFUND_PENDING: '退款处理中',
  REFUNDED: '已退款',
  SUCCESS: '成功',
  FAILURE: '失败',
  DENIED: '拒绝',
  VENUE: '订场',
  GOODS: '商品',
  TRAINING: '培训',
  EVENT: '赛事',
  GAME: '球局',
  RECHARGE: '充值',
  MEMBERSHIP: '会员卡',
};
export async function api<T = any>(
  path: string,
  method = 'GET',
  data?: unknown,
): Promise<T> {
  const response = await fetch('/api/v1' + path, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(session.value ? { 'X-CSRF-Token': session.value.csrfToken } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) session.value = null;
    throw new Error(
      Array.isArray(payload?.message)
        ? payload.message.join('；')
        : payload?.message || `请求未完成（${response.status}）`,
    );
  }
  return payload?.data ?? payload;
}
export const query = (values: Row) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(values))
    if (v !== '' && v !== undefined && v !== null) p.set(k, String(v));
  return p.size ? '?' + p.toString() : '';
};
