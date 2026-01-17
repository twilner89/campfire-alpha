"use client";

import { useEffect, useMemo, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import CampfireStage from "@/components/game/CampfireStage";
import { castVote } from "@/app/game/actions";
import type { Episode, GamePhase } from "@/types/database";

const GAME_STATE_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

export default function CampfireStageShell(props: {
  episode: Episode | null;
  introAudioUrl: string | null;
  gameState: { current_phase: GamePhase | null; current_episode_id: string | null; phase_expiry: string | null };
}) {
  const { episode, introAudioUrl, gameState } = props;
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [liveGameState, setLiveGameState] = useState(gameState);
  const [liveEpisode, setLiveEpisode] = useState<Episode | null>(episode);

  useEffect(() => {
    setLiveGameState(gameState);
  }, [gameState]);

  useEffect(() => {
    setLiveEpisode(episode);
  }, [episode]);

  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("realtime:game_state")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_state",
          filter: `id=eq.${GAME_STATE_SINGLETON_ID}`,
        },
        (payload) => {
          const next = payload.new as { current_phase?: GamePhase | null; current_episode_id?: string | null; phase_expiry?: string | null };
          setLiveGameState((prev) => ({
            current_phase: next.current_phase ?? prev.current_phase,
            current_episode_id: next.current_episode_id ?? prev.current_episode_id,
            phase_expiry: next.phase_expiry ?? prev.phase_expiry,
          }));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase) return;
    const id = liveGameState.current_episode_id;
    if (!id) {
      setLiveEpisode(null);
      return;
    }
    if (liveEpisode?.id === id) return;

    let cancelled = false;
    void (async () => {
      let { data, error } = await supabase
        .from("episodes")
        .select("id,title,narrative_text,audio_url,season_num,episode_num,credited_authors")
        .eq("id", id)
        .maybeSingle();

      if (error) {
        const msg = error.message.toLowerCase();
        const missingCreditColumn = msg.includes("credited_authors");
        if (missingCreditColumn) {
          ({ data, error } = await supabase
            .from("episodes")
            .select("id,title,narrative_text,audio_url,season_num,episode_num")
            .eq("id", id)
            .maybeSingle());

          data = data ? { ...data, credited_authors: null } : null;
        }
      }

      if (cancelled) return;
      if (error) {
        return;
      }
      setLiveEpisode((data as Episode | null) ?? null);
    })();

    return () => {
      cancelled = true;
    };
  }, [liveEpisode?.id, liveGameState.current_episode_id, supabase]);

  async function onVote(optionId: string) {
    if (!supabase) throw new Error("Supabase client not configured.");
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new Error(error.message);
    const token = data.session?.access_token ?? null;
    if (!token) throw new Error("You must be signed in to vote.");

    await castVote(token, optionId);
  }

  return <CampfireStage episode={liveEpisode} introAudioUrl={introAudioUrl} gameState={liveGameState} onVote={onVote} />;
}
