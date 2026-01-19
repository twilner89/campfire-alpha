"use client";

import type { ReactNode } from "react";

import PhaseTimer from "@/components/game/PhaseTimer";
import type { GamePhase } from "@/types/database";

type Props = {
  fireHealth: number;
  phase: GamePhase | null;
  expiry: string | null;
  children: ReactNode;
};

export default function CampfireConsole(props: Props) {
  const { fireHealth, phase, expiry, children } = props;

  const clamped = Number.isFinite(fireHealth) ? Math.max(0, Math.min(100, fireHealth)) : 0;

  return (
    <div className="relative z-50 flex h-[250px] w-full flex-col bg-slate-900">
      <div
        className="w-full"
        style={{
          height: 6,
          background: `linear-gradient(90deg, #ea580c ${clamped}%, #475569 ${clamped}%)`,
        }}
      />

      <div className="flex items-center justify-between border-b-2 border-slate-700 px-4 py-2">
        <div className="font-press-start text-[10px] tracking-wide text-slate-100/90">Campfire Console</div>
        <div className="flex items-center gap-3">
          <div className="font-press-start text-[10px] text-slate-200/70">Next</div>
          <PhaseTimer phase={phase} expiry={expiry} />
          <div className="font-press-start text-[10px] text-slate-200/70">{phase ?? "(loading)"}</div>
        </div>
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden p-4">{children}</div>
    </div>
  );
}
