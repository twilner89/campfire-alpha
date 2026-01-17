"use server";

import { createServerSupabaseClient } from "@/lib/supabase/server";

function cleanForNarration(input: string) {
  const lines = input
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const cleaned: string[] = [];

  for (let line of lines) {
    if (/^#{1,6}\s+/.test(line)) continue;

    line = line.replace(/\*\*/g, "");

    if (/^scene\b/i.test(line)) continue;
    if (/^##\s*scene\b/i.test(line)) continue;

    line = line.replace(/^[A-Z0-9_]{2,20}:\s+/, "");

    if (!line) continue;
    cleaned.push(line);
  }

  return cleaned.join("\n");
}

function buildBibleIntroText(row: {
  title?: string | null;
  genre?: string | null;
  tone?: string | null;
  premise?: string | null;
  bible_json?: unknown;
  exposition?: string | null;
  narrative_intro?: string | null;
}) {
  const exposition = (row.exposition ?? "").trim();
  if (exposition) return exposition;
  const narrativeIntro = (row.narrative_intro ?? "").trim();
  if (narrativeIntro) return narrativeIntro;

  const title = (row.title ?? "").trim();
  const genre = (row.genre ?? "").trim();
  const tone = (row.tone ?? "").trim();
  const premise = (row.premise ?? "").trim();

  const bible = row.bible_json as
    | {
        objective_story?: { goal?: string; consequence?: string };
        main_character?: { name?: string };
        influence_character?: { name?: string };
        relationship_story?: { dynamic?: string };
      }
    | null
    | undefined;

  const goal = (bible?.objective_story?.goal ?? "").trim();
  const consequence = (bible?.objective_story?.consequence ?? "").trim();
  const mc = (bible?.main_character?.name ?? "").trim();
  const ic = (bible?.influence_character?.name ?? "").trim();
  const rs = (bible?.relationship_story?.dynamic ?? "").trim();

  const lines: string[] = [];
  if (title) lines.push(title);
  if (premise) lines.push(premise);
  if (mc || ic) lines.push(`Tonight, ${mc || "the protagonist"} is forced into the orbit of ${ic || "a dangerous influence"}.`);
  if (rs) lines.push(`Between them, the relationship is ${rs}.`);
  if (goal) lines.push(`The objective is clear: ${goal}.`);
  if (consequence) lines.push(`If they fail, ${consequence}.`);
  if (genre || tone) lines.push(`The genre is ${genre || "unknown"}. The tone is ${tone || "unknown"}.`);
  lines.push("The fire is lit.");

  return lines.join("\n\n").trim();
}

export async function generateEpisodeAudio(input: { episodeId: string; text: string }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }
  if (!voiceId) {
    throw new Error("Missing ELEVENLABS_VOICE_ID");
  }

  const adminClient = createServerSupabaseClient({ admin: true });

  const script = (input.text ?? "").trim();
  if (!script) {
    throw new Error("Audio script is empty. Run Audio Polish first.");
  }

  const narrationText = cleanForNarration(script);
  if (!narrationText.trim()) {
    throw new Error("Script cleaning removed all content; nothing left to narrate.");
  }

  const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

  const elevenRes = await fetch(elevenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: narrationText,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!elevenRes.ok) {
    const text = await elevenRes.text();
    throw new Error(`ElevenLabs TTS failed (${elevenRes.status}): ${text.slice(0, 500)}`);
  }

  const audioArrayBuffer = await elevenRes.arrayBuffer();
  const audioBytes = new Uint8Array(audioArrayBuffer);

  const timestamp = Date.now();
  const filePath = `episode_${input.episodeId}_${timestamp}.mp3`;

  const { error: uploadError } = await adminClient.storage
    .from("audio")
    .upload(filePath, audioBytes, { contentType: "audio/mpeg", upsert: false });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: publicData } = adminClient.storage.from("audio").getPublicUrl(filePath);
  const publicUrl = publicData.publicUrl;

  return { ok: true as const, audioUrl: publicUrl, path: filePath };
}

export async function generateBibleAudio(bibleId: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;

  if (!apiKey) {
    throw new Error("Missing ELEVENLABS_API_KEY");
  }
  if (!voiceId) {
    throw new Error("Missing ELEVENLABS_VOICE_ID");
  }

  const adminClient = createServerSupabaseClient({ admin: true });

  let introText = "";

  const episode1Attempt = await adminClient
    .from("episodes")
    .select("narrative_text")
    .eq("season_num", 1)
    .eq("episode_num", 1)
    .limit(1);

  if (!episode1Attempt.error) {
    const ep1Text = ((episode1Attempt.data?.[0] as { narrative_text?: string | null } | undefined)?.narrative_text ?? "").trim();
    if (ep1Text) {
      introText = ep1Text;
    }
  }

  // Try to fetch exposition/narrative_intro if they exist; fall back to known columns.
  let row: unknown = null;
  {
    let { data, error } = await adminClient
      .from("series_bible")
      .select("id,title,genre,tone,premise,bible_json,exposition,narrative_intro")
      .eq("id", bibleId)
      .maybeSingle();

    if (error) {
      ({ data, error } = await adminClient
        .from("series_bible")
        .select("id,title,genre,tone,premise,bible_json")
        .eq("id", bibleId)
        .maybeSingle());
    }

    if (error) throw new Error(error.message);
    row = data;
  }

  if (!row) {
    throw new Error("Series bible not found.");
  }

  if (!introText.trim()) {
    introText = buildBibleIntroText(row as {
      title?: string | null;
      genre?: string | null;
      tone?: string | null;
      premise?: string | null;
      bible_json?: unknown;
      exposition?: string | null;
      narrative_intro?: string | null;
    });
  }

  if (!introText.trim()) {
    throw new Error("Intro text is empty.");
  }

  const narrationText = cleanForNarration(introText);
  if (!narrationText.trim()) {
    throw new Error("Intro cleaning removed all content; nothing left to narrate.");
  }

  const elevenUrl = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  const elevenRes = await fetch(elevenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: narrationText,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!elevenRes.ok) {
    const text = await elevenRes.text();
    throw new Error(`ElevenLabs TTS failed (${elevenRes.status}): ${text.slice(0, 500)}`);
  }

  const audioArrayBuffer = await elevenRes.arrayBuffer();
  const audioBytes = new Uint8Array(audioArrayBuffer);

  const timestamp = Date.now();
  const filePath = `bible_intro_${bibleId}_${timestamp}.mp3`;

  const { error: uploadError } = await adminClient.storage
    .from("audio")
    .upload(filePath, audioBytes, { contentType: "audio/mpeg", upsert: false });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data: publicData } = adminClient.storage.from("audio").getPublicUrl(filePath);
  const publicUrl = publicData.publicUrl;

  const updateAttempt = await adminClient.from("series_bible").update({ intro_audio_url: publicUrl }).eq("id", bibleId);
  if (updateAttempt.error) {
    const msg = updateAttempt.error.message.toLowerCase();
    if (!msg.includes("intro_audio_url")) {
      throw new Error(updateAttempt.error.message);
    }
  }

  return { ok: true as const, audioUrl: publicUrl, path: filePath };
}
