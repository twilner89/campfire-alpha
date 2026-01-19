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
  onStoke?: () => void;
};

function buildVisuals(rows: EchoRow[]): EchoVisual[] {
  return rows.map((r) => {
    const hash = Array.from(r.id).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const x = 10 + ((hash * 13) % 71);
    const delayMs = (hash * 17) % 4000;
    const durationMs = 15000 + ((hash * 19) % 10001);

    return { ...r, x, delayMs, durationMs };
  });
}

export default function CampfireEchoes(props: Props) {
  const { episodeId, refreshKey, onStoke } = props;

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
      onStoke?.();

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
    [onStoke, supabase],
  );

  return (
    <div className="absolute inset-0 z-[5]">
      {echoes.map((e) => {
        const stoked = !!stokedIds[e.id];
        const heat = e.heat ?? 0;
        return (
          <div
            key={e.id}
            className="campfire-echo-float absolute bottom-[-10%]"
            style={{
              left: `${e.x}%`,
              animationDelay: `${e.delayMs}ms`,
              animationDuration: `${e.durationMs}ms`,
              animationPlayState: stoked ? "paused" : "running",
            }}
          >
            <button
              type="button"
              className={`group cursor-pointer select-none whitespace-pre-wrap text-left transition-transform duration-200 -translate-x-1/2 ${
                stoked ? "scale-110" : ""
              }`}
              onClick={() => void handleClick(e.id)}
            >
              <div
                className={`bg-black/40 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/10 shadow-lg font-mono text-sm tracking-wide ${
                  stoked ? "text-orange-200" : "text-white/70 group-hover:text-orange-200"
                }`}
                style={{
                  textShadow: stoked ? "0 0 12px rgba(234, 88, 12, 0.65)" : "0 0 10px rgba(0,0,0,0.65)",
                }}
              >
                🔥 {heat} | “{e.content_text}”
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}
