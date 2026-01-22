import dns from "node:dns";

import { GoogleGenerativeAI } from "@google/generative-ai";

// Helps avoid persistent "fetch failed" errors on some networks where IPv6 DNS resolution is flaky.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // noop
}

let geminiSingleton: GoogleGenerativeAI | null = null;

export function getGemini(): GoogleGenerativeAI {
  if (geminiSingleton) return geminiSingleton;
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GOOGLE_API_KEY");
  }
  geminiSingleton = new GoogleGenerativeAI(apiKey);
  return geminiSingleton;
}
