'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import type { ComponentProps } from 'react'

type ButtonProps = ComponentProps<typeof Button>

/** Base UI 的 Button 使用 render 而非 asChild，这里封装成链接按钮 */
export function LinkButton({
  href,
  children,
  ...props
}: { href: string } & Omit<ButtonProps, 'render'>) {
  return (
    <Button {...props} nativeButton={false} render={<Link href={href} />}>
      {children}
    </Button>
  )
}
