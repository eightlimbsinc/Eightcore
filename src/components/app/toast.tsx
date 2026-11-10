"use client";
import { useEffect, useState } from "react";

const EVENT = "eightcore:toast";

/** A short notice at the bottom of the screen ("Link copied"). */
export function notify(message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export function Toaster() {
  const [message, setMessage] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onToast = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      setMessage({ text, id: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setMessage(null), 2200);
    };
    window.addEventListener(EVENT, onToast);
    return () => {
      window.removeEventListener(EVENT, onToast);
      clearTimeout(timer);
    };
  }, []);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center"
    >
      {message ? (
        <span
          key={message.id}
          role="status"
          className="bg-foreground text-background rounded-full px-4 py-2 text-[13px] font-medium shadow-lg"
        >
          {message.text}
        </span>
      ) : null}
    </div>
  );
}
