import type { CSSProperties, HTMLAttributes, ReactNode } from "react"

type Gap = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
type Tone = "purple" | "pink" | "blue" | "mint" | "yellow" | "orange"

interface BaseProps extends HTMLAttributes<HTMLElement> {
  children?: ReactNode
  className?: string
  style?: CSSProperties
}

function cx(...names: Array<string | false | undefined>) {
  return names.filter(Boolean).join(" ")
}

export function Stack({ gap = 4, className, ...rest }: BaseProps & { gap?: Gap }) {
  return <div {...rest} className={cx("pouf-stack", `pouf-gap-${gap}`, className)} />
}

export function Row({
  gap = 4,
  align = "center",
  justify = "start",
  wrap = true,
  className,
  ...rest
}: BaseProps & {
  gap?: Gap
  align?: "center" | "top" | "stretch"
  justify?: "start" | "center" | "between" | "end"
  wrap?: boolean
}) {
  return (
    <div
      {...rest}
      className={cx(
        "pouf-row",
        `pouf-gap-${gap}`,
        `pouf-align-${align}`,
        `pouf-justify-${justify}`,
        !wrap && "pouf-nowrap",
        className,
      )}
    />
  )
}

export function Card({
  variant = "default",
  className,
  ...rest
}: BaseProps & { variant?: "default" | "tight" | "flush" }) {
  return <div {...rest} className={cx("pouf-card", variant !== "default" && `pouf-card--${variant}`, className)} />
}

export function Heading({ level = 2, className, ...rest }: BaseProps & { level?: 1 | 2 | 3 }) {
  const Tag = `h${level}` as const
  return <Tag {...rest} className={cx("pouf-heading", `pouf-h${level}`, className)} />
}

export function Text({
  size = "md",
  muted,
  num,
  className,
  ...rest
}: BaseProps & { size?: "sm" | "md"; muted?: boolean; num?: boolean }) {
  return (
    <span
      dir="auto"
      {...rest}
      className={cx("pouf-text", size === "sm" && "pouf-text--sm", muted && "pouf-text--muted", num && "pouf-text--num", className)}
    />
  )
}

export function Badge({ tone = "purple", className, ...rest }: BaseProps & { tone?: Tone }) {
  return <span {...rest} className={cx("pouf-badge", `pouf-tone-${tone}`, className)} />
}

export function Separator({ className, ...rest }: Omit<BaseProps, "children">) {
  return <hr {...rest} className={cx("pouf-separator", className)} />
}
