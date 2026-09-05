/** Keep transport/framework diagnostics out of member-facing messages. */
export function apiFeedback(message: unknown, status: number): string {
  if (status >= 500) return '服务暂时不可用，请稍后重试'
  const messages = Array.isArray(message) ? message : [message]
  const readable = messages.find((item): item is string =>
    typeof item === 'string' && /[\u3400-\u9fff]/.test(item) && item.length <= 160,
  )
  if (readable) return readable.trim()
  if (status === 400 || status === 422) return '提交的信息有误，请检查后重试'
  if (status === 401) return '登录已过期，请重新登录'
  if (status === 403) return '当前账号没有操作权限'
  if (status === 404) return '内容暂时无法访问，请刷新后重试'
  if (status === 409) return '状态已发生变化，请刷新后重试'
  if (status === 413) return '文件过大，请选择更小的图片'
  if (status === 429) return '操作过于频繁，请稍后重试'
  return '请求未完成，请稍后重试'
}
