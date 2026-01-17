"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Episode } from "@/types/database";

import { buildContinuityHeader, getPathOptionStats, publishNextEpisode } from "@/app/admin/actions";
import { generateBeatSheet, generateScript, optimizeForAudio } from "@/lib/ai/director";
import { generateEpisodeAudio } from "@/lib/ai/audio";

type PathOptionStat = {
  optionId: string;
  title: string;
  description: string;
  voteCount: number;
};

export default function EpisodeManager(props: {
  accessToken: string;
  currentEpisode: Episode;
  onPublished?: () => void;
}) {
  const { accessToken, currentEpisode, onPublished } = props;

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [stats, setStats] = useState<PathOptionStat[]>([]);
  const [selectedWinnerId, setSelectedWinnerId] = useState<string | null>(null);

  const selectedWinner = useMemo(() => {
    return stats.find((s) => s.optionId === selectedWinnerId) ?? null;
  }, [selectedWinnerId, stats]);

  const [title, setTitle] = useState("");
  const [seasonNum, setSeasonNum] = useState<number>(currentEpisode.season_num);
  const [episodeNum, setEpisodeNum] = useState<number>(currentEpisode.episode_num + 1);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [draftNarrative, setDraftNarrative] = useState<string>("");

  const [beatSheet, setBeatSheet] = useState<string>("");
  const [audioScript, setAudioScript] = useState<string>("");
  const [aiLoading, setAiLoading] = useState<null | "beats" | "draft" | "audio">(null);
  const [continuityContext, setContinuityContext] = useState<string>("");

  const [audioLoading, setAudioLoading] = useState(false);

  useEffect(() => {
    setSeasonNum(currentEpisode.season_num);
    setEpisodeNum(currentEpisode.episode_num + 1);
    setAudioUrl("");
  }, [currentEpisode.episode_num, currentEpisode.season_num]);

  const refreshStats = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await getPathOptionStats(accessToken, currentEpisode.id);
      setStats(res);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to load option stats.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, currentEpisode.id]);

  async function handleGenerateAudio() {
    if (!audioScript.trim()) {
      setMessage("Audio Script is empty. Click Audio Polish first.");
      return;
    }

    setAudioLoading(true);
    setMessage(null);
    try {
      setMessage("Generating Audio...");
      const res = await generateEpisodeAudio({ episodeId: currentEpisode.id, text: audioScript });
      setAudioUrl(res.audioUrl);
      setMessage("Audio generated.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to generate audio.");
    } finally {
      setAudioLoading(false);
    }
  }

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  function handleSelectWinner(stat: PathOptionStat) {
    setSelectedWinnerId(stat.optionId);
    setDraftNarrative(`${stat.title}\n\n${stat.description}`);
    setBeatSheet("");
    setAudioScript("");
    setContinuityContext("");
    if (!title) {
      setTitle(`Episode ${currentEpisode.episode_num + 1}`);
    }
  }

  async function ensureContinuityContext() {
    if (continuityContext.trim()) return continuityContext;
    if (!selectedWinner) {
      throw new Error("Select a winner first.");
    }

    const ctx = await buildContinuityHeader(accessToken, {
      episodeId: currentEpisode.id,
      winningTitle: selectedWinner.title,
      winningDescription: selectedWinner.description,
      winningOptionId: selectedWinnerId,
    });
    setContinuityContext(ctx);
    return ctx;
  }

  async function handlePlanArc() {
    if (!selectedWinner) {
      setMessage("Select a winner first.");
      return;
    }

    setAiLoading("beats");
    setMessage(null);
    try {
      const seed = `${selectedWinner.title}\n${selectedWinner.description}`;

      const context = await ensureContinuityContext();
      const res = await generateBeatSheet(seed, context, []);
      setBeatSheet(res);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to generate beat sheet.");
    } finally {
      setAiLoading(null);
    }
  }

  async function handleWriteDraft() {
    const input = beatSheet.trim();
    if (!input) {
      setMessage("Beat sheet is empty.");
      return;
    }

    setAiLoading("draft");
    setMessage(null);
    try {
      const context = await ensureContinuityContext();
      const res = await generateScript(input, context);
      setDraftNarrative(res);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to generate draft.");
    } finally {
      setAiLoading(null);
    }
  }

  async function handleAudioPolish() {
    const input = draftNarrative.trim();
    if (!input) {
      setMessage("Draft narrative is empty.");
      return;
    }

    setAiLoading("audio");
    setMessage(null);
    try {
      const context = await ensureContinuityContext();
      const res = await optimizeForAudio(input, context);
      setAudioScript(res);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to optimize for audio.");
    } finally {
      setAiLoading(null);
    }
  }

  async function handlePublish() {
    if (!selectedWinner) {
      setMessage("Select a winner first.");
      return;
    }

    if (!title.trim()) {
      setMessage("Title is required.");
      return;
    }

    if (!draftNarrative.trim()) {
      setMessage("Draft narrative is required.");
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      await publishNextEpisode({
        accessToken,
        winningOptionId: selectedWinnerId,
        title: title.trim(),
        narrativeText: draftNarrative.trim(),
        seasonNum,
        episodeNum,
        audioUrl: audioUrl.trim() ? audioUrl.trim() : null,
      });

      setMessage("Published. Game moved to LISTEN.");
      onPublished?.();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Failed to publish next episode.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Episode Manager</CardTitle>
        <CardDescription>
          Close the round by selecting a winning submission, drafting the next episode, and publishing (moves phase to LISTEN).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Current episode</div>
            <div className="text-sm text-muted-foreground">
              S{currentEpisode.season_num}E{currentEpisode.episode_num}: {currentEpisode.title}
            </div>
          </div>
          <Button variant="secondary" onClick={refreshStats} disabled={loading}>
            Refresh tally
          </Button>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">Winner’s Circle</div>
          {stats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No path options found for this episode.</p>
          ) : (
            <div className="space-y-2">
              {stats.map((s) => (
                <div key={s.optionId} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-muted-foreground">Votes: {s.voteCount}</div>
                    <div className="text-sm font-medium">{s.title}</div>
                    <div className="whitespace-pre-wrap text-sm leading-6">{s.description}</div>
                  </div>
                  <Button
                    onClick={() => handleSelectWinner(s)}
                    disabled={loading}
                    variant={selectedWinnerId === s.optionId ? "default" : "secondary"}
                  >
                    {selectedWinnerId === s.optionId ? "Winner" : "Select Winner"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {selectedWinner ? (
          <div className="space-y-4">
            <div className="text-sm font-medium">Draft Next Episode</div>

            <div className="space-y-3 rounded-md border border-border p-3">
              <div className="text-sm font-medium">AI Director’s Console</div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handlePlanArc} disabled={loading || aiLoading !== null} variant="secondary">
                  {aiLoading === "beats" ? "Planning..." : "Plan Arc"}
                </Button>
                <Button onClick={handleWriteDraft} disabled={loading || aiLoading !== null} variant="secondary">
                  {aiLoading === "draft" ? "Writing..." : "Write Draft"}
                </Button>
                <Button onClick={handleGenerateAudio} disabled={loading || aiLoading !== null || audioLoading} variant="secondary">
                  {audioLoading ? "Generating Audio..." : "🎙️ Generate Audio"}
                </Button>
                <Button onClick={handleAudioPolish} disabled={loading || aiLoading !== null} variant="secondary">
                  {aiLoading === "audio" ? "Polishing..." : "Audio Polish"}
                </Button>
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Beat Sheet</label>
                <Textarea value={beatSheet} onChange={(e) => setBeatSheet(e.target.value)} disabled={loading || aiLoading !== null} />
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium">Audio Script (copy/paste)</label>
                <Textarea value={audioScript} readOnly />
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Draft Narrative</label>
              <Textarea value={draftNarrative} onChange={(e) => setDraftNarrative(e.target.value)} disabled={loading} />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-sm font-medium">Season #</label>
                <Input
                  type="number"
                  value={seasonNum}
                  onChange={(e) => setSeasonNum(Number(e.target.value))}
                  disabled={loading}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium">Episode #</label>
                <Input
                  type="number"
                  value={episodeNum}
                  onChange={(e) => setEpisodeNum(Number(e.target.value))}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Title</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} disabled={loading} />
            </div>

            <div className="grid gap-2">
              <label className="text-sm font-medium">Audio URL (optional)</label>
              <Input value={audioUrl} onChange={(e) => setAudioUrl(e.target.value)} disabled={loading} />
            </div>

            <Button onClick={handlePublish} disabled={loading}>
              {loading ? "Publishing..." : "Publish Next Episode (→ LISTEN)"}
            </Button>
          </div>
        ) : null}

        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
