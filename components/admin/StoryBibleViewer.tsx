"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getActiveSeriesBible } from "@/app/admin/actions";
import { generateBibleAudio } from "@/lib/ai/audio";

type ActiveSeriesBible = Awaited<ReturnType<typeof getActiveSeriesBible>>;

export default function StoryBibleViewer(props: { accessToken: string; disabled?: boolean }) {
  const { accessToken, disabled } = props;

  const [loading, setLoading] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [bible, setBible] = useState<ActiveSeriesBible>(null);

  async function refresh() {
    setLoading(true);
    setMessage(null);
    try {
      const res = await getActiveSeriesBible(accessToken);
      setBible(res);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to load story bible.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken]);

  async function copyJson() {
    if (!bible) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(bible.bible_json, null, 2));
      setMessage("Copied bible JSON to clipboard.");
    } catch {
      setMessage("Failed to copy.");
    }
  }

  async function handleGenerateIntroAudio() {
    if (!bible) return;
    setAudioLoading(true);
    setMessage(null);
    try {
      setMessage("Generating intro audio...");
      await generateBibleAudio(bible.id);
      setMessage("Intro audio generated.");
      await refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to generate intro audio.");
    } finally {
      setAudioLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Story Bible (NCP)</CardTitle>
        <CardDescription>Read-only view of the active Dramatica/NCP bible used as canon constraints.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void refresh()} disabled={disabled || loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
          <Button variant="secondary" onClick={() => void copyJson()} disabled={disabled || loading || !bible}>
            Copy JSON
          </Button>
          <Button onClick={() => void handleGenerateIntroAudio()} disabled={disabled || loading || audioLoading || !bible}>
            {audioLoading ? "Generating Intro Audio..." : "🎙️ Generate Intro Audio"}
          </Button>
        </div>

        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}

        {!bible ? (
          <p className="text-sm text-muted-foreground">No series bible found yet. Use Genesis Engine to ignite a campaign.</p>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">{bible.title}</div>
            {((bible as { intro_audio_url?: string | null }).intro_audio_url ?? null) ? (
              <div className="grid gap-1 text-sm">
                <div>
                  <span className="text-muted-foreground">Intro audio:</span> {((bible as { intro_audio_url?: string | null }).intro_audio_url ?? "").trim()}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">Intro audio not generated yet.</div>
            )}
            <div className="grid gap-1 text-sm">
              <div>
                <span className="text-muted-foreground">Genre:</span> {bible.genre}
              </div>
              <div>
                <span className="text-muted-foreground">Tone:</span> {bible.tone}
              </div>
              <div>
                <span className="text-muted-foreground">Premise:</span> {bible.premise}
              </div>
            </div>

            <pre className="max-h-[420px] overflow-auto rounded-md border border-border bg-muted p-3 text-xs leading-5">
{JSON.stringify(bible.bible_json, null, 2)}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
