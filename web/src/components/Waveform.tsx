import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const BARS = 48;

/** A live frequency-bar visualizer driven by the mic AnalyserNode. When there's
 * no analyser (not recording) it rests as a quiet baseline. Canvas + rAF so it
 * stays smooth without re-rendering React. */
export function Waveform({ analyser, className }: { analyser: AnalyserNode | null; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const analyserRef = useRef(analyser);
  analyserRef.current = analyser;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    // Smoothed bar heights (0..1) so silence eases down instead of snapping.
    const heights = new Array(BARS).fill(0);

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--record").trim() || "#ff5d5d";
    const idle = getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#242a36";

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);

      const a = analyserRef.current;
      let targets: number[];
      if (a) {
        const data = new Uint8Array(a.frequencyBinCount);
        a.getByteFrequencyData(data);
        // Map the lower ~3/4 of the spectrum (where voice lives) onto the bars.
        const usable = Math.floor(data.length * 0.72);
        targets = new Array(BARS);
        for (let i = 0; i < BARS; i++) {
          const start = Math.floor((i / BARS) * usable);
          const end = Math.max(start + 1, Math.floor(((i + 1) / BARS) * usable));
          let sum = 0;
          for (let j = start; j < end; j++) sum += data[j];
          targets[i] = Math.min(1, sum / (end - start) / 200);
        }
      } else {
        targets = new Array(BARS).fill(0);
      }

      const mid = height / 2;
      const gap = 3;
      const barW = (width - gap * (BARS - 1)) / BARS;
      for (let i = 0; i < BARS; i++) {
        heights[i] += (targets[i] - heights[i]) * 0.35; // ease toward target
        const h = Math.max(2, heights[i] * (height - 6));
        const x = i * (barW + gap);
        ctx.fillStyle = a ? accent : idle;
        ctx.globalAlpha = a ? 0.55 + heights[i] * 0.45 : 0.5;
        const r = Math.min(barW / 2, 2);
        roundRect(ctx, x, mid - h / 2, barW, h, r);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={cn("h-16 w-full", className)} aria-hidden="true" />;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
