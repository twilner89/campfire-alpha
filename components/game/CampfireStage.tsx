"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { useTypewriter } from "@/components/game/useTypewriter";
import PhaseTimer from "@/components/game/PhaseTimer";
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
  const isIntroFallback = !(episode?.audio_url ?? "").trim() && !!(introAudioUrl ?? "").trim();
  const audioUrl = ((episode?.audio_url ?? "").trim() || (introAudioUrl ?? "").trim()).trim();

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
    if (!shouldAutoplay) return;
    const el = audioRef.current;
    if (!el) return;

    el.currentTime = 0;
    el.load();
    void el.play().catch(() => {
      // Autoplay may be blocked; controls remain available.
    });
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
    } catch (e) {
      setSubmitMessage(e instanceof Error ? e.message : "Failed to submit.");
    } finally {
      setSubmitLoading(false);
    }
  }

  const skyDark = phase === "PROCESS";
  const showRunes = phase === "PROCESS";

  return (
    <div className="relative mx-auto aspect-square w-full max-w-4xl overflow-hidden border-4 border-[#2d1b14] bg-black">
        <div
          className={`absolute inset-0 z-0 transition-[filter,opacity] duration-500 ${
            skyDark ? "brightness-75 saturate-75" : "brightness-100"
          }`}
          style={{
            background:
              "radial-gradient(900px 520px at 50% 20%, rgba(24, 74, 160, 0.75) 0%, rgba(2, 4, 14, 0.95) 55%, #000 100%)",
          }}
        />
        <div className="absolute inset-0 z-0 campfire-stars opacity-70" />

        <div className="absolute inset-0 z-10">
          <Image
            src="/assets/pixels/layer_1_arch.png.png"
            alt="Arch"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="pixelated h-full w-full object-cover object-bottom"
          />
        </div>

        <div className="absolute inset-0 z-20">
          <Image
            src="/assets/pixels/layer_2_wizard.png.png"
            alt="Wizard"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="pixelated h-full w-full object-cover object-bottom"
          />
        </div>

        <div className="absolute inset-0 z-30" style={{ filter: "drop-shadow(0 0 18px rgba(255,140,80,0.45))" }}>
          <Image
            src="/assets/pixels/layer_3_fire.png.png"
            alt="Fire"
            fill
            priority
            sizes="(max-width: 768px) 100vw, 768px"
            className="pixelated h-full w-full object-cover object-bottom"
          />
        </div>

        <div className="absolute inset-x-0 top-0 z-30 p-4">
          <div className="pixel-inset flex items-center justify-between rounded-lg bg-stone-950/55 px-3 py-2">
            <div className="font-press-start text-[10px] tracking-wide text-stone-100/90">Campfire Console</div>
            <div className="flex items-center gap-3">
              <div className="font-press-start text-[10px] text-stone-200/70">Next</div>
              <PhaseTimer phase={phase} expiry={gameState.phase_expiry ?? null} />
              <div className="font-press-start text-[10px] text-stone-200/70">{phase ?? "(loading)"}</div>
            </div>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 z-30 px-4 pb-4">
          <div className="pixel-frame rounded-lg bg-stone-950/70 p-3">
            <div className="font-press-start mb-2 text-[10px] text-stone-200/80">{episode ? episode.title : "No active episode"}</div>

            {phase === "LISTEN" && episode?.credited_authors && episode.credited_authors.length > 0 ? (
              <div className="font-press-start mb-2 text-[9px] text-stone-200/70">
                Constructed from the minds of: {episode.credited_authors.map((a) => a.name).join(", ")}
              </div>
            ) : null}

            {(audioUrl && (!episode?.id || phase === "LISTEN" || phase === "SUBMIT")) ? (
              <audio ref={audioRef} className="mb-2 w-full" controls preload="auto" src={audioUrl} />
            ) : null}

            <div
              ref={narrativeRef}
              className={`font-vt323 max-h-28 overflow-y-auto whitespace-pre-wrap text-lg leading-5 text-stone-50/90 transition-opacity duration-300 ${
                phase === "VOTE" ? "opacity-0" : "opacity-100"
              }`}
            >
              {typedNarrative || (phase === "PROCESS" ? "The runes churn..." : "")}
            </div>
          </div>
        </div>

        {phase === "LISTEN" || phase === "SUBMIT" ? (
          <div className="absolute inset-x-0 bottom-0 z-40 px-4 pb-24">
            <div className="campfire-slide-up pixel-frame rounded-lg bg-stone-950/80 p-3">
              {listenedUnlocked ? (
                <>
                  <div className="font-press-start text-[10px] text-stone-100/90">Submit your idea</div>
                  <textarea
                    value={submissionText}
                    onChange={(e) => setSubmissionText(e.target.value)}
                    disabled={submitLoading}
                    rows={3}
                    className="mt-2 w-full resize-none rounded-md bg-black/40 p-2 font-vt323 text-lg leading-5 text-stone-100 outline-none"
                    placeholder="What should happen next?"
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => void handleSubmit()}
                      disabled={submitLoading || phase !== "SUBMIT"}
                      className="pixel-frame pixel-inset rounded-md bg-stone-900/70 px-3 py-2 font-press-start text-[10px] text-stone-100/90 hover:bg-stone-900/80 disabled:opacity-60"
                    >
                      {submitLoading ? "Submitting..." : "Submit"}
                    </button>
                    <div className="font-vt323 text-lg text-stone-100/80">{submitMessage ?? ""}</div>
                  </div>
                </>
              ) : (
                <>
                  <div className="font-press-start text-[10px] text-stone-100/90">Listen to unlock submissions</div>
                  <div className="font-vt323 mt-2 text-lg leading-5 text-stone-100/80">
                    Submissions unlock after you’ve listened to at least 80% of the episode.
                  </div>
                  <textarea
                    value={submissionText}
                    onChange={(e) => setSubmissionText(e.target.value)}
                    disabled={submitLoading}
                    rows={3}
                    className="mt-2 w-full resize-none rounded-md bg-black/40 p-2 font-vt323 text-lg leading-5 text-stone-100 outline-none"
                    placeholder="Draft your idea while you listen..."
                  />
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => markListened()}
                      className="pixel-frame pixel-inset rounded-md bg-stone-900/70 px-3 py-2 font-press-start text-[10px] text-stone-100/90 hover:bg-stone-900/80"
                    >
                      I’ve listened
                    </button>
                    <div className="font-vt323 text-lg text-stone-100/80">{submitMessage ?? ""}</div>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : null}

        {phase === "VOTE" ? (
          <div className="absolute inset-x-0 bottom-0 z-40 px-4 pb-24">
            <div className="campfire-slide-up grid gap-2">
              {loadingOptions ? (
                <div className="pixel-frame font-vt323 rounded-lg bg-stone-950/80 p-3 text-lg text-stone-200/80">Loading choices...</div>
              ) : options.length === 0 ? (
                <div className="pixel-frame font-vt323 rounded-lg bg-stone-950/80 p-3 text-lg text-stone-200/80">No choices yet.</div>
              ) : (
                options.map((o) => (
                  <button
                    key={o.id}
                    className="pixel-frame pixel-inset group rounded-lg bg-stone-950/75 p-3 text-left transition-colors hover:bg-stone-950/85"
                    onClick={() => void handleVote(o.id)}
                    disabled={voteLoading !== null}
                    type="button"
                  >
                    <div className="font-press-start text-[10px] text-stone-100/90 group-hover:text-white">{o.title}</div>
                    <div className="font-vt323 mt-1 text-lg leading-5 text-stone-200/90">{o.description}</div>
                  </button>
                ))
              )}

              {voteMessage ? (
                <div className="font-vt323 text-center text-lg text-stone-100/80">{voteMessage}</div>
              ) : null}
            </div>
          </div>
        ) : null}

        {showRunes ? <div className="pointer-events-none absolute inset-0 z-50 campfire-runes opacity-80" /> : null}
    </div>
  );
}
