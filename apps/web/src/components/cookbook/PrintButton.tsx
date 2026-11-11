"use client";

import { LuPrinter } from "react-icons/lu";
import { Button } from "@/components/ui/Button";

/** Print the recipe (the site chrome, comments and sign-up forms are hidden by print styles). */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      <LuPrinter aria-hidden className="size-4" />
      Print recipe
    </Button>
  );
}
