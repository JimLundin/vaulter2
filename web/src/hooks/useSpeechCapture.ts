import { useCallback, useEffect, useRef, useState } from "react";

const GAP_MS = 1500; // flush after this much silence — i.e. on a speech pause
const MIN_CHUNK_CHARS = 60; // coalesce sub-thought fragments below this length

type AudioMeter = { stream: MediaStream; ctx: AudioContext; analyser: AnalyserNode };

export type SpeechCapture = {
  /** Web Speech API is available (Chrome/Edge). When false, use submitTyped. */
  supported: boolean;
  recording: boolean;
  /** Live, not-yet-filed transcript to show prominently under the mic. */
  interim: string;
  error: string | null;
  toggle: () => void;
  /** Typed fallback: file one note as its own single-Capture session. */
  submitTyped: (text: string) => void;
  /** Live mic analyser while recording (null otherwise) — drives the waveform. */
  analyser: AnalyserNode | null;
};

/** Send a chunk to the Runtime under the current recording's id (the Runtime
 * uses a change in id to detect a new recording / possible new topic). */
async function postCapture(recordingId: string, transcript: string) {
  await fetch("/capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recordingId, transcript }),
  });
}

export function useSpeechCapture(): SpeechCapture {
  const SR =
    typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;
  const supported = !!SR;

  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  // Mutable bits the recognition callbacks read/write between renders.
  const recRef = useRef<SpeechRecognition | null>(null);
  const recordingRef = useRef(false); // the user's intent to be recording
  const pendingFinalRef = useRef(""); // finalized transcript not yet sent
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One recording = one recordingId. A null id means the next send starts a
  // fresh Vaulter "new recording" (so the agent can tell a new topic from a
  // continuation); postCapture lazily mints one.
  const recordingIdRef = useRef<string | null>(null);
  const audioRef = useRef<AudioMeter | null>(null);

  const send = useCallback((transcript: string) => {
    const text = transcript.trim();
    if (!text) return;
    if (!recordingIdRef.current) {
      recordingIdRef.current = `${performance.now().toFixed(0)}-${Math.round(Math.random() * 1e6)}`;
    }
    void postCapture(recordingIdRef.current, text);
  }, []);

  // --- Live mic level (separate from Web Speech, which exposes no audio) ---
  const startMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.78;
      ctx.createMediaStreamSource(stream).connect(analyserNode);
      audioRef.current = { stream, ctx, analyser: analyserNode };
      setAnalyser(analyserNode);
    } catch {
      // No meter (permission/another consumer) — recording still works.
      setAnalyser(null);
    }
  }, []);

  const stopMeter = useCallback(() => {
    const a = audioRef.current;
    audioRef.current = null;
    setAnalyser(null);
    if (!a) return;
    a.stream.getTracks().forEach((t) => t.stop());
    void a.ctx.close();
  }, []);

  useEffect(() => {
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US"; // transcribe in English
    recRef.current = rec;

    const armGap = () => {
      if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
      gapTimerRef.current = setTimeout(flush, GAP_MS);
    };

    // Flush on a pause — but only once the buffer has grown to a thought-sized
    // chunk. A shorter fragment stays buffered and coalesces with the next pause.
    const flush = () => {
      const chunk = pendingFinalRef.current.trim();
      if (chunk.length < MIN_CHUNK_CHARS) return;
      pendingFinalRef.current = "";
      setInterim("");
      send(chunk);
    };

    // On stop: send the tail (however small). An empty tail sends nothing — the
    // recording boundary is carried by the next recording minting a fresh id.
    const flushFinal = () => {
      if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
      const chunk = pendingFinalRef.current.trim();
      pendingFinalRef.current = "";
      setInterim("");
      if (chunk) send(chunk);
    };

    rec.onstart = () => setRecording(true);

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) pendingFinalRef.current += r[0].transcript;
        else live += r[0].transcript;
      }
      setInterim((pendingFinalRef.current + " " + live).trim());
      armGap(); // (re)start the silence countdown; flush only on a real pause
    };

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      if (e.error !== "no-speech") setError("Mic error: " + e.error);
    };

    rec.onend = () => {
      if (recordingRef.current) {
        // Browser ended the session (silence/timeout) but the user is still
        // recording — restart so streaming continues uninterrupted.
        try {
          rec.start();
        } catch {
          /* already starting */
        }
        return;
      }
      // Stopped by the user: flush the tail, close the session, reset.
      flushFinal();
      stopMeter();
      setRecording(false);
    };

    return () => {
      recordingRef.current = false;
      if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
      try {
        rec.abort();
      } catch {
        /* not started */
      }
      stopMeter();
    };
  }, [SR, send, stopMeter]);

  const toggle = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    if (!recordingRef.current) {
      recordingRef.current = true;
      recordingIdRef.current = null; // a fresh recording → a fresh Vaulter session
      pendingFinalRef.current = "";
      setInterim("");
      setError(null);
      void startMeter();
      rec.start();
    } else {
      recordingRef.current = false;
      rec.stop(); // onend flushes the remainder and clears the timer
    }
  }, [startMeter]);

  const submitTyped = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      recordingIdRef.current = null; // each typed note is its own one-Capture session
      send(text);
    },
    [send],
  );

  return { supported, recording, interim, error, toggle, submitTyped, analyser };
}
