"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";

import type { Database } from "@/types/database";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function submitAlphaCode(formData: FormData): Promise<{ success?: true; error?: string }> {
  const submittedCode = String(formData.get("code") ?? "").trim();
  const accessToken = String(formData.get("accessToken") ?? "").trim();

  const expected = (process.env.ALPHA_CODE ?? "").trim();
  if (!expected) {
    return { error: "Server misconfigured: missing ALPHA_CODE." };
  }

  if (!submittedCode || submittedCode !== expected) {
    return { error: "Invalid Access Code" };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return { error: "Server misconfigured." };
  }

  if (!accessToken) {
    return { error: "You must be signed in to enter an access code." };
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
    return { error: "Invalid session." };
  }

  const adminClient = createServerSupabaseClient({ admin: true });

  const upsertAttempt = await adminClient
    .from("profiles")
    .upsert({ id: userData.user.id, has_access: true }, { onConflict: "id" });

  if (upsertAttempt.error) {
    const msg = upsertAttempt.error.message.toLowerCase();
    if (msg.includes("has_access")) {
      return { error: "Database missing profiles.has_access. Run the Supabase SQL migration first." };
    }
    return { error: upsertAttempt.error.message };
  }

  revalidatePath("/game");
  return { success: true };
}
