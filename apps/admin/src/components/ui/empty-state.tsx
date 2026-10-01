import type { ReactNode } from "react";
import { LuCircleAlert, LuInbox } from "react-icons/lu";
import { Button } from "./button";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-14 text-center">
      <div aria-hidden className="mb-1 grid size-12 place-items-center rounded-full bg-panel-2 text-muted">
        {icon ?? <LuInbox className="size-6" />}
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = "Could not load this data",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div aria-hidden className="mb-1 grid size-12 place-items-center rounded-full bg-danger-soft text-danger">
        <LuCircleAlert className="size-6" />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
