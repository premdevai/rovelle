"use client";

import { useRouter } from "next/navigation";
import { fetchJson, RequestError } from "@/lib/fetch-json";

export default function SignOut() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await fetch("/api/auth", { method: "DELETE" });
        router.replace("/enter");
      }}
      className="mt-4 min-h-[44px] text-[14px] text-[hsl(var(--muted-foreground)/0.7)] underline underline-offset-4 hover:text-[hsl(var(--muted-foreground))]"
    >
      Sign out
    </button>
  );
}
