"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function CampfireOwl(props: { isTalking: boolean; className?: string }) {
  const { isTalking, className } = props;

  const idleSrc = "/assets/pixels/owl-idle.png.png";
  const talkSrc = "/assets/pixels/owl-talk.png.png";
  const blinkSrc = "/assets/pixels/owl-blink.png.png";

  const [currentSrc, setCurrentSrc] = useState<string>(idleSrc);

  useEffect(() => {
    let cancelled = false;
    let blinkTimeout: ReturnType<typeof setTimeout> | null = null;
    let blinkFrameTimeout: ReturnType<typeof setTimeout> | null = null;
    let talkTimeout: ReturnType<typeof setTimeout> | null = null;

    const clearAll = () => {
      if (blinkTimeout) clearTimeout(blinkTimeout);
      if (blinkFrameTimeout) clearTimeout(blinkFrameTimeout);
      if (talkTimeout) clearTimeout(talkTimeout);
      blinkTimeout = null;
      blinkFrameTimeout = null;
      talkTimeout = null;
    };

    clearAll();

    if (isTalking) {
      setCurrentSrc(idleSrc);
      const randomInt = (minMs: number, maxMs: number) => {
        const span = Math.max(0, maxMs - minMs);
        return minMs + Math.floor(Math.random() * (span + 1));
      };

      const speechLoop = () => {
        if (cancelled) return;
        if (!isTalking) return;

        setCurrentSrc(talkSrc);
        talkTimeout = setTimeout(() => {
          if (cancelled) return;
          if (!isTalking) return;

          setCurrentSrc(idleSrc);
          talkTimeout = setTimeout(() => {
            speechLoop();
          }, randomInt(50, 150));
        }, randomInt(150, 400));
      };

      speechLoop();

      return () => {
        cancelled = true;
        clearAll();
      };
    }

    const scheduleBlink = () => {
      const delayMs = 3000 + Math.floor(Math.random() * 4000);
      blinkTimeout = setTimeout(() => {
        if (cancelled) return;
        if (isTalking) return;
        setCurrentSrc(blinkSrc);
        blinkFrameTimeout = setTimeout(() => {
          if (cancelled) return;
          if (isTalking) return;
          setCurrentSrc(idleSrc);
          scheduleBlink();
        }, 150);
      }, delayMs);
    };

    setCurrentSrc(idleSrc);
    scheduleBlink();

    return () => {
      cancelled = true;
      clearAll();
    };
  }, [blinkSrc, idleSrc, isTalking, talkSrc]);

  return (
    <div className={`relative aspect-square w-full ${className ?? ""}`.trim()}>
      <Image
        src={currentSrc}
        alt="Owl"
        fill
        priority
        sizes="144px"
        className="[image-rendering:pixelated] object-contain"
      />
    </div>
  );
}
