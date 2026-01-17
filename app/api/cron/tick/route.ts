import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DURATION_PROCESS, DURATION_SUBMIT, DURATION_VOTE } from "@/lib/game/schedule";
import { synthesizeOptions } from "@/lib/ai/director";
import type { Database } from "@/types/database";

export const runtime = "nodejs";

const GAME_STATE_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";
const STALE_TRANSITION_MS = 30 * 60 * 1000;

function readCronSecret(request: Request) {
  return (
    request.headers.get("cron_secret") ??
    request.headers.get("cron-secret") ??
    request.headers.get("x-cron-secret") ??
    request.headers.get("CRON_SECRET")
  );
}

function durationForPhase(phase: Database["public"]["Enums"]["game_phase"]) {
  if (phase === "SUBMIT") return DURATION_SUBMIT;
  if (phase === "VOTE") return DURATION_VOTE;
  if (phase === "PROCESS") return DURATION_PROCESS;
  return DURATION_SUBMIT;
}

export async function GET(request: Request) {
  try {
    const expectedSecret = (process.env["CRON_SECRET"] ?? "").trim();
    if (!expectedSecret) {
      return NextResponse.json({ ok: false, error: "Missing CRON_SECRET server env var." }, { status: 500 });
    }

    const providedSecret = (readCronSecret(request) ?? "").trim();
    if (!providedSecret || providedSecret !== expectedSecret) {
      return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
    }

    const adminClient = createServerSupabaseClient({ admin: true });

    const { data: state, error: stateError } = await adminClient
      .from("game_state")
      .select("current_phase,current_episode_id,phase_expiry,is_transitioning,transitioning_since")
      .eq("id", GAME_STATE_SINGLETON_ID)
      .maybeSingle();

    if (stateError) {
      return NextResponse.json({ ok: false, error: stateError.message }, { status: 500 });
    }

    const gs = (state as
      | {
          current_phase: Database["public"]["Enums"]["game_phase"];
          current_episode_id: string | null;
          phase_expiry?: string | null;
          is_transitioning?: boolean;
          transitioning_since?: string | null;
        }
      | null) ?? null;

    if (!gs) {
      return NextResponse.json({ ok: false, error: "Game state not found." }, { status: 500 });
    }

    const nowMs = Date.now();

    if (gs.is_transitioning) {
      const sinceMs = gs.transitioning_since ? new Date(gs.transitioning_since).getTime() : null;
      const isStale = sinceMs && Number.isFinite(sinceMs) ? nowMs - sinceMs > STALE_TRANSITION_MS : false;

      if (!isStale) {
        return NextResponse.json({ ok: true, status: "Transitioning", phase: gs.current_phase, phase_expiry: gs.phase_expiry ?? null });
      }

      const { error: clearError } = await adminClient
        .from("game_state")
        .update({ is_transitioning: false, transitioning_since: null })
        .eq("id", GAME_STATE_SINGLETON_ID);

      if (clearError) {
        return NextResponse.json({ ok: false, error: clearError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, status: "Recovered stale transition lock" });
    }

    if (!gs.phase_expiry) {
      const phase = gs.current_phase === "LISTEN" ? "SUBMIT" : gs.current_phase;
      const expiry = new Date(nowMs + durationForPhase(phase)).toISOString();

      const { error: initError } = await adminClient
        .from("game_state")
        .update({ current_phase: phase, phase_expiry: expiry })
        .eq("id", GAME_STATE_SINGLETON_ID);

      if (initError) {
        return NextResponse.json({ ok: false, error: initError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, status: "Initialized", phase, phase_expiry: expiry });
    }

    const expiryMs = new Date(gs.phase_expiry).getTime();
    if (!Number.isFinite(expiryMs)) {
      return NextResponse.json({ ok: false, error: "Invalid phase_expiry timestamp." }, { status: 500 });
    }

    if (nowMs < expiryMs) {
      return NextResponse.json({ ok: true, status: "Waiting", phase: gs.current_phase, phase_expiry: gs.phase_expiry });
    }

    const nowIso = new Date(nowMs).toISOString();

    const claimAttempt = await adminClient
      .from("game_state")
      .update({ is_transitioning: true, transitioning_since: nowIso })
      .eq("id", GAME_STATE_SINGLETON_ID)
      .eq("is_transitioning", false)
      .eq("current_phase", gs.current_phase)
      .eq("phase_expiry", gs.phase_expiry)
      .select("id")
      .maybeSingle();

    if (claimAttempt.error) {
      return NextResponse.json({ ok: false, error: claimAttempt.error.message }, { status: 500 });
    }

    if (!claimAttempt.data) {
      return NextResponse.json({ ok: true, status: "Transitioning" });
    }

    try {
      if (gs.current_phase === "LISTEN" || gs.current_phase === "SUBMIT") {
        const episodeId = gs.current_episode_id;
        if (!episodeId) {
          throw new Error("No active episode.");
        }

        let drafts: { title: string; description: string; source_submission_ids?: string[] | null }[];

        try {
          drafts = await synthesizeOptions(episodeId);
        } catch (e) {
          const { data: submissions, error: subError } = await adminClient
            .from("submissions")
            .select("id,content_text,is_synthetic")
            .eq("episode_id", episodeId)
            .limit(3);

          if (subError) throw new Error(subError.message);

          const rows = (submissions ?? []) as { id: string; content_text?: string | null; is_synthetic?: boolean }[];
          const cleanedSubmissions = rows
            .map((s) => ({ id: s.id, text: (s.content_text ?? "").trim(), is_synthetic: !!s.is_synthetic }))
            .filter((s) => s.id && s.text);

          const isAllSynthetic = cleanedSubmissions.length > 0 ? cleanedSubmissions.every((s) => s.is_synthetic) : false;

          drafts = cleanedSubmissions.slice(0, 3).map((s, idx) => ({
            title: s.text.slice(0, 40) || `Option ${idx + 1}`,
            description: s.text,
            source_submission_ids: isAllSynthetic ? [] : [s.id],
          }));

          while (drafts.length < 3) {
            const idx = drafts.length;
            drafts.push({
              title: `Option ${idx + 1}`,
              description: "The campfire holds its breath...",
              source_submission_ids: null,
            });
          }
        }

        const cleaned = drafts.map((o) => ({
          title: o.title.trim(),
          description: o.description.trim(),
          source_submission_ids: Array.isArray(o.source_submission_ids) ? o.source_submission_ids : null,
        }));

        const { error: deleteError } = await adminClient.from("path_options").delete().eq("episode_id", episodeId);
        if (deleteError) throw new Error(deleteError.message);

        const insertAttempt = await adminClient.from("path_options").insert(
          cleaned.map((o) => ({
            episode_id: episodeId,
            title: o.title,
            description: o.description,
            source_submission_ids: o.source_submission_ids,
          })),
        );

        if (insertAttempt.error) {
          const msg = insertAttempt.error.message.toLowerCase();
          const missingAttributionColumn = msg.includes("source_submission_ids");
          if (!missingAttributionColumn) throw new Error(insertAttempt.error.message);

          const fallbackAttempt = await adminClient.from("path_options").insert(
            cleaned.map((o) => ({
              episode_id: episodeId,
              title: o.title,
              description: o.description,
            })),
          );

          if (fallbackAttempt.error) throw new Error(fallbackAttempt.error.message);
        }

        const nextExpiry = new Date(nowMs + DURATION_VOTE).toISOString();
        const { error: phaseError } = await adminClient
          .from("game_state")
          .update({ current_phase: "VOTE", phase_expiry: nextExpiry })
          .eq("id", GAME_STATE_SINGLETON_ID);

        if (phaseError) throw new Error(phaseError.message);

        return NextResponse.json({ ok: true, status: "Transitioned", from: gs.current_phase, to: "VOTE", phase_expiry: nextExpiry });
      }

      if (gs.current_phase === "VOTE") {
        const nextExpiry = new Date(nowMs + DURATION_PROCESS).toISOString();
        const { error: phaseError } = await adminClient
          .from("game_state")
          .update({ current_phase: "PROCESS", phase_expiry: nextExpiry })
          .eq("id", GAME_STATE_SINGLETON_ID);

        if (phaseError) throw new Error(phaseError.message);

        return NextResponse.json({ ok: true, status: "Transitioned", from: "VOTE", to: "PROCESS", phase_expiry: nextExpiry });
      }

      if (gs.current_phase === "PROCESS") {
        const episodeId = gs.current_episode_id;
        if (episodeId) {
          const { data: optionRows, error: optionError } = await adminClient
            .from("path_options")
            .select("id")
            .eq("episode_id", episodeId);

          if (optionError) throw new Error(optionError.message);

          const optionIds = (optionRows ?? []).map((r) => (r as { id: string }).id).filter(Boolean);

          if (optionIds.length > 0) {
            const { error: voteDeleteError } = await adminClient.from("votes").delete().in("option_id", optionIds);
            if (voteDeleteError) throw new Error(voteDeleteError.message);
          }

          const { error: optDeleteError } = await adminClient.from("path_options").delete().eq("episode_id", episodeId);
          if (optDeleteError) throw new Error(optDeleteError.message);

          const { error: subDeleteError } = await adminClient.from("submissions").delete().eq("episode_id", episodeId);
          if (subDeleteError) throw new Error(subDeleteError.message);
        }

        const nextExpiry = new Date(nowMs + DURATION_SUBMIT).toISOString();
        const { error: phaseError } = await adminClient
          .from("game_state")
          .update({ current_phase: "SUBMIT", phase_expiry: nextExpiry })
          .eq("id", GAME_STATE_SINGLETON_ID);

        if (phaseError) throw new Error(phaseError.message);

        return NextResponse.json({ ok: true, status: "Transitioned", from: "PROCESS", to: "SUBMIT", phase_expiry: nextExpiry });
      }

      return NextResponse.json({ ok: true, status: "No-op", phase: gs.current_phase, phase_expiry: gs.phase_expiry });
    } finally {
      const { error: unlockError } = await adminClient
        .from("game_state")
        .update({ is_transitioning: false, transitioning_since: null })
        .eq("id", GAME_STATE_SINGLETON_ID);

      if (unlockError) {
        console.error(unlockError.message);
      }
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error." }, { status: 500 });
  }
}
