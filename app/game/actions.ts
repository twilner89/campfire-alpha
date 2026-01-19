"use server";

import { createClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

const GAME_STATE_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

async function requireUser(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Server misconfigured.");
  }

  const userClient = createClient<Database>(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Invalid session.");
  }

  return { userId: userData.user.id };
}

async function fetchGameState(adminClient: ReturnType<typeof createServerSupabaseClient>) {
  const singletonAttempt = await adminClient
    .from("game_state")
    .select("current_phase,current_episode_id,phase_expiry")
    .eq("id", GAME_STATE_SINGLETON_ID)
    .maybeSingle();

  if (!singletonAttempt.error) {
    return (singletonAttempt.data as { current_phase: Database["public"]["Enums"]["game_phase"]; current_episode_id: string | null; phase_expiry?: string | null } | null) ?? null;
  }

  const msg = singletonAttempt.error.message.toLowerCase();
  const missingExpiry = msg.includes("phase_expiry");
  if (!missingExpiry && !singletonAttempt.error.message.includes("column game_state.id")) {
    throw new Error(singletonAttempt.error.message);
  }

  // Legacy fallback (no id column and/or no phase_expiry column)
  const legacyAttempt = missingExpiry
    ? await adminClient.from("game_state").select("current_phase,current_episode_id").limit(1)
    : await adminClient.from("game_state").select("current_phase,current_episode_id,phase_expiry").limit(1);
  if (legacyAttempt.error) {
    throw new Error(legacyAttempt.error.message);
  }
  const row = legacyAttempt.data?.[0] ?? null;
  return (row as { current_phase: Database["public"]["Enums"]["game_phase"]; current_episode_id: string | null; phase_expiry?: string | null } | null) ?? null;
}

export type EchoRow = {
  id: string;
  content_text: string;
  heat: number;
  created_at: string | null;
  user_id?: string;
};

export async function stokeSubmission(accessToken: string, submissionId: string) {
  await requireUser(accessToken);

  const id = (submissionId ?? "").trim();
  if (!id) throw new Error("Missing submission id.");

  const adminClient = createServerSupabaseClient({ admin: true });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data: row, error: readError } = await adminClient
      .from("submissions")
      .select("id,heat")
      .eq("id", id)
      .maybeSingle();

    if (readError) {
      const msg = readError.message.toLowerCase();
      const missingHeatColumn = msg.includes("heat") && (msg.includes("column") || msg.includes("schema cache"));
      if (missingHeatColumn) {
        throw new Error("Database missing submissions.heat column. Apply the migration and try again.");
      }
      throw new Error(readError.message);
    }

    if (!row) {
      throw new Error("Submission not found.");
    }

    const anyRow = row as { id: string; heat?: number | null };
    const currentHeat = anyRow.heat ?? 0;
    const nextHeat = currentHeat + 1;

    let update = adminClient.from("submissions").update({ heat: nextHeat }).eq("id", id);
    if (anyRow.heat === null || anyRow.heat === undefined) {
      update = update.is("heat", null);
    } else {
      update = update.eq("heat", currentHeat);
    }

    const updateAttempt = await update.select("heat").maybeSingle();
    if (updateAttempt.error) {
      const msg = updateAttempt.error.message.toLowerCase();
      const missingHeatColumn = msg.includes("heat") && (msg.includes("column") || msg.includes("schema cache"));
      if (missingHeatColumn) {
        throw new Error("Database missing submissions.heat column. Apply the migration and try again.");
      }
      throw new Error(updateAttempt.error.message);
    }

    if (updateAttempt.data) {
      const updated = updateAttempt.data as { heat?: number | null };
      return { ok: true as const, heat: updated.heat ?? nextHeat };
    }
  }

  throw new Error("Failed to stoke submission. Please retry.");
}

