import type { ButtonHTMLAttributes, ComponentPropsWithoutRef } from "react";
import { clsx } from "clsx";
import { SmartLink } from "./SmartLink";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "md" | "lg";

interface StyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-control font-bold leading-none whitespace-nowrap transition-colors duration-200 disabled:pointer-events-none disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:opacity-60";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary:
    "border border-border-strong bg-transparent text-fg hover:bg-surface-2",
  ghost: "text-accent hover:bg-accent-soft hover:text-accent-soft-fg",
};

// 44px minimum touch target (WCAG 2.5.8 / platform guidance).
const sizes: Record<ButtonSize, string> = {
  md: "min-h-11 min-w-11 px-5 text-sm",
  lg: "min-h-12 min-w-12 px-7 text-base",
};

/** Class string for anything that should look like a button (links, pagers). */
export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: StyleOptions = {}) {
  return clsx(base, variants[variant], sizes[size], className);
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & StyleOptions) {
  return (
    <button
      type={type}
      className={buttonStyles({ variant, size, className })}
      {...props}
    />
  );
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SmartLink> & StyleOptions) {
  return (
    <SmartLink
      className={buttonStyles({ variant, size, className })}
      {...props}
    />
  );
}
