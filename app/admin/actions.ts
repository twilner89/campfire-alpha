"use server";

import { createClient } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { synthesizeOptions as synthesizeOptionsInternal } from "@/lib/ai/director";
import { generateChaoticSuggestions } from "@/lib/ai/simulator";
import { generateDramaticaBible, generateOraclePremises } from "@/lib/ai/genesis";
import type { PathOptionDraft } from "@/lib/ai/director";
import type { Database } from "@/types/database";
import type { DramaticaStructure } from "@/types/ncp";

const GAME_STATE_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

type SubmissionStat = {
  submissionId: string;
  userId: string;
  contentText: string;
  voteCount: number;
};

type PathOptionStat = {
  optionId: string;
  title: string;
  description: string;
  voteCount: number;
};

type ActiveSeriesBible = {
  id: string;
  title: string;
  genre: string;
  tone: string;
  premise: string;
  bible_json: DramaticaStructure;
  intro_audio_url: string | null | undefined;
  created_at: string;
};

type ActiveSeriesBibleFallbackRow = Omit<ActiveSeriesBible, "intro_audio_url">;

type BuildContinuityHeaderInput = {
  episodeId: string;
  winningTitle: string;
  winningDescription: string;
  winningOptionId?: string | null;
};

type CanonEpisode = {
  id: string;
  title: string;
  narrative_text: string | null;
  season_num: number;
  episode_num: number;
};

async function updateSingletonGameState(
  adminClient: ReturnType<typeof createServerSupabaseClient>,
  update: {
    current_phase?: Database["public"]["Enums"]["game_phase"];
    current_episode_id?: string | null;
    current_series_bible_id?: string | null;
    phase_expiry?: string | null;
  },
) {
  const tryUpdate = async (payload: typeof update) =>
    adminClient.from("game_state").update(payload).eq("id", GAME_STATE_SINGLETON_ID);

  let { error: singletonError } = await tryUpdate(update);

  if (singletonError) {
    const msg = singletonError.message.toLowerCase();
    const missingBibleColumn = msg.includes("current_series_bible_id");
    const missingExpiryColumn = msg.includes("phase_expiry");

    if (missingBibleColumn && update.current_series_bible_id !== undefined) {
      const fallbackUpdate = { ...update };
      delete (fallbackUpdate as { current_series_bible_id?: unknown }).current_series_bible_id;
      ({ error: singletonError } = await tryUpdate(fallbackUpdate));
    }

    if (singletonError && missingExpiryColumn && update.phase_expiry !== undefined) {
      const fallbackUpdate = { ...update };
      delete (fallbackUpdate as { phase_expiry?: unknown }).phase_expiry;
      ({ error: singletonError } = await tryUpdate(fallbackUpdate));
    }
  }

  if (!singletonError) return;

  // Backward compatible fallback if the singleton id column doesn't exist.
  if (!singletonError.message.includes("column game_state.id")) {
    throw new Error(singletonError.message);
  }

  const { data: legacyStates, error: legacyError } = await adminClient
    .from("game_state")
    .select("current_phase,current_episode_id")
    .limit(1);

  if (legacyError) throw new Error(legacyError.message);
  const old = legacyStates?.[0];
  if (!old) return;

  let legacyPayload: typeof update = update;
  if (update.current_series_bible_id !== undefined) {
    // Legacy schemas won't have this column.
    const fallbackUpdate = { ...update };
    delete (fallbackUpdate as { current_series_bible_id?: unknown }).current_series_bible_id;
    legacyPayload = fallbackUpdate;
  }

  if (update.phase_expiry !== undefined) {
    // Legacy schemas won't have this column.
    const fallbackUpdate = { ...legacyPayload };
    delete (fallbackUpdate as { phase_expiry?: unknown }).phase_expiry;
    legacyPayload = fallbackUpdate;
  }

  let legacyUpdate = adminClient.from("game_state").update(legacyPayload).eq("current_phase", old.current_phase);
  if (old.current_episode_id === null) {
    legacyUpdate = legacyUpdate.is("current_episode_id", null);
  } else {
    legacyUpdate = legacyUpdate.eq("current_episode_id", old.current_episode_id);
  }

  const { error: legacyUpdateError } = await legacyUpdate;
  if (legacyUpdateError) throw new Error(legacyUpdateError.message);
}

