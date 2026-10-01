import type { Metadata } from "next";
import { ApiKeysView } from "@/features/api-keys/api-keys-view";

export const metadata: Metadata = { title: "API keys" };

export default function Page() {
  return <ApiKeysView />;
}