export async function getRecentEchoes(episodeId: string): Promise<EchoRow[]> {
  const id = (episodeId ?? "").trim();
  if (!id) return [];

  const adminClient = createServerSupabaseClient({ admin: true });

  const isMissingColumn = (msg: string, column: string) => msg.includes(column) && (msg.includes("column") || msg.includes("schema cache"));

  const attempt1 = await adminClient
    .from("submissions")
    .select("id,content_text,created_at,heat")
    .eq("episode_id", id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (!attempt1.error) {
    return ((attempt1.data ?? []) as { id: string; content_text: string; created_at?: string | null; heat?: number | null }[]).map((r) => ({
      id: r.id,
      content_text: r.content_text,
      heat: r.heat ?? 0,
      created_at: r.created_at ?? null,
    }));
  }

  const msg1 = attempt1.error.message.toLowerCase();
  const missingCreatedAt = isMissingColumn(msg1, "created_at");
  const missingHeat = isMissingColumn(msg1, "heat");

  if (missingCreatedAt && !missingHeat) {
    const attempt2 = await adminClient
      .from("submissions")
      .select("id,content_text,heat")
      .eq("episode_id", id)
      .order("id", { ascending: false })
      .limit(30);
    if (attempt2.error) throw new Error(attempt2.error.message);

    return ((attempt2.data ?? []) as { id: string; content_text: string; heat?: number | null }[]).map((r) => ({
      id: r.id,
      content_text: r.content_text,
      heat: r.heat ?? 0,
      created_at: null,
    }));
  }

  if (missingHeat && !missingCreatedAt) {
    const attempt2 = await adminClient
      .from("submissions")
      .select("id,content_text,created_at")
      .eq("episode_id", id)
      .order("created_at", { ascending: false })
      .limit(30);

    if (attempt2.error) throw new Error(attempt2.error.message);

    return ((attempt2.data ?? []) as { id: string; content_text: string; created_at?: string | null }[]).map((r) => ({
      id: r.id,
      content_text: r.content_text,
      heat: 0,
      created_at: r.created_at ?? null,
    }));
  }

  if (missingHeat && missingCreatedAt) {
    const attempt2 = await adminClient
      .from("submissions")
      .select("id,content_text")
      .eq("episode_id", id)
      .order("id", { ascending: false })
      .limit(30);

    if (attempt2.error) throw new Error(attempt2.error.message);

    return ((attempt2.data ?? []) as { id: string; content_text: string }[]).map((r) => ({
      id: r.id,
      content_text: r.content_text,
      heat: 0,
      created_at: null,
    }));
  }

  throw new Error(attempt1.error.message);
}

export async function getFireHealth(episodeId: string): Promise<{ ok: true; percent: number; points: number; target: number }> {
  const id = (episodeId ?? "").trim();
  if (!id) return { ok: true as const, percent: 0, points: 0, target: 200 };

  const adminClient = createServerSupabaseClient({ admin: true });

  const countAttempt = await adminClient.from("submissions").select("id", { count: "exact", head: true }).eq("episode_id", id);
  if (countAttempt.error) throw new Error(countAttempt.error.message);
  const totalSubmissions = countAttempt.count ?? 0;

  let totalHeat = 0;
  const sumAttempt = await adminClient
    .from("submissions")
    .select("heat.sum()")
    .eq("episode_id", id)
    .maybeSingle();

  if (sumAttempt.error) {
    const msg = sumAttempt.error.message.toLowerCase();
    const missingHeatColumn = msg.includes("heat") && (msg.includes("column") || msg.includes("schema cache"));
    if (!missingHeatColumn) {
      throw new Error(sumAttempt.error.message);
    }
  } else {
    const row = (sumAttempt.data as { sum?: number | null } | null) ?? null;
    totalHeat = Number.isFinite(row?.sum as number) ? Math.max(0, Math.floor(row?.sum as number)) : 0;
  }

  const points = totalSubmissions * 2 + totalHeat;
  const target = 200;
  const percent = Math.max(0, Math.min(100, Math.round((points / target) * 100)));
  return { ok: true as const, percent, points, target };
}

export async function castVote(accessToken: string, optionId: string) {
  const { userId } = await requireUser(accessToken);

  if (!optionId || !optionId.trim()) {
    throw new Error("Missing option id.");
  }

  const adminClient = createServerSupabaseClient({ admin: true });

  const gs = await fetchGameState(adminClient);
  if (!gs) {
    throw new Error("Game state unavailable.");
  }

  if (gs.current_phase !== "VOTE") {
    throw new Error("Voting is not open.");
  }

  if (gs.phase_expiry) {
    const expiryMs = new Date(gs.phase_expiry).getTime();
    if (Number.isFinite(expiryMs) && Date.now() > expiryMs) {
      throw new Error("Voting has closed.");
    }
  }

  // Ensure the option belongs to the currently active episode.
  if (gs.current_episode_id) {
    const { data: optionRow, error: optionError } = await adminClient
      .from("path_options")
      .select("episode_id")
      .eq("id", optionId)
      .maybeSingle();

    if (optionError) throw new Error(optionError.message);

    const optionEpisodeId = (optionRow as { episode_id?: string | null } | null)?.episode_id ?? null;
    if (!optionEpisodeId || optionEpisodeId !== gs.current_episode_id) {
      throw new Error("This vote is no longer valid.");
    }
  }

  const { error: insertError } = await adminClient.from("votes").insert({ user_id: userId, option_id: optionId });
  if (insertError) {
    throw new Error(insertError.message);
  }

  return { ok: true as const };
}
