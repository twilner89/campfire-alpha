"use client";

import { useEffect, useMemo, useState } from "react";

import type { GamePhase } from "@/types/database";

function formatTimeLeft(msLeft: number) {
  const totalSeconds = Math.max(0, Math.floor(msLeft / 1000));

  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (days > 0) return `${days}d ${hh}:${mm}:${ss}`;
  if (hours > 0) return `${hh}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

function labelForPhase(phase: GamePhase | null) {
  if (phase === "SUBMIT") return "Submission Window Closes in...";
  if (phase === "VOTE") return "Voting Ends in...";
  if (phase === "PROCESS") return "Next Episode Drops in...";
  return "";
}

function closedForPhase(phase: GamePhase | null) {
  if (phase === "SUBMIT") return "SUBMISSIONS CLOSED";
  if (phase === "VOTE") return "VOTING CLOSED";
  if (phase === "PROCESS") return "COUNTDOWN ENDED";
  return "";
}

export default function PhaseTimer(props: { phase: GamePhase | null; expiry: string | null; tone?: "light" | "dark" }) {
  const { phase, expiry } = props;
  const tone = props.tone ?? "light";

  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    if (!expiry) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [expiry]);

  const { statusText, timeText, isCritical } = useMemo(() => {
    if (!expiry) return { statusText: "", timeText: "", isCritical: false };
    if (nowMs === null) return { statusText: labelForPhase(phase), timeText: "", isCritical: false };
    const expiryMs = new Date(expiry).getTime();
    if (!Number.isFinite(expiryMs)) return { statusText: "", timeText: "", isCritical: false };
    const msLeft = expiryMs - nowMs;
    if (msLeft <= 0) return { statusText: closedForPhase(phase), timeText: "", isCritical: true };
    return { statusText: labelForPhase(phase), timeText: formatTimeLeft(msLeft), isCritical: msLeft <= 60_000 };
  }, [expiry, nowMs, phase]);

  if (!expiry) return null;
  if (!statusText && !timeText) return null;

  return (
    <div
      className={`font-press-start text-[10px] tracking-wide ${
        isCritical
          ? tone === "dark"
            ? "text-orange-700 animate-pulse"
            : "text-orange-300 animate-pulse"
          : tone === "dark"
            ? "text-stone-950"
            : "text-stone-200/80"
      }`}
    >
      {statusText ? <div>{statusText}</div> : null}
      {timeText ? <div>{timeText}</div> : null}
    </div>
  );
}
