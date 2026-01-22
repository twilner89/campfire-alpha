"use server";

import { getGemini } from "@/lib/ai/gemini";
import type { DramaticaStructure } from "@/types/ncp";

type AnyRecord = Record<string, unknown>;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isQuotaError(e: unknown) {
  if (!(e instanceof Error)) return false;
  const anyErr = e as unknown as { status?: number };
  if (anyErr.status === 429) return true;
  return /too many requests|quota exceeded|retry in\s+\d/i.test(e.message);
}

function getRetryDelayMs(e: unknown) {
  if (!(e instanceof Error)) return 10_000;
  const msg = e.message;

  const retryIn = msg.match(/retry in\s+([0-9.]+)s/i);
  if (retryIn?.[1]) {
    const seconds = Number(retryIn[1]);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds * 1000);
  }

  const retryDelay = msg.match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (retryDelay?.[1]) {
    const seconds = Number(retryDelay[1]);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
  }

  return 10_000;
}

function isTransientNetworkError(e: unknown) {
  if (!(e instanceof Error)) return false;
  const msg = e.message.toLowerCase();
  const anyErr = e as unknown as { cause?: unknown };
  const causeMsg =
    anyErr.cause instanceof Error
      ? anyErr.cause.message.toLowerCase()
      : typeof anyErr.cause === "string"
        ? anyErr.cause.toLowerCase()
        : "";

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

async function generateTextWithRetry(input: { model: string; prompt: string; label: string; maxAttempts?: number }) {
  const maxAttempts = input.maxAttempts ?? 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const m = getGemini().getGenerativeModel({ model: input.model });
      const result = await m.generateContent(input.prompt);
      return result.response.text();
    } catch (e) {
      const anyErr = e as unknown as { status?: number; cause?: unknown };
      const status = typeof anyErr.status === "number" ? anyErr.status : null;
      const cause = anyErr.cause instanceof Error ? anyErr.cause.message : typeof anyErr.cause === "string" ? anyErr.cause : null;
      const details = [status ? `status=${status}` : null, cause ? `cause=${cause}` : null].filter(Boolean).join(" ");

      if (attempt < maxAttempts && isQuotaError(e)) {
        await sleep(getRetryDelayMs(e));
        continue;
      }

      if (attempt < maxAttempts && isTransientNetworkError(e)) {
        await sleep(1000 * attempt);
        continue;
      }

      throw new Error(
        `Gemini genesis ${input.label} failed${details ? ` (${details})` : ""} (attempt ${attempt}/${maxAttempts}): ${
          e instanceof Error ? e.message : "Unknown error."
        }`,
      );
    }
  }

  throw new Error(`Gemini genesis ${input.label} failed.`);
}

function fallbackEpisode1(input: { bible: DramaticaStructure; premise: string; tone: string; genre: string }) {
  const mc = input.bible.main_character.name;
  const ic = input.bible.influence_character.name;
  const goal = input.bible.objective_story.goal;
  const consequence = input.bible.objective_story.consequence;
  const rs = input.bible.relationship_story.dynamic;
  const driver = input.bible.driver;

  const opener =
    driver === "Action"
      ? "The first sign arrives without warning, and it is unmistakably real."
      : "It starts with a choice that should be simple, until it isn’t.";

  return (
    `${opener}\n\n` +
    `${mc} has been living inside the premise for long enough that it feels normal: ${input.premise.trim()}. ` +
    `But tonight, the normal pattern breaks. The pressure around the shared goal—${goal}—tightens like a knot, and the world starts to demand an answer instead of an excuse.\n\n` +
    `${ic} appears at exactly the wrong moment, carrying the kind of certainty that makes other people dangerous. ` +
    `Between them, the relationship is already set in motion—${rs}—and even small words land like sparks near dry tinder. ` +
    `They don’t agree on what matters, or what should be sacrificed, but they agree on one thing: the clock has started, whether anyone admits it or not.\n\n` +
    `Outside, forces begin to align around the objective conflict. Rumors harden into facts. A door that used to open now stays shut. ` +
    `A familiar face delivers an ultimatum that feels personal and procedural at the same time. ` +
    `The tone is ${input.tone.trim()}, and the genre is ${input.genre.trim()}, but the stakes are brutally concrete: fail, and ${consequence}.\n\n` +
    `${mc} makes the first move—not heroic, not villainous, just necessary. ` +
    `It is an attempt to control what can still be controlled. It doesn’t work the way ${mc} expects. ` +
    `${ic} pushes back, not with force, but with the kind of influence that changes the shape of a decision.\n\n` +
    `By the time the scene ends, there is no unchosen path left. The story has ignited, and whatever comes next will demand commitment.`
  );
}

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object";
}

