"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export default function CampfireOwl(props: { isTalking: boolean }) {
  const { isTalking } = props;

  const idleSrc = "/assets/pixels/owl-idle.png.png";
  const talkSrc = "/assets/pixels/owl-talk.png.png";
  const blinkSrc = "/assets/pixels/owl-blink.png.png";

  const [currentSrc, setCurrentSrc] = useState<string>(idleSrc);

  useEffect(() => {
    let blinkTimeout: ReturnType<typeof setTimeout> | null = null;
    let blinkFrameTimeout: ReturnType<typeof setTimeout> | null = null;
    let talkInterval: ReturnType<typeof setInterval> | null = null;

    const clearAll = () => {
      if (blinkTimeout) clearTimeout(blinkTimeout);
      if (blinkFrameTimeout) clearTimeout(blinkFrameTimeout);
      if (talkInterval) clearInterval(talkInterval);
      blinkTimeout = null;
      blinkFrameTimeout = null;
      talkInterval = null;
    };

    clearAll();

    if (isTalking) {
      let talkOn = false;
      setCurrentSrc(idleSrc);
      talkInterval = setInterval(() => {
        talkOn = !talkOn;
        setCurrentSrc(talkOn ? talkSrc : idleSrc);
      }, 150);

      return () => {
        clearAll();
      };
    }

    const scheduleBlink = () => {
      const delayMs = 3000 + Math.floor(Math.random() * 4000);
      blinkTimeout = setTimeout(() => {
        setCurrentSrc(blinkSrc);
        blinkFrameTimeout = setTimeout(() => {
          setCurrentSrc(idleSrc);
          scheduleBlink();
        }, 150);
      }, delayMs);
    };

    setCurrentSrc(idleSrc);
    scheduleBlink();

    return () => {
      clearAll();
    };
  }, [blinkSrc, idleSrc, isTalking, talkSrc]);

  return (
    <div className={`relative ${isTalking ? "campfire-breathe" : ""} h-28 w-28 md:h-36 md:w-36`}>
      <Image
        src={currentSrc}
        alt="Owl"
        fill
        priority
        sizes="144px"
        className="[image-rendering:pixelated]"
      />
    </div>
  );
}
