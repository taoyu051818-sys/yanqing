import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import { Noto_Sans_SC, JetBrains_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const _notoSansSC = Noto_Sans_SC({ subsets: ['latin'], weight: ['400', '500', '700', '900'] })
const _jetbrainsMono = JetBrains_Mono({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: '延庆羽毛球馆 · 金羽会员生态',
  description:
    '延庆羽毛球馆会员生态经营与小程序系统高保真原型：场地订场、瑞士积分赛事、培训独立核算、羽球币激励与万达异业联盟对账。',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#1b2f57',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="zh-CN" className="light bg-background">
      <body className="font-sans antialiased">
        {children}
        <Toaster position="top-center" richColors />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
