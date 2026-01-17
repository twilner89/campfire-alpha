"use server";

import { gemini } from "@/lib/ai/gemini";

function stripJsonFence(text: string) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseStringArrayJson(raw: string): string[] {
  const cleaned = stripJsonFence(raw);
  let parsed: unknown;

  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const firstArr = cleaned.indexOf("[");
    const lastArr = cleaned.lastIndexOf("]");
    if (firstArr >= 0 && lastArr > firstArr) {
      parsed = JSON.parse(cleaned.slice(firstArr, lastArr + 1));
    } else {
      throw new Error("AI did not return valid JSON.");
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AI output must be a JSON array.");
  }

  return parsed
    .filter((v) => typeof v === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseLooseLineList(raw: string) {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^[-*]\s+/, "").replace(/^\d+[\).]\s+/, "").trim())
    .filter(Boolean);
}

export async function generateChaoticSuggestions(input: { context: string; count: number }) {
  const count = Math.max(1, Math.min(50, Math.floor(input.count)));

  const prompt = `You are a chaotic group of 20 RPG players.

The current story just ended with:
${input.context}

Generate ${count} distinct, short suggestions for what should happen next.
- Range from "Logical" to "Insane" to "Troll".
- Each suggestion should be 1 short sentence.
- No numbering.

Return ONLY valid JSON: an array of exactly ${count} strings.`;

  const models = ["gemini-2.5-flash", "gemini-2.5-pro"];
  let text = "";
  let lastError: unknown = null;

  for (const modelName of models) {
    try {
      const model = gemini.getGenerativeModel({
        model: modelName,
        generationConfig: {
          temperature: 0.9,
        },
      });
      const result = await model.generateContent(prompt);
      text = result.response.text();
      break;
    } catch (e) {
      lastError = e;
    }
  }

  if (!text.trim()) {
    throw new Error(lastError instanceof Error ? lastError.message : "Failed to generate suggestions.");
  }

  let suggestions: string[];
  try {
    suggestions = parseStringArrayJson(text);
  } catch {
    suggestions = parseLooseLineList(text);
  }

  if (suggestions.length !== count) {
    return suggestions.slice(0, count);
  }

  return suggestions;
}
