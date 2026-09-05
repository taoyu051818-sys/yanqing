import type { ApiEnvelope } from '../types/domain'
import { clearAuthSession, getAccessToken } from './auth-session'
import { mockRequest } from '@miniapp/mock/router'
import { apiFeedback } from './api-feedback'

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3200/api/v1'
export const isMockMode = import.meta.env.VITE_DATA_MODE !== 'remote'
const apiOrigin = apiBase.replace(/\/api\/v\d+\/?$/, '')

export const resolveApiAssetUrl = (url?: string | null) => {
  if (!url) return ''
  if (/^(https?:|data:|blob:|wxfile:)/.test(url)) return url
  return `${apiOrigin}${url.startsWith('/') ? '' : '/'}${url}`
}

export class ApiError extends Error {
  constructor(message: string, readonly statusCode = 500, readonly requestId?: string) {
    super(message)
  }
}

export const request = <T>(options: UniApp.RequestOptions & { redirectOnUnauthorized?: boolean }): Promise<T> => {
  const { redirectOnUnauthorized = true, ...transportOptions } = options
  // Native wx.request serializes undefined query values differently from H5.
  // Remove absent GET fields before either adapter sees them; retain 0/false
  // and do not alter mutation bodies where null can mean "clear this value".
  if ((options.method || 'GET').toUpperCase() === 'GET' && options.data && typeof options.data === 'object' && !Array.isArray(options.data)) {
    transportOptions.data = Object.fromEntries(Object.entries(options.data).filter(([, value]) => value !== undefined && value !== null))
  }
  // The build adapter removes the mock dependency graph from remote bundles.
  if (isMockMode) return mockRequest<T>(String(options.method || 'GET'), options.url, transportOptions.data)
  return new Promise((resolve, reject) => {
    const token = getAccessToken()
    uni.request({
      ...transportOptions,
      url: `${apiBase}${options.url}`,
      header: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...options.header,
      },
      success: (response) => {
        const envelope = response.data as ApiEnvelope<T>
        if (response.statusCode >= 200 && response.statusCode < 300 && envelope.code === 0) {
          resolve(envelope.data)
          return
        }
        if (response.statusCode === 401) {
          clearAuthSession()
          if (redirectOnUnauthorized) uni.reLaunch({ url: '/pages/login/index' })
        }
        reject(new ApiError(apiFeedback(envelope?.message, response.statusCode), response.statusCode, envelope?.requestId))
      },
      fail: () => reject(new ApiError('网络不可用，请检查服务地址', 0)),
    })
  })
}

export const api = {
  get: <T>(url: string, data?: object) => request<T>({ url, method: 'GET', data }),
  post: <T>(url: string, data?: object) => request<T>({ url, method: 'POST', data }),
  patch: <T>(url: string, data?: object) => request<T>({ url, method: 'PATCH' as any, data }),
}

export const upload = <T>(url: string, filePath: string, name: string): Promise<T> => {
  if (isMockMode) return Promise.reject(new ApiError('模拟模式不上传本地头像', 400))
  return new Promise((resolve, reject) => {
    const token = getAccessToken()
    uni.uploadFile({
      url: `${apiBase}${url}`,
      filePath,
      name,
      header: token ? { authorization: `Bearer ${token}` } : {},
      success: (response) => {
        let envelope: ApiEnvelope<T>
        try { envelope = JSON.parse(response.data) as ApiEnvelope<T> }
        catch { reject(new ApiError('头像上传响应格式错误', response.statusCode)); return }
        if (response.statusCode >= 200 && response.statusCode < 300 && envelope.code === 0) {
          resolve(envelope.data)
          return
        }
        if (response.statusCode === 401) clearAuthSession()
        reject(new ApiError(apiFeedback(envelope?.message, response.statusCode), response.statusCode, envelope?.requestId))
      },
      fail: () => reject(new ApiError('头像上传失败，请检查网络', 0)),
    })
  })
}

export const download = (url: string): Promise<{ tempFilePath: string; statusCode: number }> => {
  if (isMockMode) return Promise.reject(new ApiError('mock 模式不生成伪造报表', 400))
  return new Promise((resolve, reject) => {
    const token = getAccessToken()
    uni.downloadFile({
      url: `${apiBase}${url}`,
      header: token ? { authorization: `Bearer ${token}` } : {},
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve({ tempFilePath: response.tempFilePath, statusCode: response.statusCode })
          return
        }
        reject(new ApiError('报表生成失败', response.statusCode))
      },
      fail: () => reject(new ApiError('报表下载失败，请检查网络', 0)),
    })
  })
}
