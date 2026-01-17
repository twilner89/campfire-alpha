import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { DURATION_PROCESS, DURATION_SUBMIT, DURATION_VOTE } from "@/lib/game/schedule";
import type { Database, GamePhase } from "@/types/database";

const GAME_STATE_SINGLETON_ID = "00000000-0000-0000-0000-000000000001";

function getBearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const [type, token] = header.split(" ");
  if (type?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

function isValidPhase(value: unknown): value is GamePhase {
  return value === "LISTEN" || value === "SUBMIT" || value === "VOTE" || value === "PROCESS";
}

export async function PATCH(request: Request) {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return NextResponse.json({ ok: false, error: "Server misconfigured." }, { status: 500 });
    }

    const token = getBearerToken(request);
    if (!token) {
      return NextResponse.json({ ok: false, error: "Missing auth token." }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
    }

    const payload = body as {
      current_phase?: unknown;
      current_episode_id?: unknown;
      current_series_bible_id?: unknown;
      durationMinutes?: unknown;
    };

    const update: {
      current_phase?: GamePhase;
      current_episode_id?: string | null;
      current_series_bible_id?: string | null;
      phase_expiry?: string | null;
    } = {};

    if (payload.current_phase !== undefined) {
      if (!isValidPhase(payload.current_phase)) {
        return NextResponse.json({ ok: false, error: "Invalid phase." }, { status: 400 });
      }
      update.current_phase = payload.current_phase;

      if (payload.current_phase === "LISTEN") {
        update.phase_expiry = null;
      }

      if (payload.current_phase === "SUBMIT" || payload.current_phase === "VOTE" || payload.current_phase === "PROCESS") {
        const hasDurationOverride = payload.durationMinutes !== undefined;

        if (hasDurationOverride) {
          const parsed = typeof payload.durationMinutes === "number" ? payload.durationMinutes : Number(payload.durationMinutes);
          const durationMinutes = Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 15;
          update.phase_expiry = new Date(Date.now() + durationMinutes * 60_000).toISOString();
        } else {
          const scheduleMs =
            payload.current_phase === "SUBMIT" ? DURATION_SUBMIT : payload.current_phase === "VOTE" ? DURATION_VOTE : DURATION_PROCESS;
          update.phase_expiry = new Date(Date.now() + scheduleMs).toISOString();
        }
      }
    }

    if (payload.current_episode_id !== undefined) {
      if (payload.current_episode_id === null) {
        update.current_episode_id = null;
      } else if (typeof payload.current_episode_id === "string") {
        update.current_episode_id = payload.current_episode_id;
      } else {
        return NextResponse.json({ ok: false, error: "Invalid current_episode_id." }, { status: 400 });
      }
    }

    if (payload.current_series_bible_id !== undefined) {
      if (payload.current_series_bible_id === null) {
        update.current_series_bible_id = null;
      } else if (typeof payload.current_series_bible_id === "string") {
        update.current_series_bible_id = payload.current_series_bible_id;
      } else {
        return NextResponse.json({ ok: false, error: "Invalid current_series_bible_id." }, { status: 400 });
      }
    }

    const userClient = createClient<Database>(url, anonKey, {
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
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
      return NextResponse.json({ ok: false, error: "Invalid session." }, { status: 401 });
    }

    let adminClient: ReturnType<typeof createServerSupabaseClient>;
    try {
      adminClient = createServerSupabaseClient({ admin: true });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "Admin client initialization failed." },
        { status: 500 },
      );
    }

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (profileError) {
      return NextResponse.json({ ok: false, error: profileError.message }, { status: 500 });
    }

    if (!profile?.is_admin) {
      return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });
    }

    let { data: singletonState, error: singletonError } = await adminClient
      .from("game_state")
      .select("id,current_phase,current_episode_id,current_series_bible_id,phase_expiry")
      .eq("id", GAME_STATE_SINGLETON_ID)
      .maybeSingle();

    if (singletonError) {
      // Backward compatible fallback if columns don't exist yet.
      const msg = singletonError.message.toLowerCase();
      const missingBibleColumn = msg.includes("current_series_bible_id") || msg.includes("schema cache") || msg.includes("column");
      const missingExpiryColumn = msg.includes("phase_expiry");
      if (missingBibleColumn) {
        ({ data: singletonState, error: singletonError } = await adminClient
          .from("game_state")
          .select(missingExpiryColumn ? "id,current_phase,current_episode_id" : "id,current_phase,current_episode_id,phase_expiry")
          .eq("id", GAME_STATE_SINGLETON_ID)
          .maybeSingle());
      }

      if (singletonError && missingExpiryColumn) {
        ({ data: singletonState, error: singletonError } = await adminClient
          .from("game_state")
          .select("id,current_phase,current_episode_id,current_series_bible_id")
          .eq("id", GAME_STATE_SINGLETON_ID)
          .maybeSingle());
      }
    }

    if (singletonError?.message?.includes("column game_state.id")) {
      const { data: legacyStates, error: legacyError } = await adminClient
        .from("game_state")
        .select("current_phase,current_episode_id,phase_expiry")
        .limit(1);

      if (legacyError) {
        return NextResponse.json({ ok: false, error: legacyError.message }, { status: 500 });
      }

      if ((legacyStates?.length ?? 0) === 0) {
        const insert = {
          current_phase: update.current_phase ?? "LISTEN",
          current_episode_id: update.current_episode_id ?? null,
          ...(update.phase_expiry !== undefined ? { phase_expiry: update.phase_expiry } : null),
        };

        const { error: insertError } = await adminClient.from("game_state").insert(insert);
        if (insertError) {
          return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
      }

      const old = legacyStates?.[0];
      let legacyUpdate = adminClient.from("game_state").update(update).eq("current_phase", old.current_phase);

      if (old.current_episode_id === null) {
        legacyUpdate = legacyUpdate.is("current_episode_id", null);
      } else {
        legacyUpdate = legacyUpdate.eq("current_episode_id", old.current_episode_id);
      }

      const { error: updateError } = await legacyUpdate;
      if (updateError) {
        return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    if (singletonError) {
      return NextResponse.json({ ok: false, error: singletonError.message }, { status: 500 });
    }

    if (!singletonState) {
      const insert: {
        id: string;
        current_phase: GamePhase;
        current_episode_id: string | null;
        current_series_bible_id?: string | null;
        phase_expiry?: string | null;
      } = {
        id: GAME_STATE_SINGLETON_ID,
        current_phase: update.current_phase ?? "LISTEN",
        current_episode_id: update.current_episode_id ?? null,
      };

      if (update.current_series_bible_id !== undefined) {
        insert.current_series_bible_id = update.current_series_bible_id;
      }

      if (update.phase_expiry !== undefined) {
        insert.phase_expiry = update.phase_expiry;
      }

      const { error: insertError } = await adminClient.from("game_state").insert(insert);
      if (insertError) {
        return NextResponse.json({ ok: false, error: insertError.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true });
    }

    const { error: updateError } = await adminClient.from("game_state").update(update).eq("id", GAME_STATE_SINGLETON_ID);

    if (updateError) {
      const msg = updateError.message.toLowerCase();
      const missingBibleColumn = msg.includes("current_series_bible_id") || msg.includes("schema cache") || msg.includes("column");
      if (missingBibleColumn && update.current_series_bible_id !== undefined) {
        // Fallback for DBs that haven't applied current_series_bible_id column yet.
        const fallbackUpdate = { ...update };
        delete (fallbackUpdate as { current_series_bible_id?: unknown }).current_series_bible_id;
        const { error: fallbackError } = await adminClient.from("game_state").update(fallbackUpdate).eq("id", GAME_STATE_SINGLETON_ID);
        if (fallbackError) {
          return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
        }
        return NextResponse.json({ ok: true });
      }

      const missingExpiryColumn = msg.includes("phase_expiry");
      if (missingExpiryColumn && update.phase_expiry !== undefined) {
        const fallbackUpdate = { ...update };
        delete (fallbackUpdate as { phase_expiry?: unknown }).phase_expiry;
        const { error: fallbackError } = await adminClient.from("game_state").update(fallbackUpdate).eq("id", GAME_STATE_SINGLETON_ID);
        if (fallbackError) {
          return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
        }
        return NextResponse.json({ ok: true });
      }
    }

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown error." }, { status: 500 });
  }
}
