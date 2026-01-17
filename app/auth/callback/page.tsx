"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Signing you in...");

  useEffect(() => {
    async function run() {
      const supabase = createBrowserSupabaseClient();
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      const { error } = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.getSession();

      if (error) {
        setMessage(error.message);
        return;
      }

      router.replace("/game");
    }

    void run();
  }, [router]);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md items-center justify-center px-6">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