function snippet(text: string, max = 600) {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function requireRecord(value: unknown, path: string, raw: string): AnyRecord {
  assert(isRecord(value), `Invalid storyform JSON: expected object at ${path}. AI output: ${snippet(raw)}`);
  return value;
}

function requireString(value: unknown, path: string, raw: string): string {
  assert(typeof value === "string" && value.trim().length > 0, `Invalid storyform JSON: expected string at ${path}. AI output: ${snippet(raw)}`);
  return value;
}

function requireNumber(value: unknown, path: string, raw: string): number {
  assert(typeof value === "number" && Number.isFinite(value), `Invalid storyform JSON: expected number at ${path}. AI output: ${snippet(raw)}`);
  return value;
}

function requireArrayOfStrings(value: unknown, path: string, raw: string): string[] {
  assert(Array.isArray(value), `Invalid storyform JSON: expected array at ${path}. AI output: ${snippet(raw)}`);
  const out = value.filter((v) => typeof v === "string").map((s) => s.trim()).filter(Boolean);
  assert(out.length === value.length, `Invalid storyform JSON: expected string[] at ${path}. AI output: ${snippet(raw)}`);
  return out;
}

const DOMAIN_LITERALS = ["Universe", "Physics", "Psychology", "Mind"] as const;
type DomainLiteral = (typeof DOMAIN_LITERALS)[number];

function requireDomain(value: unknown, path: string, raw: string): DomainLiteral {
  const v = requireString(value, path, raw);
  assert((DOMAIN_LITERALS as readonly string[]).includes(v), `Invalid storyform JSON: domain at ${path} must be one of ${DOMAIN_LITERALS.join(", ")}. AI output: ${snippet(raw)}`);
  return v as DomainLiteral;
}

function validateBible(bible: DramaticaStructure) {
  const domains = [
    bible.objective_story.domain,
    bible.main_character.domain,
    bible.influence_character.domain,
    bible.relationship_story.domain,
  ];

  assert(new Set(domains).size === 4, "Invalid storyform: Throughline domains must be unique across OS/MC/IC/RS.");

  assert(
    Number.isFinite(bible.relationship_story.trust_score) &&
      bible.relationship_story.trust_score >= 0 &&
      bible.relationship_story.trust_score <= 100,
    "Invalid storyform: relationship_story.trust_score must be between 0 and 100.",
  );

  assert(Array.isArray(bible.active_facts), "Invalid storyform: active_facts must be an array.");
  assert(Array.isArray(bible.inventory), "Invalid storyform: inventory must be an array.");
}

function parseLooseJson(raw: string): unknown {
  const cleaned = stripJsonFence(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstObj = cleaned.indexOf("{");
    const lastObj = cleaned.lastIndexOf("}");
    if (firstObj >= 0 && lastObj > firstObj) {
      return JSON.parse(cleaned.slice(firstObj, lastObj + 1));
    }
    const firstArr = cleaned.indexOf("[");
    const lastArr = cleaned.lastIndexOf("]");
    if (firstArr >= 0 && lastArr > firstArr) {
      return JSON.parse(cleaned.slice(firstArr, lastArr + 1));
    }
    throw new Error("AI did not return valid JSON.");
  }
}

function normalizeDomains(domains: string[]): DomainLiteral[] {
  const picked: DomainLiteral[] = [];
  for (const d of domains) {
    if ((DOMAIN_LITERALS as readonly string[]).includes(d) && !picked.includes(d as DomainLiteral)) {
      picked.push(d as DomainLiteral);
    }
  }

  for (const d of DOMAIN_LITERALS) {
    if (picked.length >= 4) break;
    if (!picked.includes(d)) picked.push(d);
  }

  // Always return exactly 4 unique domains.
  return picked.slice(0, 4);
}

function tryConvertFromStoryFormShape(input: {
  parsed: unknown;
  genre: string;
  tone: string;
  premise: string;
}): DramaticaStructure | null {
  if (!isRecord(input.parsed)) return null;

  const root = input.parsed as AnyRecord;
  if (!isRecord(root.storyForm) && !isRecord(root.story_form)) return null;

  const storyForm = (root.storyForm ?? root.story_form) as AnyRecord;
  const plot = (isRecord(root.plot) ? (root.plot as AnyRecord) : null) ?? {};

  const domains = normalizeDomains([
    typeof storyForm.overallStoryDomain === "string" ? storyForm.overallStoryDomain : "",
    typeof storyForm.mainCharacterDomain === "string" ? storyForm.mainCharacterDomain : "",
    typeof storyForm.influenceCharacterDomain === "string" ? storyForm.influenceCharacterDomain : "",
    typeof storyForm.relationshipStoryDomain === "string" ? storyForm.relationshipStoryDomain : "",
  ].filter(Boolean));

  const driverRaw = (plot.driver ?? root.driver) as unknown;
  const limitRaw = (plot.limit ?? root.limit) as unknown;

  const driver = (driverRaw === "Decision" ? "Decision" : "Action") as DramaticaStructure["driver"];
  const limit = (limitRaw === "Timelock" ? "Timelock" : "Optionlock") as DramaticaStructure["limit"];

  const bible: DramaticaStructure = {
    objective_story: {
      domain: domains[0],
      concern: `${input.genre.trim()}: a shared pursuit with escalating stakes`,
      issue: "Responsibility",
      problem: typeof storyForm.overallStoryProblem === "string" ? storyForm.overallStoryProblem : "Uncontrolled",
      solution: typeof storyForm.overallStorySolution === "string" ? storyForm.overallStorySolution : "Control",
      goal: "Secure the objective before a rival can claim it",
      consequence: "The world hardens into a worse version of the current order",
    },
    main_character: {
      name: "The Protagonist",
      domain: domains[1],
      resolve: "Change",
      growth: "Start",
      approach: "Do-er",
      crucial_flaw: typeof storyForm.mainCharacterProblem === "string" ? storyForm.mainCharacterProblem : "Logic",
    },
    influence_character: {
      name: "The Catalyst",
      domain: domains[2],
      unique_ability: "They force clarity by refusing comforting lies",
      impact: "They pressure the protagonist to act before they feel ready",
    },
    relationship_story: {
      domain: domains[3],
      dynamic: "Uneasy Allies",
      trust_score: 50,
      catalyst: "A revelation that redefines what each person wants",
    },
    driver,
    limit,
    outcome: "Success",
    judgment: "Good",
    active_facts: [input.premise.trim()].filter(Boolean),
    inventory: [],
  };

  // Ensure our strict invariants still hold.
  validateBible(bible);
  return bible;
}

function coerceBible(parsed: unknown, raw: string): DramaticaStructure {
  const root = requireRecord(parsed, "root", raw);

  const objective = requireRecord(root.objective_story, "objective_story", raw);
  const main = requireRecord(root.main_character, "main_character", raw);
  const influence = requireRecord(root.influence_character, "influence_character", raw);
  const relationship = requireRecord(root.relationship_story, "relationship_story", raw);

  const bible: DramaticaStructure = {
    objective_story: {
      domain: requireDomain(objective.domain, "objective_story.domain", raw),
      concern: requireString(objective.concern, "objective_story.concern", raw),
      issue: requireString(objective.issue, "objective_story.issue", raw),
      problem: requireString(objective.problem, "objective_story.problem", raw),
      solution: requireString(objective.solution, "objective_story.solution", raw),
      goal: requireString(objective.goal, "objective_story.goal", raw),
      consequence: requireString(objective.consequence, "objective_story.consequence", raw),
    },
    main_character: {
      name: requireString(main.name, "main_character.name", raw),
      domain: requireDomain(main.domain, "main_character.domain", raw),
      resolve: requireString(main.resolve, "main_character.resolve", raw) as DramaticaStructure["main_character"]["resolve"],
      growth: requireString(main.growth, "main_character.growth", raw) as DramaticaStructure["main_character"]["growth"],
      approach: requireString(main.approach, "main_character.approach", raw) as DramaticaStructure["main_character"]["approach"],
      crucial_flaw: requireString(main.crucial_flaw, "main_character.crucial_flaw", raw),
    },
    influence_character: {
      name: requireString(influence.name, "influence_character.name", raw),
      domain: requireDomain(influence.domain, "influence_character.domain", raw),
      unique_ability: requireString(influence.unique_ability, "influence_character.unique_ability", raw),
      impact: requireString(influence.impact, "influence_character.impact", raw),
    },
    relationship_story: {
      domain: requireDomain(relationship.domain, "relationship_story.domain", raw),
      dynamic: requireString(relationship.dynamic, "relationship_story.dynamic", raw),
      trust_score: requireNumber(relationship.trust_score, "relationship_story.trust_score", raw),
      catalyst: requireString(relationship.catalyst, "relationship_story.catalyst", raw),
    },
    driver: requireString(root.driver, "driver", raw) as DramaticaStructure["driver"],
    limit: requireString(root.limit, "limit", raw) as DramaticaStructure["limit"],
    outcome: requireString(root.outcome, "outcome", raw) as DramaticaStructure["outcome"],
    judgment: requireString(root.judgment, "judgment", raw) as DramaticaStructure["judgment"],
    active_facts: requireArrayOfStrings(root.active_facts, "active_facts", raw),
    inventory: requireArrayOfStrings(root.inventory, "inventory", raw),
  };

  const rawCast = (root as unknown as { cast?: unknown }).cast;
  if (rawCast && typeof rawCast === "object" && !Array.isArray(rawCast)) {
    const castRecord = rawCast as Record<string, unknown>;
    const castOut: NonNullable<DramaticaStructure["cast"]> = {};
    for (const [nameRaw, profileRaw] of Object.entries(castRecord)) {
      const name = String(nameRaw).trim();
      if (!name) continue;
      if (!profileRaw || typeof profileRaw !== "object" || Array.isArray(profileRaw)) continue;

      const profile = profileRaw as Record<string, unknown>;
      const role = typeof profile.role === "string" ? profile.role.trim() : "";
      const voice_dna = typeof profile.voice_dna === "string" ? profile.voice_dna.trim() : "";
      const key_phrases = Array.isArray(profile.key_phrases)
        ? profile.key_phrases
            .filter((v) => typeof v === "string")
            .map((v) => v.trim())
            .filter(Boolean)
        : [];

      if (!role && !voice_dna && key_phrases.length === 0) continue;
      castOut[name] = { role, voice_dna, key_phrases };
    }
    if (Object.keys(castOut).length > 0) {
      bible.cast = castOut;
    }
  }

  validateBible(bible);
  return bible;
}

function parseBibleJson(raw: string): DramaticaStructure {
  const cleaned = stripJsonFence(raw);
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    assert(first >= 0 && last > first, "AI did not return valid JSON.");
    parsed = JSON.parse(cleaned.slice(first, last + 1));
  }

  return coerceBible(parsed, cleaned);
}

