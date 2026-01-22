"use server";

import { getGemini } from "@/lib/ai/gemini";
import { createServerSupabaseClient } from "@/lib/supabase/server";

async function generateText(model: string, prompt: string) {
  const m = getGemini().getGenerativeModel({ model });
  const result = await m.generateContent(prompt);
  return result.response.text();
}

const MOMENTUM_REQUIREMENTS = `Forward momentum requirements (STRICT)
- Advance the story, don't stall: make at least one irreversible change in the situation.
- OS progress: show a concrete step toward the Objective Story goal OR a measurable slide toward the Consequence.
- Driver/Limit: make the next beat feel like another turn of the Driver, increasing pressure toward the Limit.
- MC/IC pressure: include at least one moment where the Main Character is pushed by the Influence Character's impact.
- RS drift: adjust Relationship Story trust slightly (+1 or -1) via a specific interaction; reflect it in subtext.`;

const BEAT_SHEET_PROMPT = (input: { context: string; winningText: string; contributors: string[] }) => `You are a Showrunner acting as the "Architect".

Canon Packet (NCP + continuity): ${input.context}
Winning Submission: ${input.winningText}
Contributors: ${input.contributors.join(", ")}

**THEORY MODEL: VALUE TURNS**
Every scene must be an "Event" that causes a meaningful change in the life of a character.
Do not write "filler" scenes. If the value charge does not change, the scene is cut.

**Format Requirements (STRICT):**
You MUST use strictly formatted Markdown headers exactly like this, repeated for 5 scenes:

## SCENE 1: [Title]
**Characters:** [List]
**Scene Goal:** [What does the protagonist of this scene WANT?]
**The Conflict:** [What stands in their way?]
**The Turn:** [Start Value (e.g. "Safe")] -> [End Value (e.g. "In Danger")]
**Attribution:** [Name of a Contributing Architect to credit, or "None"]
**Action:** [Bullet points of the plot beats. Focus on CAUSE and EFFECT.]

## SCENE 2: [Title]
... (repeat for 5 scenes)

**Content Rules:**
1. Scene 1 (Teaser): Must turn from Normalcy -> Inciting Incident.
2. Scene 5 (Cliffhanger): Must turn from Resolution -> New Dilemma.
3. **Pacing:** Prioritize EVENT DENSITY. Things must happen. Avoid "traveling" or "waiting" beats.
4. **Attribution:** If the winning submission suggested a specific beat, include it.

Output ONLY the 5-scene Markdown blueprint. No extra commentary.
`;

const SCENE_DRAFT_PROMPT = (input: {
  index: number;
  sceneInstruction: string;
  previousSceneTail: string;
  context?: string;
  trustScore: string;
  timelock: string;
  voiceContext: string;
}) => `You are writing SCENE ${input.index + 1} of 5.

BLUEPRINT (The Turn):
${input.sceneInstruction}

STORY SO FAR: ${input.previousSceneTail ? "..." + input.previousSceneTail : "(start of episode)"}
CONTEXT: ${input.context ?? "None"}
CANON LAWS: Trust Score: ${input.trustScore}, Timelock: ${input.timelock}
VOICE: ${input.voiceContext ? input.voiceContext : ""}

**NARRATIVE VELOCITY INSTRUCTIONS:**
1. **NO PURPLE PROSE:** Do not describe "the quality of the silence" or "the way the light hit the dust." We do not care about the atmosphere unless it is dangerous.
2. **VERBS OVER ADJECTIVES:** Use active, high-impact verbs. (Bad: "He was angry." Good: "He kicked the table.")
3. **MOMENTUM:** The scene MUST pivot on "The Turn" defined in the Blueprint. If the character ends the scene in the same emotional state they started, you have failed.
4. **DIALOGUE AS ACTION:** Dialogue should be used to deceive, attack, seduce, or investigate. No "small talk."
5. **AUDIO-FIRST (ACTION):** Describe *sounds of movement* and *impacts* (crunch, snap, thud), not just ambient noise.

**Task:**
Write the full scene (~400 words).
Focus on the IMMEDIATE physical reality and the conflict.
End with a strong hook into the next scene.

Output ONLY the scene text.
`;

