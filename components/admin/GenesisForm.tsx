"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import { igniteCampaign, oraclePremises } from "@/app/admin/actions";

export default function GenesisForm(props: {
  accessToken: string;
  disabled?: boolean;
  onIgnited?: () => void;
}) {
  const { accessToken, disabled, onIgnited } = props;

  const [loading, setLoading] = useState<null | "oracle" | "ignite">(null);
  const [message, setMessage] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [tone, setTone] = useState("");
  const [premise, setPremise] = useState("");

  const [oracleSuggestions, setOracleSuggestions] = useState<string[]>([]);

  async function handleOracle() {
    setLoading("oracle");
    setMessage(null);
    try {
      const res = await oraclePremises(accessToken, {
        title: title.trim(),
        genre: genre.trim(),
        tone: tone.trim(),
      });
      setOracleSuggestions(res);
      if (!premise.trim() && res[0]) {
        setPremise(res[0]);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to generate premises.");
    } finally {
      setLoading(null);
    }
  }

  async function handleIgnite() {
    setLoading("ignite");
    setMessage(null);
    try {
      await igniteCampaign({
        accessToken,
        title: title.trim(),
        genre: genre.trim(),
        tone: tone.trim(),
        premise: premise.trim(),
      });
      setMessage("Campaign ignited. Episode 1 published. Phase set to LISTEN.");
      onIgnited?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to ignite campaign.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Genesis Engine</CardTitle>
        <CardDescription>Initialize a new campaign by generating a strict Dramatica storyform and Episode 1.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <label className="text-sm font-medium">Title</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={disabled || loading !== null} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <label className="text-sm font-medium">Genre</label>
            <Input value={genre} onChange={(e) => setGenre(e.target.value)} disabled={disabled || loading !== null} />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium">Tone</label>
            <Input value={tone} onChange={(e) => setTone(e.target.value)} disabled={disabled || loading !== null} />
          </div>
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">Premise</label>
          <Textarea value={premise} onChange={(e) => setPremise(e.target.value)} disabled={disabled || loading !== null} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleOracle} disabled={disabled || loading !== null} variant="secondary">
            {loading === "oracle" ? "Rolling..." : "🎲 Oracle"}
          </Button>
          <Button onClick={handleIgnite} disabled={disabled || loading !== null}>
            {loading === "ignite" ? "Igniting..." : "💥 Ignite Simulation"}
          </Button>
        </div>

        {oracleSuggestions.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm font-medium">Oracle Premises</div>
            <div className="grid gap-2">
              {oracleSuggestions.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="rounded-md border border-border p-3 text-left text-sm hover:bg-accent"
                  onClick={() => setPremise(p)}
                  disabled={disabled || loading !== null}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