function truncateForPrompt(text: string, maxChars: number) {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}…`;
}

function formatBibleSummary(bible: DramaticaStructure) {
  const castEntries = Object.entries(bible.cast ?? {}).filter(([name, v]) => !!name.trim() && !!v);
  const castBlock =
    castEntries.length === 0
      ? ""
      : `\n\nCast / Voice DNA\n${castEntries
          .map(([name, v]) => {
            const role = (v.role ?? "").trim() || "(role unknown)";
            const dna = (v.voice_dna ?? "").trim() || "(voice DNA unknown)";
            const phrases = Array.isArray(v.key_phrases) ? v.key_phrases.map((p) => String(p).trim()).filter(Boolean) : [];
            const phraseText = phrases.length ? phrases.join(" | ") : "(none)";
            return `- ${name.trim()} (${role}): ${dna} Key phrases: ${phraseText}`;
          })
          .join("\n")}`;

  return `Dramatica / NCP Canon Summary

Objective Story
- Domain: ${bible.objective_story.domain}
- Goal: ${bible.objective_story.goal}
- Consequence: ${bible.objective_story.consequence}
- Problem -> Solution: ${bible.objective_story.problem} -> ${bible.objective_story.solution}
- Concern: ${bible.objective_story.concern}
- Issue: ${bible.objective_story.issue}

Main Character
- Name: ${bible.main_character.name}
- Domain: ${bible.main_character.domain}
- Resolve / Growth / Approach: ${bible.main_character.resolve} / ${bible.main_character.growth} / ${bible.main_character.approach}
- Crucial flaw: ${bible.main_character.crucial_flaw}

Influence Character
- Name: ${bible.influence_character.name}
- Domain: ${bible.influence_character.domain}
- Unique ability: ${bible.influence_character.unique_ability}
- Impact: ${bible.influence_character.impact}

Relationship Story
- Domain: ${bible.relationship_story.domain}
- Dynamic: ${bible.relationship_story.dynamic}
- Trust score: ${bible.relationship_story.trust_score}
- Catalyst: ${bible.relationship_story.catalyst}
${castBlock}

Dynamics
- Driver: ${bible.driver}
- Limit: ${bible.limit}
- Outcome / Judgment: ${bible.outcome} / ${bible.judgment}

