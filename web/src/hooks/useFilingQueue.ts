import { useCallback, useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

/**
 * The capture queue in front of `useChat`.
 *
 * Vaulter files one capture at a time so its turns never race over the Vault. We
 * get that for free by serializing on the CLIENT: spoken/typed captures land in a
 * FIFO, and we hand the next one to `useChat` only when the previous turn has
 * finished (status back to `ready`). `useChat` owns the conversation + streaming;
 * the backend `/api/chat` runs one filing turn per send and commits the Vault.
 *
 * The waiting captures are React state (not a ref) so the UI can show the queue.
 */
export function useFilingQueue() {
  const { messages, sendMessage, status, error, stop } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });

  const [queued, setQueued] = useState<string[]>([]);
  // True between a send and the turn returning to `ready`, so the drain effect
  // can't fire a second capture before `status` reflects the in-flight one.
  const busy = useRef(false);

  useEffect(() => {
    if (status === "ready") busy.current = false;
    if (status === "ready" && !busy.current && queued.length > 0) {
      busy.current = true;
      const [next, ...rest] = queued;
      setQueued(rest);
      sendMessage({ text: next });
    }
  }, [status, queued, sendMessage]);

  const enqueue = useCallback((text: string) => {
    const t = text.trim();
    if (t) setQueued((q) => [...q, t]);
  }, []);

  return { messages, status, error, stop, enqueue, queued };
}
