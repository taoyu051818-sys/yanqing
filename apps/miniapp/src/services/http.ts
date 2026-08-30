import type { ApiEnvelope } from '../types/domain'
import { mockRequest } from './mock/router'

const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3200/api/v1'
export const isMockMode = import.meta.env.VITE_DATA_MODE !== 'remote'

export class ApiError extends Error {
  constructor(message: string, readonly statusCode = 500, readonly requestId?: string) {
    super(message)
  }
}

export const request = <T>(options: UniApp.RequestOptions): Promise<T> => {
  if (isMockMode) return mockRequest<T>(String(options.method || 'GET'), options.url, options.data)
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('yanqing_access_token') as string
    uni.request({
      ...options,
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
          uni.removeStorageSync('yanqing_access_token')
          uni.reLaunch({ url: '/pages/login/index' })
        }
        reject(new ApiError(envelope?.message || '请求失败', response.statusCode, envelope?.requestId))
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

export const download = (url: string): Promise<{ tempFilePath: string; statusCode: number }> => {
  if (isMockMode) return Promise.reject(new ApiError('mock 模式不生成伪造报表', 400))
  return new Promise((resolve, reject) => {
    const token = uni.getStorageSync('yanqing_access_token') as string
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
