import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ComponentProps, type ReactNode } from "react";
import { LuLoaderCircle } from "react-icons/lu";
import { cn } from "./cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-2 rounded-ctl font-medium whitespace-nowrap select-none transition-colors " +
  "disabled:opacity-55 disabled:cursor-not-allowed aria-disabled:opacity-55 aria-disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-brand-ink hover:bg-brand-hover border border-transparent",
  secondary: "bg-panel text-ink border border-edge-strong hover:bg-panel-2",
  ghost: "bg-transparent text-ink border border-transparent hover:bg-panel-2",
  danger: "bg-danger text-white border border-transparent hover:bg-danger-hover dark:text-[#1a0a09]",
  "danger-outline": "bg-panel text-danger border border-danger hover:bg-danger-soft",
};

const sizes: Record<Size, string> = {
  sm: "min-h-8 px-2.5 text-[0.8125rem] pointer-coarse:min-h-11",
  md: "min-h-10 px-3.5 text-sm pointer-coarse:min-h-11",
};

export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string): string {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LuLoaderCircle aria-hidden className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonProps, "children" | "icon"> {
  /** Required accessible name (icon-only control). */
  label: string;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "ghost", size = "md", className, children, ...rest },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={label}
      className={cn(size === "md" ? "size-10 px-0 pointer-coarse:size-11" : "size-8 px-0 pointer-coarse:size-11", className)}
      {...rest}
    >
      {children}
    </Button>
  );
});

export interface LinkButtonProps extends ComponentProps<typeof Link> {
  variant?: Variant;
  size?: Size;
}

export function LinkButton({ variant = "secondary", size = "md", className, ...rest }: LinkButtonProps) {
  return <Link className={buttonClass(variant, size, className)} {...rest} />;
}

/** Plain `<a>` styled as a button (external links, downloads). */
export function AnchorButton({
  variant = "secondary",
  size = "md",
  className,
  ...rest
}: ComponentProps<"a"> & { variant?: Variant; size?: Size }) {
  return <a className={buttonClass(variant, size, className)} {...rest} />;
}