World State
- Active facts: ${bible.active_facts.join(" | ")}
- Inventory: ${bible.inventory.join(" | ")}`;
}

function formatCanonEpisodes(episodes: CanonEpisode[]) {
  const withText = episodes.filter((e) => (e.narrative_text ?? "").trim().length > 0);
  if (withText.length === 0) return "(no narrative canon found)";
  return withText
    .map((e) => {
      const header = `S${e.season_num}E${e.episode_num}: ${e.title}`;
      const body = truncateForPrompt(e.narrative_text ?? "", 1400);
      return `${header}\n${body}`;
    })
    .join("\n\n---\n\n");
}

async function requireAdmin(accessToken: string) {
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

  const adminClient = createServerSupabaseClient({ admin: true });
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("is_admin")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (profileError) {
    throw new Error(profileError.message);
  }

  if (!profile?.is_admin) {
    throw new Error("Forbidden.");
  }

  return { adminClient, userId: userData.user.id };
}

export async function getSubmissionStats(accessToken: string, episodeId: string): Promise<SubmissionStat[]> {
  const { adminClient } = await requireAdmin(accessToken);

  const { data: submissions, error: submissionsError } = await adminClient
    .from("submissions")
    .select("id,user_id,content_text")
    .eq("episode_id", episodeId);

  if (submissionsError) {
    throw new Error(submissionsError.message);
  }

  const rows = submissions ?? [];
  if (rows.length === 0) {
    return [];
  }

  const submissionIds = rows.map((s) => s.id);

  const { data: votes, error: votesError } = await adminClient
    .from("votes")
    .select("option_id")
    .in("option_id", submissionIds);

  if (votesError) {
    throw new Error(votesError.message);
  }

  const counts = new Map<string, number>();
  for (const v of votes ?? []) {
    counts.set(v.option_id, (counts.get(v.option_id) ?? 0) + 1);
  }

  const stats: SubmissionStat[] = rows.map((s) => ({
    submissionId: s.id,
    userId: s.user_id,
    contentText: s.content_text,
    voteCount: counts.get(s.id) ?? 0,
  }));

  stats.sort((a, b) => b.voteCount - a.voteCount);
  return stats;
}

export async function simulateSubmissions(accessToken: string, episodeId: string, count: number) {
  const { adminClient, userId } = await requireAdmin(accessToken);
  const capped = Math.max(1, Math.min(500, Math.floor(count)));

  const { data: episode, error: episodeError } = await adminClient
    .from("episodes")
    .select("title,narrative_text,season_num,episode_num")
    .eq("id", episodeId)
    .maybeSingle();

  if (episodeError) throw new Error(episodeError.message);

  const episodeHeader = episode
    ? `S${episode.season_num}E${episode.episode_num}: ${episode.title}`
    : `Episode: ${episodeId}`;
  const episodeText = (episode?.narrative_text ?? "").trim();
  const context = episodeText ? `${episodeHeader}\n\n${truncateForPrompt(episodeText, 1600)}` : `${episodeHeader}\n\n(no narrative context found)`;

  let inserted = 0;
  let remaining = capped;

  while (remaining > 0) {
    const batch = Math.min(20, remaining);
    const suggestions = await generateChaoticSuggestions({ context, count: batch });
    const cleaned = suggestions.map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) break;

    const { error: insertError } = await adminClient.from("submissions").insert(
      cleaned.map((s) => ({
        user_id: userId,
        episode_id: episodeId,
        content_text: s,
        is_synthetic: true,
      })),
    );

    if (insertError) throw new Error(insertError.message);

    inserted += cleaned.length;
    remaining -= batch;
  }

  return { ok: true as const, inserted };
}

export async function oraclePremises(
  accessToken: string,
  input: {
    title: string;
    genre: string;
    tone: string;
  },
): Promise<{ ok: true; premises: string[] } | { ok: false; error: string }> {
  try {
    await requireAdmin(accessToken);
    const premises = await generateOraclePremises({ title: input.title, genre: input.genre, tone: input.tone });
    return { ok: true as const, premises };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to generate premises." };
  }
}

export async function getActiveSeriesBible(accessToken: string): Promise<ActiveSeriesBible | null> {
  const { adminClient } = await requireAdmin(accessToken);

  let seriesBibleId: string | null = null;
  const stateAttempt = await adminClient
    .from("game_state")
    .select("current_series_bible_id")
    .eq("id", GAME_STATE_SINGLETON_ID)
    .maybeSingle();

  if (!stateAttempt.error) {
    seriesBibleId = (stateAttempt.data as { current_series_bible_id?: string | null } | null)?.current_series_bible_id ?? null;
  }

  if (seriesBibleId) {
    let { data, error } = await adminClient
      .from("series_bible")
      .select("id,title,genre,tone,premise,bible_json,intro_audio_url,created_at")
      .eq("id", seriesBibleId)
      .maybeSingle();

    if (error) {
      const msg = error.message.toLowerCase();
      const missingIntroColumn = msg.includes("intro_audio_url");
      if (missingIntroColumn) {
        const fallback = await adminClient
          .from("series_bible")
          .select("id,title,genre,tone,premise,bible_json,created_at")
          .eq("id", seriesBibleId)
          .maybeSingle();

        data = fallback.data
          ? ({ ...(fallback.data as unknown as ActiveSeriesBibleFallbackRow), intro_audio_url: null } as ActiveSeriesBible)
          : null;
        error = fallback.error;
      }
    }

    if (error) throw new Error(error.message);
    return (data as ActiveSeriesBible | null) ?? null;
  }

  let latest: ActiveSeriesBible[] | null = null;
  let latestError: { message: string } | null = null;

  {
    const attempt = await adminClient
      .from("series_bible")
      .select("id,title,genre,tone,premise,bible_json,intro_audio_url,created_at")
      .order("created_at", { ascending: false })
      .limit(1);
    latest = (attempt.data as ActiveSeriesBible[] | null) ?? null;
    latestError = attempt.error;
  }

  if (latestError) {
    const msg = latestError.message.toLowerCase();
    const missingIntroColumn = msg.includes("intro_audio_url");
    if (missingIntroColumn) {
      const fallback = await adminClient
        .from("series_bible")
        .select("id,title,genre,tone,premise,bible_json,created_at")
        .order("created_at", { ascending: false })
        .limit(1);

      latest =
        fallback.data && Array.isArray(fallback.data)
          ? (fallback.data as unknown as ActiveSeriesBibleFallbackRow[]).map((row) => ({ ...row, intro_audio_url: null } as ActiveSeriesBible))
          : null;
      latestError = fallback.error;
    }
  }

  if (latestError) throw new Error(latestError.message);
  return ((latest?.[0] as ActiveSeriesBible | undefined) ?? null);
}

export async function buildContinuityHeader(accessToken: string, input: BuildContinuityHeaderInput): Promise<string> {
  const { adminClient } = await requireAdmin(accessToken);

  const gsAttempt = await adminClient
    .from("game_state")
    .select("current_series_bible_id")
    .eq("id", GAME_STATE_SINGLETON_ID)
    .maybeSingle();

  const activeBibleId = (gsAttempt.data as { current_series_bible_id?: string | null } | null)?.current_series_bible_id ?? null;

  const bibleQuery = activeBibleId
    ? adminClient
        .from("series_bible")
        .select("id,title,genre,tone,premise,bible_json,created_at")
        .eq("id", activeBibleId)
        .maybeSingle()
    : adminClient
        .from("series_bible")
        .select("id,title,genre,tone,premise,bible_json,created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  const { data: bibleRow, error: bibleError } = await bibleQuery;
  if (bibleError) throw new Error(bibleError.message);

  const bible = (bibleRow as { bible_json?: DramaticaStructure } | null)?.bible_json ?? null;
  if (!bible) {
    throw new Error("No active story bible found. Ignite a campaign first.");
  }

  const { data: episode1Rows, error: episode1Error } = await adminClient
    .from("episodes")
    .select("id,title,narrative_text,season_num,episode_num")
    .eq("season_num", 1)
    .eq("episode_num", 1)
    .order("id", { ascending: true })
    .limit(1);

  if (episode1Error) throw new Error(episode1Error.message);

  const { data: recentEpisodes, error: recentError } = await adminClient
    .from("episodes")
    .select("id,title,narrative_text,season_num,episode_num")
    .order("season_num", { ascending: false })
    .order("episode_num", { ascending: false })
    .limit(4);

  if (recentError) throw new Error(recentError.message);

  const episode1 = (episode1Rows?.[0] as CanonEpisode | undefined) ?? null;
  const canonEpisodes = [episode1, ...(recentEpisodes ?? [])]
    .filter((e): e is CanonEpisode => !!e)
    .filter((e, idx, arr) => arr.findIndex((x) => x.id === e.id) === idx);

  const winningTitle = input.winningTitle.trim();
  const winningDescription = input.winningDescription.trim();

  const winnerBlock = `Winning option (ONLY allowed source of new canon this episode)
