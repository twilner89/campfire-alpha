export const dynamic = "force-dynamic";

import Link from "next/link";

import CampfireStageShell from "./CampfireStageShell";
import AlphaGate from "@/components/auth/AlphaGate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Episode, GamePhase } from "@/types/database";

const GAME_STATE_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

export default async function GamePage() {
  const supabase = createServerSupabaseClient();

  let gameState:
    | { current_phase: GamePhase; current_episode_id: string | null; current_series_bible_id?: string | null; phase_expiry?: string | null }
    | null = null;
  let gameStateErrorMessage: string | null = null;
  let hasMultipleGameStateRows = false;

  let { data: singletonState, error: singletonError } = await supabase
    .from("game_state")
    .select("current_phase,current_episode_id,current_series_bible_id,phase_expiry")
    .eq("id", GAME_STATE_SINGLETON_ID)
    .maybeSingle();

  if (singletonError) {
    const msg = singletonError.message.toLowerCase();
    const missingExpiryColumn = msg.includes("phase_expiry");
    const missingBibleColumn = msg.includes("current_series_bible_id") || msg.includes("schema cache") || msg.includes("column");
    if ((missingExpiryColumn || missingBibleColumn) && !singletonError.message.includes("column game_state.id")) {
      ({ data: singletonState, error: singletonError } = await supabase
        .from("game_state")
        .select(missingExpiryColumn ? "current_phase,current_episode_id,current_series_bible_id" : "current_phase,current_episode_id,phase_expiry")
        .eq("id", GAME_STATE_SINGLETON_ID)
        .maybeSingle());

      if (singletonError && missingBibleColumn) {
        ({ data: singletonState, error: singletonError } = await supabase
          .from("game_state")
          .select(missingExpiryColumn ? "current_phase,current_episode_id" : "current_phase,current_episode_id,phase_expiry")
          .eq("id", GAME_STATE_SINGLETON_ID)
          .maybeSingle());
      }
    }
  }

  if (singletonError?.message?.includes("column game_state.id")) {
    type LegacyRow = { current_phase: GamePhase; current_episode_id: string | null; phase_expiry?: string | null };

    let legacyStates: LegacyRow[] | null = null;
    let legacyError: { message: string } | null = null;

    const legacyAttempt = await supabase
      .from("game_state")
      .select("current_phase,current_episode_id,phase_expiry")
      .limit(2);

    legacyStates = ((legacyAttempt.data as unknown) as LegacyRow[] | null) ?? null;
    legacyError = legacyAttempt.error;

    if (legacyError) {
      const msg = legacyError.message.toLowerCase();
      const missingExpiryColumn = msg.includes("phase_expiry");
      if (missingExpiryColumn) {
        const fallbackAttempt = await supabase.from("game_state").select("current_phase,current_episode_id").limit(2);
        legacyStates = ((fallbackAttempt.data as unknown) as LegacyRow[] | null) ?? null;
        legacyError = fallbackAttempt.error;
      }
    }

    if (legacyError) {
      gameStateErrorMessage = legacyError.message;
    } else {
      hasMultipleGameStateRows = (legacyStates?.length ?? 0) > 1;
      const legacy = legacyStates?.[0] ?? null;
      gameState = legacy
        ? {
            current_phase: legacy.current_phase as GamePhase,
            current_episode_id: legacy.current_episode_id,
            phase_expiry: (legacy as { phase_expiry?: string | null }).phase_expiry ?? null,
          }
        : null;
    }
  } else if (singletonError) {
    gameStateErrorMessage = singletonError.message;
  } else {
    gameState = singletonState
      ? {
          current_phase: singletonState.current_phase as GamePhase,
          current_episode_id: singletonState.current_episode_id,
          current_series_bible_id: (singletonState as { current_series_bible_id?: string | null }).current_series_bible_id ?? null,
          phase_expiry: (singletonState as { phase_expiry?: string | null }).phase_expiry ?? null,
        }
      : null;
  }

  const currentEpisodeId = gameState?.current_episode_id ?? null;
  const currentBibleId = (gameState as { current_series_bible_id?: string | null } | null)?.current_series_bible_id ?? null;

  let episode: unknown = null;
  let episodeError: { message: string } | null = null;
  if (currentEpisodeId) {
    const attempt = await supabase
      .from("episodes")
      .select("id,title,narrative_text,audio_url,season_num,episode_num,credited_authors")
      .eq("id", currentEpisodeId)
      .maybeSingle();

    episode = attempt.data;
    episodeError = attempt.error;

    if (episodeError) {
      const msg = episodeError.message.toLowerCase();
      const missingCreditColumn = msg.includes("credited_authors");
      if (missingCreditColumn) {
        const fallback = await supabase
          .from("episodes")
          .select("id,title,narrative_text,audio_url,season_num,episode_num")
          .eq("id", currentEpisodeId)
          .maybeSingle();
        episode = fallback.data ? { ...fallback.data, credited_authors: null } : null;
        episodeError = fallback.error;
      }
    }
  }

  const typedEpisode = (episode as unknown as Episode | null) ?? null;

  let introAudioUrl: string | null = null;
  const needsIntroAudio = !typedEpisode?.audio_url;
  if (needsIntroAudio) {
    if (currentBibleId) {
      const attempt = await supabase
        .from("series_bible")
        .select("intro_audio_url")
        .eq("id", currentBibleId)
        .maybeSingle();

      if (!attempt.error) {
        introAudioUrl = ((attempt.data as { intro_audio_url?: string | null } | null)?.intro_audio_url ?? null) || null;
      }
    }

    if (!introAudioUrl) {
      const latestAttempt = await supabase
        .from("series_bible")
        .select("intro_audio_url")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestAttempt.error) {
        introAudioUrl = ((latestAttempt.data as { intro_audio_url?: string | null } | null)?.intro_audio_url ?? null) || null;
      }
    }
  }

  return (
    <AlphaGate hasAccess={false}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-16">
        <div className="flex items-center justify-between">
          <h1 className="font-press-start text-lg">Campfire</h1>
          <div className="flex items-center gap-4">
            <Link className="text-sm text-muted-foreground hover:text-foreground" href="/auth">
              Sign in
            </Link>
            <Link className="text-sm text-muted-foreground hover:text-foreground" href="/">
              Home
            </Link>
          </div>
        </div>

        {gameStateErrorMessage ? (
          <Card>
            <CardHeader>
              <CardTitle>Current phase</CardTitle>
              <CardDescription>{`Error loading game state: ${gameStateErrorMessage}`}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasMultipleGameStateRows ? (
                <p className="text-sm text-muted-foreground">
                  Warning: multiple rows exist in `game_state`. The app will use the first row until you clean this up.
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <CampfireStageShell
            episode={typedEpisode}
            introAudioUrl={introAudioUrl}
            gameState={{
              current_phase: gameState?.current_phase ?? null,
              current_episode_id: currentEpisodeId,
              phase_expiry: gameState?.phase_expiry ?? null,
            }}
          />
        )}

        {episodeError ? <p className="text-sm text-muted-foreground">{episodeError.message}</p> : null}
      </div>
    </AlphaGate>
  );
}
