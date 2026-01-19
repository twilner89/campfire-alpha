"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { getRecentEchoes, stokeSubmission, type EchoRow } from "@/app/game/actions";

type EchoVisual = EchoRow & {
  x: number;
  delayMs: number;
  durationMs: number;
};

type Props = {
  episodeId: string;
  refreshKey?: number;
};

function buildVisuals(rows: EchoRow[]): EchoVisual[] {
  return rows.map((r) => {
    const hash = Array.from(r.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const x = 6 + ((hash * 13) % 84);
    const delayMs = (hash * 17) % 2500;
    const durationMs = 7000 + ((hash * 19) % 6000);

    return { ...r, x, delayMs, durationMs };
  });
}

export default function CampfireEchoes(props: Props) {
  const { episodeId, refreshKey } = props;

  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [echoes, setEchoes] = useState<EchoVisual[]>([]);
  const [stokedIds, setStokedIds] = useState<Record<string, number>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchEchoes = useCallback(async () => {
    if (!episodeId) return;
    const rows = await getRecentEchoes(episodeId);
    setEchoes(buildVisuals(rows));
  }, [episodeId]);

  useEffect(() => {
    void fetchEchoes();

    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => {
      void fetchEchoes();
    }, 12000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [fetchEchoes, refreshKey]);

  const handleClick = useCallback(
    async (id: string) => {
      if (!supabase) return;
      const { data, error } = await supabase.auth.getSession();
      if (error) return;
      const token = data.session?.access_token ?? null;
      if (!token) return;

      setStokedIds((prev) => ({ ...prev, [id]: Date.now() }));
      setEchoes((prev) => prev.map((e) => (e.id === id ? { ...e, heat: (e.heat ?? 0) + 1 } : e)));

      try {
        const res = await stokeSubmission(token, id);
        if (res.ok) {
          setEchoes((prev) => prev.map((e) => (e.id === id ? { ...e, heat: res.heat } : e)));
        }
      } finally {
        window.setTimeout(() => {
          setStokedIds((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }, 650);
      }
    },
    [supabase],
  );

  return (
    <div className="absolute inset-0 z-[5]">
      {echoes.map((e) => {
        const stoked = !!stokedIds[e.id];
        return (
          <div
            key={e.id}
            className={`campfire-echo-float absolute bottom-[-10%] font-vt323 text-lg leading-5 transition-transform duration-200 ${
              stoked ? "text-orange-400 scale-110" : "text-white/60"
            }`}
            style={{
              left: `${e.x}%`,
              animationDelay: `${e.delayMs}ms`,
              animationDuration: `${e.durationMs}ms`,
              animationPlayState: stoked ? "paused" : "running",
            }}
          >
            <button
              type="button"
              className="cursor-pointer select-none whitespace-pre-wrap text-left"
              style={{
                textShadow: stoked ? "0 0 12px rgba(234, 88, 12, 0.9)" : "0 0 8px rgba(255,255,255,0.15)",
              }}
              onClick={() => void handleClick(e.id)}
            >
              {e.content_text}
            </button>
          </div>
        );
      })}
    </div>
  );
}
