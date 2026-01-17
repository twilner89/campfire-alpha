"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { castVote } from "@/app/game/actions";
import type { GamePhase } from "@/types/database";

type OptionRow = {
  id: string;
  title: string;
  description: string;
};

export default function GameInteractions(props: {
  phase: GamePhase | null;
  episodeId: string | null;
}) {
  const { phase, episodeId } = props;

  const supabase = useMemo(() => createBrowserSupabaseClient(), []);

  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [options, setOptions] = useState<OptionRow[]>([]);
  const [userVotes, setUserVotes] = useState<Set<string>>(new Set());

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [submissionText, setSubmissionText] = useState("");

  const refreshAuth = useCallback(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      setUserId(null);
      setEmail(null);
      setMessage(error.message);
      return;
    }

    const session = data.session;
    setUserId(session?.user.id ?? null);
    setEmail(session?.user.email ?? null);
  }, [supabase]);

  const refreshVoteData = useCallback(
    async (currentUserId: string, rows: OptionRow[]) => {
      if (rows.length === 0) {
        setUserVotes(new Set());
        return;
      }

      const optionIds = rows.map((r) => r.id);

      const { data, error } = await supabase
        .from("votes")
        .select("option_id")
        .eq("user_id", currentUserId)
        .in("option_id", optionIds);

      if (error) {
        setMessage(error.message);
        return;
      }

      setUserVotes(new Set((data ?? []).map((v) => v.option_id)));
    },
    [supabase]
  );

  const refreshOptions = useCallback(async () => {
    if (!episodeId) {
      setOptions([]);
      setUserVotes(new Set());
      return;
    }

    if (!userId) {
      setOptions([]);
      setUserVotes(new Set());
      return;
    }

    setLoading(true);
    setMessage(null);

    const { data, error } = await supabase
      .from("path_options")
      .select("id,title,description")
      .eq("episode_id", episodeId)
      .order("title", { ascending: true });

    if (error) {
      setLoading(false);
      setMessage(error.message);
      return;
    }

    const rows = (data ?? []) as OptionRow[];
    setOptions(rows);

    await refreshVoteData(userId, rows);
    setLoading(false);
  }, [episodeId, refreshVoteData, supabase, userId]);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshAuth();
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(() => {
      void refreshAuth();
    });

    return () => {
      subscription.subscription.unsubscribe();
    };
  }, [refreshAuth, supabase]);

  useEffect(() => {
    if (phase === "VOTE") {
      queueMicrotask(() => {
        void refreshOptions();
      });
    }
  }, [phase, refreshOptions]);

  async function handleSignOut() {
    setLoading(true);
    setMessage(null);
    const { error } = await supabase.auth.signOut();
    setLoading(false);
    if (error) {
      setMessage(error.message);
    }
  }

  async function handleSubmit() {
    if (!episodeId) {
      setMessage("No active episode.");
      return;
    }
    if (!userId) {
      setMessage("You must be signed in to submit.");
      return;
    }

    const text = submissionText.trim();
    if (!text) {
      setMessage("Please enter a submission.");
      return;
    }

    setLoading(true);
    setMessage(null);

    const { error } = await supabase.from("submissions").insert({
      user_id: userId,
      episode_id: episodeId,
      content_text: text,
    });

    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setSubmissionText("");
    setMessage("Submitted!");
  }

  async function handleVote(optionId: string) {
    if (!episodeId) {
      setMessage("No active episode.");
      return;
    }
    if (!userId) {
      setMessage("You must be signed in to vote.");
      return;
    }

    setLoading(true);
    setMessage(null);

    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      setLoading(false);
      setMessage(sessionError.message);
      return;
    }

    const token = data.session?.access_token ?? null;
    if (!token) {
      setLoading(false);
      setMessage("You must be signed in to vote.");
      return;
    }

    try {
      await castVote(token, optionId);
    } catch (e) {
      setLoading(false);
      setMessage(e instanceof Error ? e.message : "Voting failed.");
      return;
    }

    setLoading(false);

    setUserVotes((prev) => {
      const next = new Set(prev);
      next.add(optionId);
      return next;
    });
    setMessage("Voted!");
  }

  if (!phase) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Participation</CardTitle>
        <CardDescription>
          {email ? (
            <span>
              Signed in as <span className="font-medium text-foreground">{email}</span>
            </span>
          ) : (
            <span>
              You’re not signed in. <Link className="underline" href="/auth">Sign in</Link> to submit and vote.
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {email ? (
          <div>
            <Button variant="outline" onClick={handleSignOut} disabled={loading}>
              Sign out
            </Button>
          </div>
        ) : null}

        {phase === "SUBMIT" ? (
          <div className="space-y-3">
            <div className="text-sm font-medium">Submit your idea</div>
            <Textarea
              placeholder="What should happen next?"
              value={submissionText}
              onChange={(e) => setSubmissionText(e.target.value)}
              disabled={!email || loading}
            />
            <Button onClick={handleSubmit} disabled={!email || loading}>
              {loading ? "Submitting..." : "Submit"}
            </Button>
          </div>
        ) : null}

        {phase === "VOTE" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Vote on paths</div>
              <Button variant="outline" onClick={refreshOptions} disabled={!email || loading}>
                Refresh
              </Button>
            </div>

            {!email ? (
              <p className="text-sm text-muted-foreground">Sign in to view and vote on paths.</p>
            ) : loading ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : options.length === 0 ? (
              <p className="text-sm text-muted-foreground">No options yet.</p>
            ) : (
              <div className="space-y-2">
                {options.map((o) => {
                  const voted = userVotes.has(o.id);
                  return (
                    <div key={o.id} className="rounded-lg border p-3">
                      <div className="text-sm font-medium">{o.title}</div>
                      <div className="mt-1 whitespace-pre-wrap text-sm leading-6">{o.description}</div>
                      <div className="mt-2">
                        <Button
                          size="sm"
                          onClick={() => handleVote(o.id)}
                          disabled={loading || voted}
                          variant={voted ? "secondary" : "default"}
                        >
                          {voted ? "Voted" : "Vote"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : null}

        {phase === "PROCESS" ? (
          <p className="text-sm text-muted-foreground">Processing results… check back soon.</p>
        ) : null}

        {phase === "LISTEN" ? (
          <p className="text-sm text-muted-foreground">
            Listen to the story. When the phase changes to SUBMIT or VOTE, you’ll be able to participate here.
          </p>
        ) : null}

        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
