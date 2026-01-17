"use client";

import type { RefObject } from "react";
import { useEffect, useRef, useState } from "react";

export function useTypewriter(
  text: string,
  options?: {
    speedMs?: number;
    enabled?: boolean;
    containerRef?: RefObject<HTMLElement | null>;
    onChar?: () => void;
  },
) {
  const speedMs = options?.speedMs ?? 30;
  const enabled = options?.enabled ?? true;
  const containerRef = options?.containerRef;
  const onChar = options?.onChar;

  const [out, setOut] = useState("");
  const indexRef = useRef(0);
  const textRef = useRef(text);

  useEffect(() => {
    if (textRef.current === text) return;
    textRef.current = text;
    indexRef.current = 0;
    queueMicrotask(() => {
      setOut("");
    });
  }, [text]);

  useEffect(() => {
    if (!enabled) return;
    if (indexRef.current >= text.length) return;

    const id = window.setInterval(() => {
      indexRef.current += 1;
      const next = text.slice(0, indexRef.current);
      setOut(next);
      onChar?.();
    }, speedMs);

    return () => {
      window.clearInterval(id);
    };
  }, [enabled, onChar, speedMs, text]);

  useEffect(() => {
    const el = containerRef?.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight });
  }, [containerRef, out]);

  return enabled ? out : text;
}
