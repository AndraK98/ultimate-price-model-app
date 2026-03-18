"use client";

import { useState } from "react";

export function CopyErrorButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button className="button" type="button" onClick={handleCopy}>
      {copied ? "Copied" : "Copy error"}
    </button>
  );
}