function splitSceneBlueprint(beatSheet: string): string[] | null {
  const input = beatSheet.trim();
  if (!input) return null;

  const headerRegex = /^##\s*SCENE\s+(\d+)\s*:\s*/gim;
  const matches = Array.from(input.matchAll(headerRegex));
  if (matches.length < 2) return null;

  const scenes: string[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? input.length) : input.length;
    const chunk = input.slice(start, end).trim();
    if (chunk) scenes.push(chunk);
  }

  if (scenes.length < 5) return null;
  return scenes.slice(0, 5);
}

function getLastNWords(text: string, wordCount: number) {
  const words = text
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length <= wordCount) return words.join(" ");
  return words.slice(-wordCount).join(" ");
}

function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function extractCanonField(context: string | undefined, re: RegExp) {
  if (!context) return null;
  const m = context.match(re);
  return (m?.[1] ?? null)?.trim() || null;
}

function parseCastVoiceDnaFromContext(context: string | undefined) {
  const out = new Map<string, { voiceDna: string; keyPhrases: string[]; role: string }>();
  if (!context) return out;

  const start = context.indexOf("Cast / Voice DNA");
  if (start < 0) return out;
  const slice = context.slice(start);
  const lines = slice.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) continue;

    // Example line:
    // - Zora (Protagonist): Gruff... Key phrases: Copy that | Eyes up
    const m = trimmed.match(/^-\s*([^\(]+)\(([^\)]*)\):\s*(.*?)\s*Key phrases:\s*(.*)$/i);
    if (!m) continue;

    const name = (m[1] ?? "").trim();
    const role = (m[2] ?? "").trim();
    const voiceDna = (m[3] ?? "").trim();
    const keyPhrasesRaw = (m[4] ?? "").trim();
    if (!name) continue;
    out.set(name.toLowerCase(), {
      role,
      voiceDna,
      keyPhrases: keyPhrasesRaw
        .split("|")
        .map((p) => p.trim())
        .filter(Boolean),
    });
  }

  return out;
}

