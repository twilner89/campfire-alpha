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
