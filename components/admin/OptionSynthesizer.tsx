"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { openVoting, simulateSubmissions, synthesizeOptions } from "@/app/admin/actions";
import type { PathOptionDraft } from "@/lib/ai/director";

export default function OptionSynthesizer(props: {
  accessToken: string;
  episodeId: string;
  disabled?: boolean;
  onOpened?: () => void;
}) {
  const { accessToken, episodeId, disabled, onOpened } = props;

  const [loading, setLoading] = useState<null | "synthesize" | "open" | "swarm">(null);
  const [message, setMessage] = useState<string | null>(null);
  const [options, setOptions] = useState<PathOptionDraft[] | null>(null);

  const canOpenVoting = useMemo(() => {
    if (!options || options.length !== 3) return false;
    return options.every((o) => o.title.trim() && o.description.trim());
  }, [options]);

  async function handleSynthesize() {
    setLoading("synthesize");
    setMessage(null);
    try {
      const res = await synthesizeOptions(accessToken, episodeId);
      setOptions(res);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to synthesize options.");
    } finally {
      setLoading(null);
    }
  }

  async function handleSimulateSwarm() {
    setLoading("swarm");
    setMessage(null);
    try {
      const res = await simulateSubmissions(accessToken, episodeId, 20);
      setMessage(`Inserted ${res.inserted} synthetic submissions.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to simulate submissions.");
    } finally {
      setLoading(null);
    }
  }

  async function handleOpenVoting() {
    if (!options) {
      setMessage("No options to publish.");
      return;
    }

    setLoading("open");
    setMessage(null);
    try {
      await openVoting({ accessToken, episodeId, options, durationMinutes: 15 });
      setMessage("Voting opened (phase → VOTE). ");
      onOpened?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to open voting.");
    } finally {
      setLoading(null);
    }
  }

  function updateOption(index: number, patch: Partial<PathOptionDraft>) {
    setOptions((prev) => {
      const current = prev ?? [
        { title: "", description: "" },
        { title: "", description: "" },
        { title: "", description: "" },
      ];
      const next = current.map((o) => ({ ...o }));
      next[index] = { ...next[index], ...patch };
      return next;
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Option Synthesizer</CardTitle>
        <CardDescription>Synthesize all submissions into 3 distinct voting paths (Hive Mind engine).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleSimulateSwarm} disabled={disabled || loading !== null} variant="secondary">
            {loading === "swarm" ? "Simulating..." : "🧪 Simulate Swarm"}
          </Button>
          <Button onClick={handleSynthesize} disabled={disabled || loading !== null}>
            {loading === "synthesize" ? "Synthesizing..." : "Synthesize Paths"}
          </Button>
          <Button
            onClick={handleOpenVoting}
            disabled={disabled || loading !== null || !canOpenVoting}
            variant="secondary"
          >
            {loading === "open" ? "Opening..." : "🚀 Open Voting"}
          </Button>
        </div>

        {options ? (
          <div className="grid gap-3">
            {options.map((o, idx) => (
              <div key={idx} className="space-y-2 rounded-md border border-border p-3">
                <div className="text-sm font-medium">Option {idx + 1}</div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Title</label>
                  <Input
                    value={o.title}
                    onChange={(e) => updateOption(idx, { title: e.target.value })}
                    disabled={disabled || loading !== null}
                  />
                </div>
                <div className="grid gap-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    value={o.description}
                    onChange={(e) => updateOption(idx, { description: e.target.value })}
                    disabled={disabled || loading !== null}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Click “Synthesize Paths” to generate 3 options from submissions.</p>
        )}

        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
