"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import EpisodeManager from "@/components/admin/EpisodeManager";
import GenesisForm from "@/components/admin/GenesisForm";
import OptionSynthesizer from "@/components/admin/OptionSynthesizer";
import StoryBibleViewer from "@/components/admin/StoryBibleViewer";
import PhaseTimer from "@/components/game/PhaseTimer";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import type { Episode, GamePhase, GameState } from "@/types/database";
import { listSubmissions, resetCampaign } from "@/app/admin/actions";

const GAME_STATE_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

type AdminStatusResponse =
  | {
      ok: true;
      userId: string;
      isAdmin: boolean;
    }
  | {
      ok: false;
      error: string;
    };

async function safeReadJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${res.status}). ${text.slice(0, 200)}`);
  }
}

export default function AdminPanel() {
  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [gameState, setGameState] = useState<GameState | null>(null);

  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [submissionsMessage, setSubmissionsMessage] = useState<string | null>(null);
  const [submissions, setSubmissions] = useState<
    {
      id: string;
      episodeId: string;
      episodeLabel: string;
      userId: string;
      username: string | null;
      contentText: string;
      isSynthetic: boolean;
      heat: number;
      createdAt: string | null;
    }[]
  >([]);
  const [submissionsOffset, setSubmissionsOffset] = useState(0);
  const [submissionsEpisodeId, setSubmissionsEpisodeId] = useState<string>("");
  const submissionsPageSize = 50;

  const currentEpisode = useMemo(() => {
    if (!gameState?.current_episode_id) return null;
    return episodes.find((ep) => ep.id === gameState.current_episode_id) ?? null;
  }, [episodes, gameState]);

  const [selectedPhase, setSelectedPhase] = useState<GamePhase>("LISTEN");
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | "">("");

  const refreshClientData = useCallback(async () => {
    const [episodesAttempt, singletonQuery] = await Promise.all([
      supabase
        .from("episodes")
        .select("id,title,narrative_text,audio_url,season_num,episode_num,credited_authors")
        .order("season_num", { ascending: true })
        .order("episode_num", { ascending: true }),
      supabase
        .from("game_state")
        .select("id,current_phase,current_episode_id,current_series_bible_id,phase_expiry")
        .eq("id", GAME_STATE_SINGLETON_ID)
        .maybeSingle(),
    ]);

    let episodesData = episodesAttempt.data;
    let episodesError = episodesAttempt.error;

    if (episodesError) {
      const msg = episodesError.message.toLowerCase();
      const missingCreditColumn = msg.includes("credited_authors");
      if (missingCreditColumn) {
        const fallback = await supabase
          .from("episodes")
          .select("id,title,narrative_text,audio_url,season_num,episode_num")
          .order("season_num", { ascending: true })
          .order("episode_num", { ascending: true });
        episodesData = fallback.data ? fallback.data.map((e) => ({ ...e, credited_authors: null })) : null;
        episodesError = fallback.error;
      }
    }

    if (episodesError) {
      setMessage(episodesError.message);
    } else {
      setEpisodes(((episodesData ?? []) as Episode[]) ?? []);
    }

    let { data: singletonState, error: singletonError } = singletonQuery;

    if (singletonError) {
      const msg = singletonError.message.toLowerCase();
      const missingExpiryColumn = msg.includes("phase_expiry");
      if (missingExpiryColumn && !singletonError.message.includes("column game_state.id")) {
        ({ data: singletonState, error: singletonError } = await supabase
          .from("game_state")
          .select("id,current_phase,current_episode_id,current_series_bible_id")
          .eq("id", GAME_STATE_SINGLETON_ID)
          .maybeSingle());
      }
    }

    if (singletonError?.message?.includes("column game_state.id")) {
      type LegacyRow = { current_phase: GamePhase; current_episode_id: string | null; phase_expiry?: string | null };

      let legacyStates: LegacyRow[] | null = null;
      let legacyError: { message: string } | null = null;

      const legacyAttempt = await supabase
        .from("game_state")
        .select("current_phase,current_episode_id,phase_expiry")
        .limit(1);

      legacyStates = ((legacyAttempt.data as unknown) as LegacyRow[] | null) ?? null;
      legacyError = legacyAttempt.error;

      if (legacyError) {
        const msg = legacyError.message.toLowerCase();
        const missingExpiryColumn = msg.includes("phase_expiry");
        if (missingExpiryColumn) {
          const fallbackAttempt = await supabase.from("game_state").select("current_phase,current_episode_id").limit(1);
          legacyStates = ((fallbackAttempt.data as unknown) as LegacyRow[] | null) ?? null;
          legacyError = fallbackAttempt.error;
        }
      }

      if (legacyError) {
        setMessage(legacyError.message);
        setGameState(null);
        return;
      }

      const legacy = legacyStates?.[0] ?? null;
      setGameState(
        legacy
          ? {
              id: GAME_STATE_SINGLETON_ID,
              current_phase: legacy.current_phase as GamePhase,
              current_episode_id: legacy.current_episode_id,
              phase_expiry: (legacy as { phase_expiry?: string | null }).phase_expiry ?? null,
            }
          : null,
      );

      if (legacy) {
        setSelectedPhase(legacy.current_phase as GamePhase);
        setSelectedEpisodeId(legacy.current_episode_id ?? "");
      }

      return;
    }

    if (singletonError) {
      // Backward compatible fallback if current_series_bible_id doesn't exist yet.
      const msg = singletonError.message.toLowerCase();
      const missingBibleColumn = msg.includes("current_series_bible_id") || msg.includes("schema cache") || msg.includes("column");
      if (missingBibleColumn) {
        const { data: fallbackState, error: fallbackError } = await supabase
          .from("game_state")
          .select("id,current_phase,current_episode_id")
          .eq("id", GAME_STATE_SINGLETON_ID)
          .maybeSingle();

        if (fallbackError) {
          setMessage(fallbackError.message);
          setGameState(null);
          return;
        }

        const gsFallback = (fallbackState as GameState | null) ?? null;
        setGameState(gsFallback);
        if (gsFallback) {
          setSelectedPhase(gsFallback.current_phase);
          setSelectedEpisodeId(gsFallback.current_episode_id ?? "");
        }
        return;
      }

      setMessage(singletonError.message);
      setGameState(null);
      return;
    }

    const gs = (singletonState as GameState | null) ?? null;
    setGameState(gs);
    if (gs) {
      setSelectedPhase(gs.current_phase);
      setSelectedEpisodeId(gs.current_episode_id ?? "");
    }
  }, [supabase]);

  const refreshAuth = useCallback(async () => {
    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setLoading(false);
      setMessage(error.message);
      return;
    }

    const token = data.session?.access_token ?? null;
    const uid = data.session?.user?.id ?? null;

    setAccessToken(token);
    setUserId(uid);

    if (!token) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    const res = await fetch("/api/admin/status", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    let status: AdminStatusResponse;
    try {
      status = await safeReadJson<AdminStatusResponse>(res);
    } catch (e) {
      setIsAdmin(false);
      setLoading(false);
      setMessage(e instanceof Error ? e.message : "Failed to read admin status.");
      return;
    }

    if (!status.ok) {
      setIsAdmin(false);
      setLoading(false);
      setMessage(status.error);
      return;
    }

    setIsAdmin(status.isAdmin);

    await refreshClientData();
    setLoading(false);
  }, [refreshClientData, supabase]);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshAuth();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      void refreshAuth();
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [refreshAuth, supabase]);

  const formatCreatedAt = useCallback((value: string | null) => {
    if (!value) return "";
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return value;
    return d.toLocaleString();
  }, []);

  const loadSubmissions = useCallback(
    async (mode: "reset" | "append") => {
      if (!accessToken) return;
      if (!isAdmin) return;

      setSubmissionsLoading(true);
      setSubmissionsMessage(null);

      const offset = mode === "append" ? submissionsOffset : 0;
      const res = await listSubmissions({
        accessToken,
        limit: submissionsPageSize,
        offset,
        episodeId: submissionsEpisodeId.trim() ? submissionsEpisodeId.trim() : undefined,
      });

      if (!res.ok) {
        setSubmissionsLoading(false);
        setSubmissionsMessage(res.error);
        return;
      }

      if (mode === "append") {
        setSubmissions((prev) => [...prev, ...res.submissions]);
        setSubmissionsOffset(offset + res.submissions.length);
      } else {
        setSubmissions(res.submissions);
        setSubmissionsOffset(res.submissions.length);
      }

      setSubmissionsLoading(false);
    },
    [accessToken, isAdmin, submissionsEpisodeId, submissionsOffset],
  );

  useEffect(() => {
    if (!accessToken || !isAdmin) return;
    void loadSubmissions("reset");
  }, [accessToken, isAdmin, submissionsEpisodeId, loadSubmissions]);

  async function handleSignOut() {
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signOut();
    setLoading(false);
    if (error) {
      setMessage(error.message);
    }
  }

  async function handleSave() {
    setMessage(null);

    if (!accessToken) {
      setMessage("Not signed in.");
      return;
    }

    if (!isAdmin) {
      setMessage("Not an admin.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/admin/game-state", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        current_phase: selectedPhase,
        current_episode_id: selectedEpisodeId === "" ? null : selectedEpisodeId,
      }),
    });

    let json: { ok: boolean; error?: string };
    try {
      json = await safeReadJson<{ ok: boolean; error?: string }>(res);
    } catch (e) {
      setLoading(false);
      setMessage(e instanceof Error ? e.message : "Failed to read server response.");
      return;
    }

    if (!json.ok) {
      setLoading(false);
      setMessage(json.error ?? "Failed to update game state.");
      return;
    }

    await refreshClientData();
    setLoading(false);
    setMessage("Saved.");
  }

  async function handleResetCampaign(deleteBible: boolean) {
    setMessage(null);

    if (!accessToken) {
      setMessage("Not signed in.");
      return;
    }

    if (!isAdmin) {
      setMessage("Not an admin.");
      return;
    }

    const confirmed = window.confirm(
      deleteBible
        ? "This will DELETE ALL episodes, submissions, votes, path options, AND the story bible. This cannot be undone. Continue?"
        : "This will DELETE ALL episodes, submissions, votes, and path options (but keep the story bible). This cannot be undone. Continue?",
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      await resetCampaign(accessToken, { deleteBible });
      await refreshClientData();
      setMessage(deleteBible ? "Campaign reset (including story bible)." : "Campaign reset (episodes only)." );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to reset campaign.");
    } finally {
      setLoading(false);
    }
  }

  if (!accessToken) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">You must be signed in to access admin controls.</p>
        <div className="flex items-center gap-3">
          <Button asChild>
            <Link href="/auth">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Signed in as {userId}. You are not an admin.</p>
        <Button variant="secondary" onClick={handleSignOut}>
          Sign out
        </Button>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">Signed in as admin.</p>
          <p className="text-xs text-muted-foreground">User ID: {userId}</p>
        </div>
        <div className="flex items-center gap-4">
          <PhaseTimer phase={gameState?.current_phase ?? null} expiry={gameState?.phase_expiry ?? null} tone="dark" />
          <Button variant="secondary" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>

      <GenesisForm
        accessToken={accessToken!}
        disabled={loading}
        onIgnited={() => {
          void refreshClientData();
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle>Reset Campaign</CardTitle>
          <CardDescription>Destructive. Wipes campaign content so you can start fresh.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void handleResetCampaign(false)} disabled={loading}>
              Reset episodes only
            </Button>
            <Button variant="destructive" onClick={() => void handleResetCampaign(true)} disabled={loading}>
              Full reset (delete bible)
            </Button>
          </div>
          {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        </CardContent>
      </Card>

      <StoryBibleViewer accessToken={accessToken!} disabled={loading} />

      <Card>
        <CardHeader>
          <CardTitle>All Submissions</CardTitle>
          <CardDescription>Browse recent submissions across episodes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Episode</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={submissionsEpisodeId}
                onChange={(e) => {
                  setSubmissionsEpisodeId(e.target.value);
                  setSubmissionsOffset(0);
                }}
              >
                <option value="">All episodes</option>
                {episodes.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    S{ep.season_num}E{ep.episode_num}: {ep.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void loadSubmissions("reset")} disabled={submissionsLoading}>
                {submissionsLoading ? "Loading..." : "Refresh"}
              </Button>
              <Button onClick={() => void loadSubmissions("append")} disabled={submissionsLoading}>
                Load more
              </Button>
            </div>
          </div>

          {submissionsMessage ? <p className="text-sm text-muted-foreground">{submissionsMessage}</p> : null}

          <div className="text-xs text-muted-foreground">Showing {submissions.length} submissions</div>

          <div className="overflow-x-auto rounded-md border border-border">
            <div className="min-w-[900px]">
              <div className="grid grid-cols-[180px_220px_160px_70px_1fr_90px] gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs font-medium">
                <div>Created</div>
                <div>Episode</div>
                <div>User</div>
                <div className="text-right">Heat</div>
                <div>Text</div>
                <div>Type</div>
              </div>
              {submissions.length === 0 ? (
                <div className="px-3 py-4 text-sm text-muted-foreground">No submissions found.</div>
              ) : (
                submissions.map((s) => (
                  <div key={s.id} className="grid grid-cols-[180px_220px_160px_70px_1fr_90px] gap-2 border-b border-border px-3 py-2 text-xs">
                    <div className="text-muted-foreground">{formatCreatedAt(s.createdAt)}</div>
                    <div className="truncate" title={s.episodeLabel}>
                      {s.episodeLabel}
                    </div>
                    <div className="truncate" title={s.userId}>
                      {s.username ?? s.userId}
                    </div>
                    <div className="text-right tabular-nums">{s.heat}</div>
                    <div className="whitespace-pre-wrap break-words">{s.contentText}</div>
                    <div className="text-muted-foreground">{s.isSynthetic ? "synthetic" : "player"}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current state</CardTitle>
          <CardDescription>
            {gameState
              ? `${gameState.current_phase} · episode ${gameState.current_episode_id ?? "(none)"} · bible ${gameState.current_series_bible_id ?? "(none)"}`
              : "No game_state row."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Phase</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedPhase}
                onChange={(e) => setSelectedPhase(e.target.value as GamePhase)}
              >
                <option value="LISTEN">LISTEN</option>
                <option value="SUBMIT">SUBMIT</option>
                <option value="VOTE">VOTE</option>
                <option value="PROCESS">PROCESS</option>
              </select>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Current episode</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={selectedEpisodeId}
                onChange={(e) => setSelectedEpisodeId(e.target.value)}
              >
                <option value="">(none)</option>
                {episodes.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    S{ep.season_num}E{ep.episode_num}: {ep.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={loading}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => void refreshClientData()} disabled={loading}>
                Refresh
              </Button>
            </div>

            {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
          </div>
        </CardContent>
      </Card>

      {gameState?.current_phase === "PROCESS" ? (
        currentEpisode ? (
          <EpisodeManager
            accessToken={accessToken!}
            currentEpisode={currentEpisode}
            onPublished={() => {
              void refreshClientData();
            }}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Episode Manager</CardTitle>
              <CardDescription>Set a current episode in game_state to manage the round.</CardDescription>
            </CardHeader>
          </Card>
        )
      ) : null}

      {gameState?.current_phase === "SUBMIT" ? (
        currentEpisode ? (
          <OptionSynthesizer
            accessToken={accessToken!}
            episodeId={currentEpisode.id}
            disabled={loading}
            onOpened={() => {
              void refreshClientData();
            }}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Option Synthesizer</CardTitle>
              <CardDescription>Set a current episode in game_state to synthesize paths for voting.</CardDescription>
            </CardHeader>
          </Card>
        )
      ) : null}
    </div>
  );
}
