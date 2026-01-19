"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import CampfireOwl from "@/components/game/CampfireOwl";
import CampfireConsole from "@/components/game/CampfireConsole";
import CampfireEchoes from "@/components/game/CampfireEchoes";
import { useTypewriter } from "@/components/game/useTypewriter";
import { getFireHealth } from "@/app/game/actions";
import type { Episode, GamePhase } from "@/types/database";

type OptionRow = {
  id: string;
  title: string;
  description: string;
};

export default function CampfireStage(props: {
  episode: Episode | null;
  introAudioUrl: string | null;
  gameState: { current_phase: GamePhase | null; current_episode_id: string | null; phase_expiry: string | null };
  onVote: (optionId: string) => Promise<void>;
}) {
  const { episode, introAudioUrl, gameState, onVote } = props;

  const phase = gameState.current_phase;
  const supabase = useMemo(() => {
    try {
      return createBrowserSupabaseClient();
    } catch {
      return null;
    }
  }, []);

  const [options, setOptions] = useState<OptionRow[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [voteLoading, setVoteLoading] = useState<string | null>(null);
  const [voteMessage, setVoteMessage] = useState<string | null>(null);

  const [submissionText, setSubmissionText] = useState("");
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [fireHealth, setFireHealth] = useState(0);
  const [echoRefreshKey, setEchoRefreshKey] = useState(0);
  const isIntroFallback = !(episode?.audio_url ?? "").trim() && !!(introAudioUrl ?? "").trim();
  const audioUrl = ((episode?.audio_url ?? "").trim() || (introAudioUrl ?? "").trim()).trim();

  const handleManualPlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    void el.play().then(
      () => {
        setNeedsManualPlay(false);
      },
      () => {
        setNeedsManualPlay(true);
      },
    );
  }, []);

  useEffect(() => {
    setIsAudioPlaying(false);
  }, [audioUrl]);

  useEffect(() => {
    const episodeId = episode?.id ?? null;
    if (!episodeId) {
      setFireHealth(0);
      return;
    }
    if (phase !== "SUBMIT") {
      return;
    }

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await getFireHealth(episodeId);
        if (cancelled) return;
        setFireHealth((prev) => Math.max(prev, res.percent));
      } catch {
        // ignore
      }
    };

    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [episode?.id, phase]);

  const listenedKey = useMemo(() => {
    if (!episode?.id) return null;
    return `campfire_listened:${episode.id}`;
  }, [episode?.id]);

  const [listenedUnlocked, setListenedUnlocked] = useState(false);

  useEffect(() => {
    if (!listenedKey) {
      setListenedUnlocked(false);
      return;
    }

    try {
      setListenedUnlocked(window.localStorage.getItem(listenedKey) === "1");
    } catch {
      setListenedUnlocked(false);
    }
  }, [listenedKey]);

  const markListened = useCallback(() => {
    setListenedUnlocked(true);
    if (!listenedKey) return;
    try {
      window.localStorage.setItem(listenedKey, "1");
    } catch {
      // ignore
    }
  }, [listenedKey]);

  const narrativeRef = useRef<HTMLDivElement | null>(null);
  const narrative = (episode?.narrative_text ?? "").trim();
  const typedNarrative = useTypewriter(narrative, {
    speedMs: 30,
    enabled: phase === "LISTEN" || phase === "PROCESS" || phase === "SUBMIT" || phase === "VOTE",
    containerRef: narrativeRef,
    onChar: undefined,
  });

  useEffect(() => {
    if (!audioUrl) return;
    const shouldAutoplay = isIntroFallback || phase === "LISTEN" || phase === "SUBMIT";
    if (!shouldAutoplay) {
      setNeedsManualPlay(false);
      return;
    }
    const el = audioRef.current;
    if (!el) return;

    el.currentTime = 0;
    el.load();
    void el.play().then(
      () => {
        setNeedsManualPlay(false);
      },
      () => {
        setNeedsManualPlay(true);
        // Autoplay may be blocked; controls remain available.
      },
    );
  }, [audioUrl, isIntroFallback, phase]);

  useEffect(() => {
    if (phase !== "LISTEN" && phase !== "SUBMIT") return;
    if (!audioUrl) return;
    if (listenedUnlocked) return;
    const el = audioRef.current;
    if (!el) return;

    const onTimeUpdate = () => {
      const duration = el.duration;
      if (!Number.isFinite(duration) || duration <= 0) return;
      const ratio = el.currentTime / duration;
      if (ratio >= 0.8) {
        markListened();
      }
    };

    const onEnded = () => {
      markListened();
    };

    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("ended", onEnded);
    return () => {
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("ended", onEnded);
    };
  }, [audioUrl, listenedUnlocked, markListened, phase]);

  useEffect(() => {
    if (!supabase) return;
    if (phase !== "VOTE") {
      setOptions([]);
      setVoteLoading(null);
      return;
    }
    if (!episode?.id) {
      setOptions([]);
      return;
    }

    const sb = supabase;
    const episodeId = episode.id;

    let cancelled = false;
    setVoteMessage(null);

    async function fetchOptions() {
      setLoadingOptions(true);
      try {
        const { data, error } = await sb
          .from("path_options")
          .select("id,title,description")
          .eq("episode_id", episodeId)
          .order("title", { ascending: true });

        if (cancelled) return;
        if (error) {
          setVoteMessage(error.message);
          setOptions([]);
          return;
        }
        setOptions((data ?? []) as OptionRow[]);
      } finally {
        if (cancelled) return;
        setLoadingOptions(false);
      }
    }

    void fetchOptions();

    const channel = sb
      .channel(`realtime:path_options:${episodeId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "path_options",
          filter: `episode_id=eq.${episodeId}`,
        },
        () => {
          void fetchOptions();
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void sb.removeChannel(channel);
    };
  }, [episode?.id, phase, supabase]);

  async function handleVote(optionId: string) {
    setVoteLoading(optionId);
    setVoteMessage(null);
    try {
      await onVote(optionId);
      setVoteMessage("Voted!");
    } catch (e) {
      setVoteMessage(e instanceof Error ? e.message : "Failed to vote.");
    } finally {
      setVoteLoading(null);
    }
  }

  async function handleSubmit() {
    if (phase !== "SUBMIT") {
      setSubmitMessage("Submissions open when the phase switches to SUBMIT.");
      return;
    }
    if (!listenedUnlocked) {
      setSubmitMessage("Listen to at least 80% to unlock submissions.");
      return;
    }
    if (!supabase) {
      setSubmitMessage("Supabase client not configured.");
      return;
    }
    if (!episode?.id) {
      setSubmitMessage("No active episode.");
      return;
    }
    const text = submissionText.trim();
    if (!text) {
      setSubmitMessage("Please enter a submission.");
      return;
    }

    setSubmitLoading(true);
    setSubmitMessage(null);

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw new Error(error.message);
      const userId = data.session?.user.id ?? null;
      if (!userId) throw new Error("You must be signed in to submit.");

      const { error: insertError } = await supabase.from("submissions").insert({
        user_id: userId,
        episode_id: episode.id,
        content_text: text,
      });

      if (insertError) throw new Error(insertError.message);

      setSubmissionText("");
      setSubmitMessage("Submitted!");
      setEchoRefreshKey((k) => k + 1);
      try {
        const res = await getFireHealth(episode.id);
        setFireHealth((prev) => Math.max(prev, res.percent));
      } catch {
        // ignore
      }
    } catch (e) {
      setSubmitMessage(e instanceof Error ? e.message : "Failed to submit.");
    } finally {
      setSubmitLoading(false);
    }
  }

  const skyDark = phase === "PROCESS";
  const showRunes = phase === "PROCESS";

  return (
    <div className="flex h-full w-full flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          src="/assets/pixels/campfire-loop.mp4"
        />

        {phase === "SUBMIT" && episode?.id ? (
          <CampfireEchoes
            episodeId={episode.id}
            refreshKey={echoRefreshKey}
            onStoke={() => {
              setFireHealth((prev) => Math.min(100, prev + 2));
            }}
          />
        ) : null}

        <div className="pointer-events-none absolute left-[33%] bottom-[22%] w-[10%] z-10 brightness-75 contrast-110 grayscale-[0.2]">
          <CampfireOwl isTalking={isAudioPlaying} />
        </div>

        {needsManualPlay ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center">
            <button
              type="button"
              onClick={handleManualPlay}
              className="border-4 border-white bg-black px-6 py-2 font-press-start text-[12px] text-white hover:bg-white hover:text-black"
            >
              Play
            </button>
          </div>
        ) : null}

        {showRunes ? <div className="pointer-events-none absolute inset-0 z-30 campfire-runes opacity-80" /> : null}
      </div>

      <CampfireConsole fireHealth={fireHealth} phase={phase} expiry={gameState.phase_expiry ?? null}>
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <div className="font-press-start text-[10px] text-slate-200/80">{episode ? episode.title : "No active episode"}</div>

            {phase === "LISTEN" && episode?.credited_authors && episode.credited_authors.length > 0 ? (
              <div className="mt-2 font-press-start text-[9px] text-slate-200/70">
                Constructed from the minds of: {episode.credited_authors.map((a) => a.name).join(", ")}
              </div>
            ) : null}

            <div
              ref={narrativeRef}
              className={`mt-2 flex-1 overflow-y-auto whitespace-pre-wrap font-vt323 text-lg leading-5 text-slate-50/90 transition-opacity duration-300 ${
                phase === "VOTE" ? "opacity-0" : "opacity-100"
              } max-w-[65ch] mx-auto`}
            >
              {typedNarrative || (phase === "PROCESS" ? "The runes churn..." : "")}
            </div>

            {(audioUrl && (!episode?.id || phase === "LISTEN" || phase === "SUBMIT")) ? (
              <audio
                ref={audioRef}
                className="mt-2 w-full"
                style={{ filter: "invert(1) contrast(1.2)" }}
                controls
                preload="auto"
                src={audioUrl}
                onPlay={() => setIsAudioPlaying(true)}
                onPause={() => setIsAudioPlaying(false)}
                onEnded={() => setIsAudioPlaying(false)}
              />
            ) : null}
        </div>

        <div className="w-[360px] max-w-[45%] shrink-0">
            {phase === "VOTE" ? (
              <div className="h-full overflow-y-auto">
                <div className="grid gap-2">
                  {loadingOptions ? (
                    <div className="pixel-frame rounded-lg bg-black p-3 font-vt323 text-lg text-white/80">Loading choices...</div>
                  ) : options.length === 0 ? (
                    <div className="pixel-frame rounded-lg bg-black p-3 font-vt323 text-lg text-white/80">No choices yet.</div>
                  ) : (
                    options.map((o) => (
                      <button
                        key={o.id}
                        className="pixel-frame pixel-inset group rounded-lg bg-black p-3 text-left transition-colors hover:bg-black/80"
                        onClick={() => void handleVote(o.id)}
                        disabled={voteLoading !== null}
                        type="button"
                      >
                        <div className="font-press-start text-[10px] text-white/90 group-hover:text-white">{o.title}</div>
                        <div className="mt-1 font-vt323 text-lg leading-5 text-white/80">{o.description}</div>
                      </button>
                    ))
                  )}

                  {voteMessage ? <div className="font-vt323 text-center text-lg text-white/80">{voteMessage}</div> : null}
                </div>
              </div>
            ) : phase === "LISTEN" || phase === "SUBMIT" ? (
              <div className="pixel-frame h-full rounded-lg bg-black p-3">
                {listenedUnlocked ? (
                  <>
                    <div className="font-press-start text-[10px] text-white/90">Submit your idea</div>
                    <textarea
                      value={submissionText}
                      onChange={(e) => setSubmissionText(e.target.value)}
                      disabled={submitLoading}
                      rows={4}
                      className="mt-2 w-full resize-none border-2 border-slate-500 bg-black p-2 font-vt323 text-lg leading-5 text-white outline-none"
                      placeholder="What should happen next?"
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={submitLoading || phase !== "SUBMIT"}
                        className="border-2 border-white bg-black px-3 py-2 font-press-start text-[10px] text-white hover:bg-white hover:text-black disabled:opacity-60"
                      >
                        {submitLoading ? "Submitting..." : "Submit"}
                      </button>
                      <div className="font-vt323 text-lg text-white/80">{submitMessage ?? ""}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-press-start text-[10px] text-white/90">Listen to unlock submissions</div>
                    <div className="mt-2 font-vt323 text-lg leading-5 text-white/80">
                      Submissions unlock after you’ve listened to at least 80% of the episode.
                    </div>
                    <textarea
                      value={submissionText}
                      onChange={(e) => setSubmissionText(e.target.value)}
                      disabled={submitLoading}
                      rows={4}
                      className="mt-2 w-full resize-none border-2 border-slate-500 bg-black p-2 font-vt323 text-lg leading-5 text-white outline-none"
                      placeholder="Draft your idea while you listen..."
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <button
                        type="button"
                        onClick={() => markListened()}
                        className="border-2 border-white bg-black px-3 py-2 font-press-start text-[10px] text-white hover:bg-white hover:text-black"
                      >
                        I’ve listened
                      </button>
                      <div className="font-vt323 text-lg text-white/80">{submitMessage ?? ""}</div>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="pixel-frame h-full rounded-lg bg-black p-3">
                <div className="font-vt323 text-lg text-white/80">Waiting for the next phase...</div>
              </div>
            )}
        </div>
      </CampfireConsole>
    </div>
  );
}