async function normalizeBibleToSchema(input: {
  genre: string;
  tone: string;
  premise: string;
  rawModelJson: string;
}) {
  const prompt = `Convert the following JSON into EXACTLY this TypeScript interface shape (output ONLY valid JSON, no markdown, no extra keys):

interface DramaticaStructure {
  objective_story: { domain: 'Universe'|'Physics'|'Psychology'|'Mind'; concern: string; issue: string; problem: string; solution: string; goal: string; consequence: string; };
  main_character: { name: string; domain: 'Universe'|'Physics'|'Psychology'|'Mind'; resolve: 'Change'|'Steadfast'; growth: 'Start'|'Stop'; approach: 'Do-er'|'Be-er'; crucial_flaw: string; };
  influence_character: { name: string; domain: 'Universe'|'Physics'|'Psychology'|'Mind'; unique_ability: string; impact: string; };
  relationship_story: { domain: 'Universe'|'Physics'|'Psychology'|'Mind'; dynamic: string; trust_score: number; catalyst: string; };
  cast?: { [characterName: string]: { role: string; voice_dna: string; key_phrases: string[] } };
  driver: 'Action'|'Decision';
  limit: 'Timelock'|'Optionlock';
  outcome: 'Success'|'Failure';
  judgment: 'Good'|'Bad';
  active_facts: string[];
  inventory: string[];
}

Rules:
- Preserve any domains/problems/solutions already present if possible.
- Ensure the four throughline domains are all different.
- trust_score must be an integer 0-100.
- If fields are missing, invent them consistently with the Genre/Tone/Premise.

Context:
- Genre: ${input.genre}
- Tone: ${input.tone}
- Premise: ${input.premise}

Input JSON to convert:
${input.rawModelJson}`;

return generateTextWithRetry({ model: "gemini-2.5-flash", prompt, label: "(bible-repair)" });
}

