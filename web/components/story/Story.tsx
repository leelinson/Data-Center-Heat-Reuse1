"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { NavBar } from "../ui";
import type { AppData } from "@/lib/types";
import { buildSteps } from "./steps";

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.getAttribute?.("role") === "slider" || el.isContentEditable;
}

export function Story({ data }: { data: AppData }) {
  const steps = useMemo(() => buildSteps(data), [data]);
  const calm = useReducedMotion();
  const [i, setI] = useState(0);
  const [dir, setDir] = useState(1);
  const [notes, setNotes] = useState(false);
  const [short, setShort] = useState(true); // default = ~5-minute path; S toggles the deep dive
  const [secs, setSecs] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const path = useMemo(() => steps.map((s, idx) => idx).filter((idx) => !short || !steps[idx].deepDive), [steps, short]);
  const pos = Math.max(0, path.indexOf(i));

  const go = useCallback(
    (to: number) => {
      const t = Math.min(steps.length - 1, Math.max(0, to));
      setI((cur) => {
        setDir(t >= cur ? 1 : -1);
        return t;
      });
    },
    [steps.length],
  );
  const move = useCallback(
    (delta: number) => {
      const cur = path.indexOf(i);
      if (cur === -1) {
        // current step is skipped on the short path: jump to nearest
        const nxt = delta > 0 ? path.find((p) => p > i) : [...path].reverse().find((p) => p < i);
        if (nxt !== undefined) go(nxt);
        return;
      }
      const n = path[Math.min(path.length - 1, Math.max(0, cur + delta))];
      go(n);
    },
    [path, i, go],
  );

  // hash sync (#3 = step 3)
  useEffect(() => {
    const h = parseInt(window.location.hash.replace("#", ""), 10);
    if (h >= 1 && h <= steps.length) { setI(h - 1); if (steps[h - 1].deepDive) setShort(false); }
  }, [steps.length]);
  useEffect(() => {
    history.replaceState(null, "", `#${i + 1}`);
  }, [i]);

  // presenter timer
  useEffect(() => {
    if (notes) timer.current = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [notes]);

  useEffect(() => {
    // On a short screen a step can overflow; scroll it into view before advancing.
    const scrollStep = (dir: 1 | -1) => {
      const el = document.querySelector<HTMLElement>("main > section");
      if (!el) return false;
      const room = dir > 0 ? el.scrollHeight - el.clientHeight - el.scrollTop : el.scrollTop;
      if (room <= 4) return false;
      el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: calm ? "auto" : "smooth" });
      return true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
      const onButton = (e.target as HTMLElement | null)?.tagName === "BUTTON";
      switch (e.key) {
        case "ArrowDown": case "PageDown":
          e.preventDefault(); if (!scrollStep(1)) move(1); break;
        case "ArrowUp": case "PageUp":
          e.preventDefault(); if (!scrollStep(-1)) move(-1); break;
        case "ArrowRight":
          e.preventDefault(); move(1); break;
        case " ":
          if (onButton) return;
          e.preventDefault(); move(e.shiftKey ? -1 : 1); break;
        case "ArrowLeft":
          e.preventDefault(); move(-1); break;
        case "Home": e.preventDefault(); go(0); break;
        case "End": e.preventDefault(); go(steps.length - 1); break;
        case "p": case "P": setNotes((n) => !n); break;
        case "s": case "S": setShort((s) => !s); break;
        case "f": case "F":
          if (document.fullscreenElement) void document.exitFullscreen();
          else void document.documentElement.requestFullscreen?.().catch(() => {});
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, go, steps.length, calm]);

  const s = steps[i];
  const mm = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss = String(secs % 60).padStart(2, "0");

  return (
    <div className="h-dvh flex flex-col bg-bg overflow-hidden">
      <NavBar active="/" />
      <div className="h-1.5 bg-line no-print" role="progressbar" aria-valuemin={1} aria-valuemax={path.length} aria-valuenow={pos + 1} aria-label="Story progress">
        <div className="h-full" style={{ width: `${((pos + 1) / path.length) * 100}%`, background: "linear-gradient(90deg,var(--ember),var(--amber))", transition: calm ? "none" : "width .4s" }} />
      </div>

      <main className="flex-1 min-h-0 relative">
        <AnimatePresence mode="wait" custom={dir}>
          <motion.section
            key={s.id}
            custom={dir}
            initial={calm ? false : { opacity: 0, x: 40 * dir }}
            animate={{ opacity: 1, x: 0 }}
            exit={calm ? { opacity: 0 } : { opacity: 0, x: -40 * dir }}
            transition={{ duration: calm ? 0 : 0.32, ease: "easeOut" }}
            className="absolute inset-0 overflow-y-auto"
            aria-labelledby="step-h"
          >
            <div className="min-h-full flex items-center px-[clamp(1.25rem,4vw,4.5rem)] py-5 [@media(max-height:820px)]:py-3">
              {s.full ? (
                <div className="w-full max-w-[1500px] mx-auto">{s.full}</div>
              ) : s.layout === "split" ? (
                <div className={`w-full max-w-[1600px] mx-auto grid gap-[clamp(1.5rem,3vw,3.5rem)]  items-center ${s.visualWide ? "lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]" : "lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"}`}>
                  <div>
                    <p className="kicker m-0 mb-3">{s.kicker}</p>
                    <h1 id="step-h" className="headline m-0">{s.headline}</h1>
                    {s.lede && <p className="lede mt-5 mb-0 max-w-[34ch] sm:max-w-[40ch]">{s.lede}</p>}
                  </div>
                  <div className="min-w-0 lg:h-[min(62dvh,640px)]">{s.visual}</div>
                </div>
              ) : (
                <div className="w-full max-w-[1600px] mx-auto grid gap-4 content-center">
                  <div>
                    <p className="kicker m-0 mb-2">{s.kicker}</p>
                    <h1 id="step-h" className="headline m-0 max-w-[44ch] !text-[clamp(2rem,2.6vw,3.25rem)]">{s.headline}</h1>
                  </div>
                  <div className="min-w-0">{s.visual}</div>
                </div>
              )}
            </div>
          </motion.section>
        </AnimatePresence>
      </main>

      <footer className="no-print flex items-center gap-3 px-5 py-2 border-t border-line bg-bg text-[1rem] text-ink2">
        <button className="btn" onClick={() => move(-1)} aria-label="Previous step" disabled={pos === 0}>&larr; Back</button>
        <button className="btn" onClick={() => move(1)} aria-label="Next step" disabled={pos === path.length - 1}>Next &rarr;</button>
        <span className="num font-bold text-ink text-[1.125rem]" aria-live="polite">Step {pos + 1} of {path.length}</span>
        <button className="btn" aria-pressed={short} onClick={() => setShort((v) => !v)} title="Switch between the 5-minute path and the full deep dive (key S)">{short ? "Show deep dive" : "Back to 5-minute path"}</button>
        <span className="ml-auto hidden xl:inline">Arrows, space or PageDown to move · P notes · F fullscreen · S deep dive on/off</span>
        <button className="btn" aria-pressed={notes} onClick={() => setNotes((n) => !n)}>Notes (P)</button>
      </footer>

      {notes && (
        <aside className="no-print fixed bottom-0 left-0 right-0 z-30 border-t-4 border-teal bg-surface p-5 shadow-2xl max-h-[46dvh] overflow-y-auto" role="complementary" aria-label="Speaker notes">
          <div className="max-w-[1500px] mx-auto grid gap-4 lg:grid-cols-[1fr_320px]">
            <div>
              <div className="kicker mb-1">Speaker notes · {s.kicker}</div>
              <p className="m-0 text-[1.25rem] leading-snug">{s.notes}</p>
            </div>
            <div className="text-[1.0625rem] text-ink2">
              <div className="num font-bold text-ink text-[1.75rem]" aria-label="Elapsed time">{mm}:{ss}</div>
              <div>Next: {steps[Math.min(steps.length - 1, i + 1)].kicker}</div>
              <button className="btn mt-2" onClick={() => setSecs(0)}>Reset timer</button>
            </div>
          </div>
        </aside>
      )}
    </div>
  );
}