- Title: ${winningTitle}
- Description: ${winningDescription}`;

  let contributorBlock = "";
  if (input.winningOptionId) {
    const { data: optionRow, error: optionError } = await adminClient
      .from("path_options")
      .select("source_submission_ids")
      .eq("id", input.winningOptionId)
      .maybeSingle();

    if (optionError) {
      const msg = optionError.message.toLowerCase();
      if (!msg.includes("source_submission_ids")) {
        throw new Error(optionError.message);
      }
    }

    const sourceIds = ((optionRow as { source_submission_ids?: string[] | null } | null)?.source_submission_ids ?? []).filter(Boolean);

    if (sourceIds.length > 0) {
      const { data: submissions, error: subError } = await adminClient
        .from("submissions")
        .select("id,user_id")
        .in("id", sourceIds);
      if (subError) throw new Error(subError.message);

      const userIds = Array.from(new Set((submissions ?? []).map((s) => (s as { user_id: string }).user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles, error: profError } = await adminClient
          .from("profiles")
          .select("id,username")
          .in("id", userIds);
        if (profError) throw new Error(profError.message);

        const names = (profiles ?? [])
          .map((p) => {
            const row = p as { id: string; username: string | null };
            return (row.username ?? "").trim();
          })
          .filter(Boolean);

        if (names.length > 0) {
          contributorBlock = `CONTRIBUTOR CREDIT (DO NOT BREAK THE FOURTH WALL)
The plot points for this episode were suggested by the following architects: ${names.join(", ")}.
IF their names sound in-world or fantasy-appropriate, subtly weave a nod to them into the narration (e.g., "The strategy of the tactician [Name]...").
IF their names are obvious gamer-tags, DO NOT use the name directly, but honor the spirit of their contribution.`;
        }
      }
    }
  }

  const ruleBlock = `Canon rules (STRICT)
