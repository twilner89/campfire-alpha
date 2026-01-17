"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import Link from "next/link";

import { submitAlphaCode } from "@/app/actions/gatekeeper";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Props = {
  children: React.ReactNode;
  hasAccess: boolean;
};

export default function AlphaGate(props: Props) {
  const { children, hasAccess } = props;

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [isPending, startTransition] = useTransition();

  const [ready, setReady] = useState(false);
  const [granted, setGranted] = useState(hasAccess);
  const [isAdmin, setIsAdmin] = useState(false);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!supabase) {
      setReady(true);
      return;
    }

    void (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;

      if (sessionError) {
        setError(sessionError.message);
        setReady(true);
        return;
      }

      const token = data.session?.access_token ?? null;
      const userId = data.session?.user?.id ?? null;
      setAccessToken(token);

      if (!userId) {
        setReady(true);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("is_admin,has_access")
        .eq("id", userId)
        .maybeSingle();

      if (cancelled) return;

      if (profileError) {
        const msg = profileError.message.toLowerCase();
        const missingAccessColumn = msg.includes("has_access");
        if (!missingAccessColumn) {
          setError(profileError.message);
        }
        setReady(true);
        return;
      }

      const admin = (profile as { is_admin?: boolean } | null)?.is_admin ?? false;
      const access = (profile as { has_access?: boolean } | null)?.has_access ?? false;

      setIsAdmin(admin);
      setGranted(admin || access);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  async function onSubmit() {
    setError(null);
    if (!supabase) {
      setError("Client misconfigured.");
      return;
    }

    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      setError(sessionError.message);
      return;
    }

    const token = data.session?.access_token ?? null;
    const userId = data.session?.user?.id ?? null;

    if (!token || !userId) {
      setError("You must be signed in to enter an access code.");
      return;
    }

    const fd = new FormData();
    fd.set("code", code);
    fd.set("accessToken", token);

    startTransition(() => {
      void (async () => {
        const res = await submitAlphaCode(fd);
        if (res.error) {
          setError(res.error);
          return;
        }

        // Refresh local access state.
        const { data: profile, error: profileError } = await supabase
          .from("profiles")
          .select("is_admin,has_access")
          .eq("id", userId)
          .maybeSingle();

        if (profileError) {
          setError(profileError.message);
          return;
        }

        const admin = (profile as { is_admin?: boolean } | null)?.is_admin ?? false;
        const access = (profile as { has_access?: boolean } | null)?.has_access ?? false;

        setIsAdmin(admin);
        setGranted(admin || access);
      })();
    });
  }

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-stone-950 px-6">
        <p className="text-sm text-stone-200/70">Checking clearance...</p>
      </div>
    );
  }

  if (granted || isAdmin) {
    return <>{children}</>;
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-stone-950 px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,180,120,0.16),transparent_55%),radial-gradient(circle_at_bottom,rgba(120,180,255,0.10),transparent_60%)]" />
      <div className="relative w-full max-w-md">
        <Card className="border-stone-800 bg-stone-950/70">
          <CardHeader>
            <CardTitle className="font-press-start text-base text-stone-100">Enter Access Code</CardTitle>
            <CardDescription className="text-stone-200/70">
              This is an early alpha. You need clearance to enter.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs text-stone-200/70">Access Code</label>
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="••••••••"
                className="border-stone-800 bg-stone-950/40 text-stone-100 placeholder:text-stone-200/40"
                autoComplete="off"
              />
            </div>

            {error ? <p className="text-sm text-red-400">{error}</p> : null}

            <div className="flex items-center gap-3">
              <Button onClick={() => void onSubmit()} disabled={isPending || !code.trim()}>
                {isPending ? "Entering..." : "Enter"}
              </Button>
              {!accessToken ? (
                <Button asChild variant="secondary">
                  <Link href="/auth">Sign in</Link>
                </Button>
              ) : null}
            </div>

            <p className="text-xs text-stone-200/50">
              If you don’t have a code, request one from the campaign’s host.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