function parseSceneCharacters(sceneBlueprint: string) {
  const line = sceneBlueprint.match(/^\*\*Characters:\*\*\s*(.+)$/im)?.[1] ?? "";
  if (!line.trim()) return [];
  return line
    .split(/,|\||\//)
    .map((c) => c.trim())
    .filter(Boolean);
}

function buildVoiceContext(input: { characters: string[]; context?: string }) {
  const cast = parseCastVoiceDnaFromContext(input.context);
  const unique = Array.from(new Set(input.characters.map((c) => c.trim()).filter(Boolean)));
  if (unique.length === 0) return "";

  const lines = unique.map((name) => {
    const profile = cast.get(name.toLowerCase());
    if (!profile || (!profile.voiceDna && profile.keyPhrases.length === 0)) {
      return `${name}: (No voice DNA provided. Default to a clear, neutral, consistent voice; do not invent catchphrases.)`;
    }
    const dna = profile.voiceDna || "(voice DNA unspecified)";
    const phrases = profile.keyPhrases.length ? ` Key phrases: ${profile.keyPhrases.join(" | ")}` : "";
    return `${name}: ${dna}${phrases}`;
  });

  return `CHARACTER VOICES (STRICT):\n${lines.join("\n")}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientNetworkError(e: unknown) {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  const anyErr = e as unknown as { cause?: unknown };
  const causeMsg =
    anyErr.cause instanceof Error ? anyErr.cause.message.toLowerCase() : typeof anyErr.cause === "string" ? anyErr.cause.toLowerCase() : "";

  return (
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again") ||
    causeMsg.includes("fetch failed") ||
    causeMsg.includes("econnreset") ||
    causeMsg.includes("timeout") ||
    causeMsg.includes("enotfound") ||
    causeMsg.includes("eai_again")
  );
}

async function generateTextWithFallback(input: { models: string[]; prompt: string; label: string }) {
  const errors: string[] = [];
  for (const model of input.models) {
    try {
      return await generateText(model, input.prompt);
    } catch (e) {
      const details = e instanceof Error ? e.message : "Unknown error.";
      errors.push(`${model}: ${details}`);
      if (isTransientNetworkError(e)) {
        // One small backoff per model to smooth over flaky network conditions.
        await sleep(800);
        try {
          return await generateText(model, input.prompt);
        } catch (e2) {
          errors.push(`${model} (retry): ${e2 instanceof Error ? e2.message : "Unknown error."}`);
        }
      }
      // Move on to next model.
      continue;
    }
  }

  throw new Error(`Gemini ${input.label} failed across models. ${errors.join(" | ")}`);
}

export type PathOptionDraft = {
  title: string;
  description: string;
  source_submission_ids?: string[] | null;
};

type GeminiOptionDraft = {
  title: string;
  description: string;
  source_indices?: number[];
};

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseOptionsJson(raw: string): GeminiOptionDraft[] {
  const cleaned = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("[");
    const last = cleaned.lastIndexOf("]");
    if (first >= 0 && last > first) {
      parsed = JSON.parse(cleaned.slice(first, last + 1));
    } else {
      throw new Error("AI did not return valid JSON.");
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI output JSON must be an array.");
  }

  const out: GeminiOptionDraft[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const anyItem = item as {
      Title?: unknown;
      Description?: unknown;
      title?: unknown;
      description?: unknown;
      source_indices?: unknown;
      sourceIndices?: unknown;
      SourceIndices?: unknown;
    };
    const title = (anyItem.title ?? anyItem.Title);
    const description = (anyItem.description ?? anyItem.Description);
    if (typeof title !== "string" || typeof description !== "string") continue;

    const rawIndices = anyItem.source_indices ?? anyItem.sourceIndices ?? anyItem.SourceIndices;
    const indices = Array.isArray(rawIndices)
      ? rawIndices
          .map((v) => (typeof v === "number" ? v : Number(v)))
          .filter((n) => Number.isFinite(n))
          .map((n) => Math.floor(n))
          .filter((n) => n >= 1)
      : undefined;

    out.push({ title: title.trim(), description: description.trim(), source_indices: indices });
  }

  if (out.length !== 3) {
    throw new Error("AI must return exactly 3 options.");
  }

  return out;
}

async function generateOptionsFromGemini(submissions: { id: string; content_text: string; is_synthetic: boolean }[]) {
  const prompt = `Analyze these user suggestions for the next story beat. Group them into 3 distinct, high-conflict narrative paths.

For each path, provide a short "Title" (e.g., "Attack the Guard") and a "Description" (e.g., "Overpower him before he sounds the alarm").

CRITICAL:
- You MUST include a key "source_indices" for each option.
- "source_indices" must be an array of integers referencing the numbered user suggestions that inspired the option.
- Only use numbers from 1 to ${submissions.length}.

Output JSON as an array of exactly 3 objects, each with keys: title, description, source_indices.

User suggestions:
${submissions.map((s, i) => `${i + 1}. ${s.content_text}`).join("\n")}`;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const text = await generateTextWithFallback({
        models: ["gemini-2.5-flash", "gemini-2.5-pro"],
        prompt,
        label: "option synthesis",
      });
      return parseOptionsJson(text);
    } catch (e) {
      const anyErr = e as unknown as { status?: number; cause?: unknown };
      const status = typeof anyErr.status === "number" ? anyErr.status : null;
      const cause = anyErr.cause instanceof Error ? anyErr.cause.message : typeof anyErr.cause === "string" ? anyErr.cause : null;
      const details = [status ? `status=${status}` : null, cause ? `cause=${cause}` : null].filter(Boolean).join(" ");

      if (attempt < 2 && isTransientNetworkError(e)) {
        await sleep(1000 * attempt);
        continue;
      }

      throw new Error(`Gemini option synthesis failed${details ? ` (${details})` : ""}: ${e instanceof Error ? e.message : "Unknown error."}`);
    }
  }

  throw new Error("Gemini option synthesis failed.");
}

export async function synthesizeOptions(episodeId: string): Promise<PathOptionDraft[]> {
  const adminClient = createServerSupabaseClient({ admin: true });

  const { data: submissions, error } = await adminClient
    .from("submissions")
    .select("id,content_text,is_synthetic")
    .eq("episode_id", episodeId)
    .order("id", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (submissions ?? []) as { id: string; content_text: string; is_synthetic: boolean }[];
  const cleaned = rows
    .map((s) => ({ ...s, content_text: (s.content_text ?? "").trim() }))
    .filter((s) => s.content_text);

  if (cleaned.length < 3) {
    throw new Error("Not enough data");
  }

  const isAllSynthetic = cleaned.every((s) => s.is_synthetic);

  const drafts = await generateOptionsFromGemini(cleaned);

  return drafts.map((d) => {
    if (isAllSynthetic) {
      return { title: d.title, description: d.description, source_submission_ids: [] };
    }

    const indices = Array.isArray(d.source_indices) ? d.source_indices : [];
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const idx of indices) {
      if (!Number.isFinite(idx)) continue;
      const i = Math.floor(idx);
      if (i < 1 || i > cleaned.length) continue;
      const id = cleaned[i - 1]?.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }

    return { title: d.title, description: d.description, source_submission_ids: ids.length ? ids : null };
  });
}

export async function generateBeatSheet(winningText: string, context: string, contributors: string[] = []) {
  const prompt = BEAT_SHEET_PROMPT({ context, winningText, contributors });

  return generateTextWithFallback({
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    prompt,
    label: "beat sheet",
  });
}

export async function generateScript(beatSheet: string, context?: string) {
  const scenes = splitSceneBlueprint(beatSheet);

  if (!scenes) {
    console.log("Scene blueprint parse failed; using single-pass fallback generation.");
    const prompt = `You are writing the next episode narration for an interactive story game.

Context:
${context ?? "(none)"}

${MOMENTUM_REQUIREMENTS}

Beat sheet:
${beatSheet}

Task:
Write ~2,000 words of vivid prose narration that follows the beat sheet (MINIMUM 1,800 words).
- Write dialogue, action, and sensory details. Do NOT summarize.
- Present tense preferred.
- No bullet points.
- No headings.
- Output ONLY the prose.`;

    const draft = await generateTextWithFallback({
      models: ["gemini-2.5-pro", "gemini-2.5-flash"],
      prompt,
      label: "draft (single-pass)",
    });

    const MIN_TOTAL_WORDS = 1800;
    const MAX_FALLBACK_CONTINUATIONS = 4;
    let cleaned = draft.trim();
    console.log(`Single-pass draft length: ${countWords(cleaned)} words.`);

    for (let attempt = 0; attempt < MAX_FALLBACK_CONTINUATIONS && countWords(cleaned) < MIN_TOTAL_WORDS; attempt += 1) {
      console.log(`Fallback draft too short (${countWords(cleaned)} words). Continuing...`);
      const tail = getLastNWords(cleaned, 180);
      const continuationPrompt = `Continue writing the episode.

STORY SO FAR (continue immediately from here):
...${tail}

Context:
${context ?? "(none)"}

Beat sheet:
${beatSheet}

TASK:
Continue the episode with at least 350 more words.
- Write dialogue, action, and sensory details. Do NOT summarize.
- Do NOT restart. Do NOT recap.
Output ONLY the continuation prose.`;

      const extra = await generateTextWithFallback({
        models: ["gemini-2.5-pro", "gemini-2.5-flash"],
        prompt: continuationPrompt,
        label: "draft continuation (single-pass)",
      });
      cleaned = `${cleaned}\n\n${extra.trim()}`.trim();
      console.log(`Fallback draft length now: ${countWords(cleaned)} words.`);
    }

    return cleaned;
  }

  console.log(`Scene blueprint parsed successfully (${scenes.length} scenes).`);

  const trustScore = extractCanonField(context, /Trust score:\s*([^\n]+)/i) ?? "(unknown)";
  const timelock = extractCanonField(context, /Limit:\s*([^\n]+)/i) ?? "(unknown)";

  const MIN_SCENE_WORDS = 380;
  const MAX_CONTINUATIONS = 4;

  let previousSceneTail = "";
  let fullDraft = "";

  for (let index = 0; index < scenes.length; index += 1) {
    console.log(`Generating Scene ${index + 1}/5...`);
    const sceneInstruction = scenes[index];
    const characters = parseSceneCharacters(sceneInstruction);
    const voiceContext = buildVoiceContext({ characters, context });
    const prompt = SCENE_DRAFT_PROMPT({
      index,
      sceneInstruction,
      previousSceneTail,
      context,
      trustScore,
      timelock,
      voiceContext,
    });

    const sceneText = await generateTextWithFallback({
      models: ["gemini-2.5-pro", "gemini-2.5-flash"],
      prompt,
      label: `scene ${index + 1}`,
    });

    let cleaned = sceneText.trim();
    console.log(`Scene ${index + 1} initial length: ${countWords(cleaned)} words.`);

    for (let attempt = 0; attempt < MAX_CONTINUATIONS && countWords(cleaned) < MIN_SCENE_WORDS; attempt += 1) {
      console.log(`Scene ${index + 1} too short (${countWords(cleaned)} words). Continuing...`);
      const tail = getLastNWords(cleaned, 150);
      const continuationPrompt = `Continue writing SCENE ${index + 1} of 5.

STORY SO FAR (continue immediately from here):
...${tail}

BLUEPRINT (must still satisfy):
${sceneInstruction}

CANON PACKET (NCP + continuity; do not contradict):
${context ?? "(none)"}

${voiceContext ? `${voiceContext}\n` : ""}

TASK:
Add at least 200 more words continuing the same scene (do not restart, do not recap).
- Do NOT summarize.
- Do NOT output meta annotations.
Output ONLY the continuation text.`;

      const extra = await generateTextWithFallback({
        models: ["gemini-2.5-pro", "gemini-2.5-flash"],
        prompt: continuationPrompt,
        label: `scene ${index + 1} continuation`,
      });

      cleaned = `${cleaned}\n\n${extra.trim()}`.trim();
    }

    console.log(`Scene ${index + 1} final length: ${countWords(cleaned)} words.`);

    fullDraft = fullDraft ? `${fullDraft}\n\n${cleaned}` : cleaned;
    previousSceneTail = getLastNWords(cleaned, 200);
  }

  console.log(`Full draft length: ${countWords(fullDraft)} words.`);

  return fullDraft;
}

export async function optimizeForAudio(prose: string, context?: string) {
  const prompt = `You are a Voice Director for a cinematic audio drama.

Context (do not change names/facts implied by this):
${context ?? "(none)"}

Rewrite the input text to optimize it for Text-to-Speech (ElevenLabs) performance.

CRITICAL FORMATTING RULES:
1. **NO XML TAGS:** Do not use <break>, <pause>, or any other code.
2. **Pacing Control:**
   - Use ellipses (...) for suspenseful pauses (approx 0.5s).
   - Use double line breaks for long dramatic pauses (approx 1.0s).
   - Use em-dashes (—) for sharp interruptions or sudden shifts.
   - Use commas frequently to force natural breathing room in long sentences.
3. **Emphasis:**
   - **Do NOT use ALL CAPS** (it causes spelling errors and robotic shouting).
   - Use exclamation marks (!) for intensity, but use them sparingly.
4. **Vibe Match:**
   - If the scene is ACTION: Use short, clipped sentences. Fast tempo.
   - If the scene is LORE/MYSTERY: Use flowing, rhythmic sentences. Slower tempo.
5. **Audio Translation:** Convert purely visual descriptions into auditory ones (e.g., change "The light faded" to "The hum of the light died down to a silence").

Input Text:
${prose}

Output ONLY the rewritten text. Do not use Markdown. Do not add headings.`;

  return generateTextWithFallback({
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    prompt,
    label: "audio polish",
  });
}