1) NO-NEW-CANON-EXCEPT-VOTE: You may ONLY introduce new named characters, factions, locations, items, or major facts if they are explicitly present in the winning option above.
2) Everything else must remain consistent with the Story Bible and prior episodes.
3) If the winning option implies a new element, integrate it in a way that fits the bible's domains/dynamics and does not contradict established facts.
4) Do not retcon. Do not "explain away" contradictions—avoid them entirely.`;

  const bibleBlock = formatBibleSummary(bible);

  const canonBlock = `Canon episodes (recent + Episode 1)
${formatCanonEpisodes(canonEpisodes)}`;

  return [bibleBlock, ruleBlock, winnerBlock, contributorBlock, canonBlock].filter(Boolean).join("\n\n====\n\n");
}

export async function resetCampaign(accessToken: string, input?: { deleteBible?: boolean }) {
  const { adminClient } = await requireAdmin(accessToken);
  const deleteBible = input?.deleteBible !== false;

  // Reset pointers first.
  await updateSingletonGameState(adminClient, {
    current_phase: "LISTEN",
    current_episode_id: null,
    current_series_bible_id: deleteBible ? null : undefined,
    phase_expiry: null,
  });

  const { error: votesError } = await adminClient.from("votes").delete().not("id", "is", null);
  if (votesError) throw new Error(votesError.message);

  const { error: optionsError } = await adminClient.from("path_options").delete().not("id", "is", null);
  if (optionsError) throw new Error(optionsError.message);

  const { error: submissionsError } = await adminClient.from("submissions").delete().not("id", "is", null);
  if (submissionsError) throw new Error(submissionsError.message);

  const { error: episodesError } = await adminClient.from("episodes").delete().not("id", "is", null);
  if (episodesError) throw new Error(episodesError.message);

  if (deleteBible) {
    await updateSingletonGameState(adminClient, {
      current_series_bible_id: null,
    });

    const { error: bibleError } = await adminClient.from("series_bible").delete().not("id", "is", null);
    if (bibleError) throw new Error(bibleError.message);
  }

  return { ok: true as const, deleteBible };
}

export async function igniteCampaign(input: {
  accessToken: string;
  title: string;
  genre: string;
  tone: string;
  premise: string;
}) {
  const { adminClient } = await requireAdmin(input.accessToken);

  const title = input.title.trim();
  const genre = input.genre.trim();
  const tone = input.tone.trim();
  const premise = input.premise.trim();

  if (!title || !genre || !tone || !premise) {
    throw new Error("Title, Genre, Tone, and Premise are required.");
  }

  const { bible, episode1 } = await generateDramaticaBible(genre, premise, tone);

  const { data: insertedBible, error: bibleError } = await adminClient
    .from("series_bible")
    .insert({
      title,
      genre,
      tone,
      premise,
      bible_json: bible,
    })
    .select("id")
    .single();

  if (bibleError) {
    throw new Error(bibleError.message);
  }

  const { data: insertedEpisode, error: episodeError } = await adminClient
    .from("episodes")
    .insert({
      title: `${title} — Episode 1`,
      narrative_text: episode1,
      audio_url: null,
      season_num: 1,
      episode_num: 1,
    })
    .select("id")
    .single();

  if (episodeError) {
    throw new Error(episodeError.message);
  }

  const episodeId = insertedEpisode.id;

  const { error: gameStateError } = await adminClient
    .from("game_state")
    .update({
      current_phase: "LISTEN",
      current_episode_id: episodeId,
      current_series_bible_id: insertedBible.id,
      phase_expiry: null,
    })
    .eq("id", GAME_STATE_SINGLETON_ID);

  if (gameStateError) {
    // Backward-compatible fallback if columns haven't been applied yet.
    const msg = gameStateError.message.toLowerCase();
    const missingBibleColumn = msg.includes("current_series_bible_id");
    const missingExpiryColumn = msg.includes("phase_expiry");
    if (!missingBibleColumn && !missingExpiryColumn) {
      throw new Error(gameStateError.message);
    }

    const fallbackUpdate: { current_phase: "LISTEN"; current_episode_id: string; current_series_bible_id?: string; phase_expiry?: null } = {
      current_phase: "LISTEN",
      current_episode_id: episodeId,
      current_series_bible_id: insertedBible.id,
      phase_expiry: null,
    };
    if (missingBibleColumn) delete fallbackUpdate.current_series_bible_id;
    if (missingExpiryColumn) delete fallbackUpdate.phase_expiry;

    const { error: fallbackError } = await adminClient
      .from("game_state")
      .update(fallbackUpdate)
      .eq("id", GAME_STATE_SINGLETON_ID);

    if (fallbackError) {
      throw new Error(fallbackError.message);
    }
  }

  return { ok: true as const, bibleId: insertedBible.id, episodeId };
}

export async function synthesizeOptions(accessToken: string, episodeId: string): Promise<PathOptionDraft[]> {
  await requireAdmin(accessToken);
  return synthesizeOptionsInternal(episodeId);
}

export async function openVoting(input: {
  accessToken: string;
  episodeId: string;
  options: PathOptionDraft[];
  durationMinutes?: number;
}) {
  const { adminClient } = await requireAdmin(input.accessToken);

  const durationMinutes = Number.isFinite(input.durationMinutes as number) ? Math.max(1, Math.floor(input.durationMinutes as number)) : 15;
  const expiry = new Date(Date.now() + durationMinutes * 60_000).toISOString();

  if (input.options.length !== 3) {
    throw new Error("Must provide exactly 3 options.");
  }

  const cleaned = input.options.map((o) => ({
    title: o.title.trim(),
    description: o.description.trim(),
    source_submission_ids: Array.isArray(o.source_submission_ids) ? o.source_submission_ids : null,
  }));

  if (cleaned.some((o) => !o.title || !o.description)) {
    throw new Error("Each option must have a title and description.");
  }

  const { error: deleteError } = await adminClient.from("path_options").delete().eq("episode_id", input.episodeId);
  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const insertAttempt = await adminClient.from("path_options").insert(
    cleaned.map((o) => ({
      episode_id: input.episodeId,
      title: o.title,
      description: o.description,
      source_submission_ids: o.source_submission_ids,
    })),
  );

  if (insertAttempt.error) {
    const msg = insertAttempt.error.message.toLowerCase();
    const missingAttributionColumn = msg.includes("source_submission_ids");
    if (!missingAttributionColumn) {
      throw new Error(insertAttempt.error.message);
    }

    const fallbackAttempt = await adminClient.from("path_options").insert(
      cleaned.map((o) => ({
        episode_id: input.episodeId,
        title: o.title,
        description: o.description,
      })),
    );

    if (fallbackAttempt.error) {
      throw new Error(fallbackAttempt.error.message);
    }
  }

  const { error: phaseError } = await adminClient
    .from("game_state")
    .update({ current_phase: "VOTE", current_episode_id: input.episodeId, phase_expiry: expiry })
    .eq("id", GAME_STATE_SINGLETON_ID);

  if (phaseError) {
    const msg = phaseError.message.toLowerCase();
    const missingExpiryColumn = msg.includes("phase_expiry");
    if (!missingExpiryColumn) {
      throw new Error(phaseError.message);
    }

    const { error: fallbackError } = await adminClient
      .from("game_state")
      .update({ current_phase: "VOTE", current_episode_id: input.episodeId })
      .eq("id", GAME_STATE_SINGLETON_ID);

    if (fallbackError) {
      throw new Error(fallbackError.message);
    }
  }

  return { ok: true as const };
}

export async function getPathOptionStats(accessToken: string, episodeId: string): Promise<PathOptionStat[]> {
  const { adminClient } = await requireAdmin(accessToken);

  const { data: options, error: optionsError } = await adminClient
    .from("path_options")
    .select("id,title,description")
    .eq("episode_id", episodeId);

  if (optionsError) {
    throw new Error(optionsError.message);
  }

  const rows = options ?? [];
  if (rows.length === 0) return [];

  const optionIds = rows.map((o) => o.id);

  const { data: votes, error: votesError } = await adminClient.from("votes").select("option_id").in("option_id", optionIds);
  if (votesError) {
    throw new Error(votesError.message);
  }

  const counts = new Map<string, number>();
  for (const v of votes ?? []) {
    counts.set(v.option_id, (counts.get(v.option_id) ?? 0) + 1);
  }

  const stats: PathOptionStat[] = rows.map((o) => ({
    optionId: o.id,
    title: o.title,
    description: o.description,
    voteCount: counts.get(o.id) ?? 0,
  }));

  stats.sort((a, b) => b.voteCount - a.voteCount);
  return stats;
}

export async function publishNextEpisode(input: {
  accessToken: string;
  winningOptionId?: string | null;
  title: string;
  narrativeText: string;
  seasonNum: number;
  episodeNum: number;
  audioUrl?: string | null;
}) {
  const { adminClient } = await requireAdmin(input.accessToken);

  let creditedAuthors: { name: string; id: string }[] = [];
  if (input.winningOptionId) {
    const { data: optionRow, error: optionError } = await adminClient
      .from("path_options")
      .select("source_submission_ids")
      .eq("id", input.winningOptionId)
      .maybeSingle();

    if (optionError) {
      const msg = optionError.message.toLowerCase();
      if (!msg.includes("source_submission_ids")) {
        throw new Error(optionError.message);
      }
    }

    const sourceIds = ((optionRow as { source_submission_ids?: string[] | null } | null)?.source_submission_ids ?? []).filter(Boolean);

    if (sourceIds.length > 0) {
      const { data: submissions, error: subError } = await adminClient
        .from("submissions")
        .select("id,user_id")
        .in("id", sourceIds);
      if (subError) throw new Error(subError.message);

      const userIds = Array.from(new Set((submissions ?? []).map((s) => (s as { user_id: string }).user_id).filter(Boolean)));
      if (userIds.length > 0) {
        const { data: profiles, error: profError } = await adminClient
          .from("profiles")
          .select("id,username")
          .in("id", userIds);
        if (profError) throw new Error(profError.message);

        creditedAuthors = (profiles ?? []).map((p) => {
          const row = p as { id: string; username: string | null };
          return { id: row.id, name: row.username ?? row.id.slice(0, 8) };
        });
      }
    }
  }

  const rpcAttempt = await adminClient.rpc("publish_next_episode", {
    p_title: input.title,
    p_narrative_text: input.narrativeText,
    p_audio_url: input.audioUrl ?? null,
    p_season_num: input.seasonNum,
    p_episode_num: input.episodeNum,
  });

  if (!rpcAttempt.error) {
    const newEpisodeId = rpcAttempt.data as string;
    const { error: creditError } = await adminClient
      .from("episodes")
      .update({ credited_authors: creditedAuthors })
      .eq("id", newEpisodeId);
    if (creditError) {
      const msg = creditError.message.toLowerCase();
      if (!msg.includes("credited_authors")) {
        throw new Error(creditError.message);
      }
    }
    return { ok: true as const, episodeId: newEpisodeId };
  }

  const rpcErrorMessage = rpcAttempt.error.message;
  const isMissingRpc =
    rpcErrorMessage.toLowerCase().includes("could not find the function") ||
    rpcErrorMessage.toLowerCase().includes("publish_next_episode") ||
    rpcErrorMessage.toLowerCase().includes("function public.publish_next_episode");

  if (!isMissingRpc) {
    throw new Error(rpcErrorMessage);
  }

  // Fallback for environments where the SQL function hasn't been applied yet.
  // We do a best-effort rollback if updating game_state fails.

  const { data: inserted, error: insertError } = await adminClient
    .from("episodes")
    .insert({
      title: input.title,
      narrative_text: input.narrativeText,
      audio_url: input.audioUrl ?? null,
      season_num: input.seasonNum,
      episode_num: input.episodeNum,
      credited_authors: creditedAuthors,
    })
    .select("id")
    .single();

  if (insertError) {
    const msg = insertError.message.toLowerCase();
    const missingCreditColumn = msg.includes("credited_authors");
    if (!missingCreditColumn) {
      throw new Error(insertError.message);
    }

    const fallbackInsert = await adminClient
      .from("episodes")
      .insert({
        title: input.title,
        narrative_text: input.narrativeText,
        audio_url: input.audioUrl ?? null,
        season_num: input.seasonNum,
        episode_num: input.episodeNum,
      })
      .select("id")
      .single();

    if (fallbackInsert.error) {
      throw new Error(fallbackInsert.error.message);
    }

    return { ok: true as const, episodeId: fallbackInsert.data.id };
  }

  const newEpisodeId = inserted.id;

  const { error: gameStateError } = await adminClient
    .from("game_state")
    .update({
      current_phase: "LISTEN",
      current_episode_id: newEpisodeId,
      phase_expiry: null,
    })
    .eq("id", GAME_STATE_SINGLETON_ID);

  if (gameStateError) {
    await adminClient.from("episodes").delete().eq("id", newEpisodeId);
    throw new Error(gameStateError.message);
  }

  return { ok: true as const, episodeId: newEpisodeId };
}
