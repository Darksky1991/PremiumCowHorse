import type { JSX } from 'react'

/**
 * 应用 Logo「環（わ）」：三段弧绕着一个点旋转（圆环选择器的抽象）。
 * 颜色取主题的 --logo-* 令牌（packages/ui/src/styles/globals.css），逗号后为静态色，
 * 与 apps/desktop/build/logo.svg（图标生成的原件）保持一致；改动其一时同步另一处。
 */
export function LogoMark({
  className,
  title
}: {
  className?: string
  title?: string
}): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <g fill="none" strokeWidth="5" strokeLinecap="round">
        <path d="M16 5A11 11 0 0 1 26.83 14.09" style={{ stroke: 'var(--logo-base, #3778d7)' }} />
        <path
          d="M25.53 21.5A11 11 0 0 1 12.24 26.34"
          style={{ stroke: 'var(--logo-base-2, #2a5fb7)' }}
        />
        <path d="M6.47 21.5A11 11 0 0 1 8.93 7.57" style={{ stroke: 'var(--logo-mid, #6d9adc)' }} />
      </g>
      <circle cx="16" cy="16" r="4" style={{ fill: 'var(--logo-accent, #f9b73f)' }} />
    </svg>
  )
}