function parseStringArrayJson(raw: string): string[] {
  const cleaned = stripJsonFence(raw);
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf("[");
    const last = cleaned.lastIndexOf("]");
    assert(first >= 0 && last > first, "AI did not return valid JSON.");
    parsed = JSON.parse(cleaned.slice(first, last + 1));
  }

  assert(Array.isArray(parsed), "AI output must be a JSON array.");
  const out = parsed.filter((v) => typeof v === "string").map((s) => s.trim()).filter(Boolean);
  assert(out.length === 3, "AI must return exactly 3 premises.");
  return out;
}

export async function generateOraclePremises(input: { genre: string; tone: string; title?: string }) {
  const prompt = `Generate 3 short, irony-laden campaign premises for a serialized interactive story.

Constraints:
- Genre: ${input.genre}
- Tone: ${input.tone}
- Each premise should be 1-2 sentences.
- Make them high-concept with a twist of irony.

Return ONLY valid JSON: an array of exactly 3 strings.`;

  const text = await generateTextWithRetry({ model: "gemini-2.5-flash", prompt, label: "(oracle)" });
  return parseStringArrayJson(text);
}

export async function generateDramaticaBible(genre: string, premise: string, tone: string): Promise<{
  bible: DramaticaStructure;
  episode1: string;
}> {
  const systemPrompt = `You are a Dramatica Theory Expert. Construct a complete Grand Argument Story based on the user's premise.
  1. Assign the 4 Domains (Universe, Physics, Psychology, Mind) ensuring no duplicates across throughlines (e.g., if OS is Physics, MC cannot be Physics).
  2. Select the correct Dynamics (Driver, Limit, Resolve) that fit the Genre/Tone.
  3. Identify the Root Problem and Solution elements.
  4. Return valid JSON matching the NCPBible interface.`;

  const biblePrompt = `${systemPrompt}

Input:
- Genre: ${genre}
- Tone: ${tone}
- Premise: ${premise}

Return ONLY valid JSON matching the DramaticaStructure interface.
Do NOT return wrapper keys like storyForm/plot.
The root JSON object MUST contain these exact keys: objective_story, main_character, influence_character, relationship_story, driver, limit, outcome, judgment, active_facts, inventory.
Optional: you MAY also include a 'cast' object mapping character names to { role, voice_dna, key_phrases }.
Do not wrap in markdown.`;

  const bibleText = await generateTextWithRetry({ model: "gemini-2.5-flash", prompt: biblePrompt, label: "(bible)" });
  let bible: DramaticaStructure;
  try {
    bible = parseBibleJson(bibleText);
  } catch (e) {
    try {
      const parsed = parseLooseJson(bibleText);
      const converted = tryConvertFromStoryFormShape({ parsed, genre, tone, premise });
      if (converted) {
        bible = converted;
      } else {
        throw e;
      }
    } catch {
      const repairedText = await normalizeBibleToSchema({
        genre,
        tone,
        premise,
        rawModelJson: stripJsonFence(bibleText),
      });
      try {
        bible = parseBibleJson(repairedText);
      } catch (e2) {
        const first = e instanceof Error ? e.message : "Unknown error.";
        const second = e2 instanceof Error ? e2.message : "Unknown error.";
        throw new Error(`Genesis storyform generation failed. First pass: ${first} Second pass: ${second}`);
      }
    }
  }

  const episodePrompt = `Using this Storyform, write Episode 1 (The Inciting Incident). If driver is 'Action', start with an event. If driver is 'Decision', start with a choice.

Storyform JSON:
${JSON.stringify(bible)}

Constraints:
- Write in present tense.
- ~250-400 words.
- No headings.
- Output ONLY the prose.`;

  let episode1: string;
  try {
    const episodeText = await generateTextWithRetry({
      model: "gemini-2.5-flash",
      prompt: episodePrompt,
      label: "(episode1)",
      maxAttempts: 4,
    });
    episode1 = episodeText.trim();
  } catch (e) {
    if (isQuotaError(e)) {
      episode1 = fallbackEpisode1({ bible, premise, tone, genre });
    } else {
      throw e;
    }
  }
  assert(episode1.length > 20, "Episode 1 generation failed.");

  return { bible, episode1 };
}
