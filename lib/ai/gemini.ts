import dns from "node:dns";

import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GOOGLE_API_KEY;

// Helps avoid persistent "fetch failed" errors on some networks where IPv6 DNS resolution is flaky.
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // noop
}

if (!apiKey) {
  throw new Error("Missing GOOGLE_API_KEY");
}

export const gemini = new GoogleGenerativeAI(apiKey);
