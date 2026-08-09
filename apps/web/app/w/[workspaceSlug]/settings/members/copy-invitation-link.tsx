"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyInvitationLink({ invitationId }: { invitationId: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}/invitations/${invitationId}`;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2_000);
  }

  return (
    <button className="button min-h-8 px-2.5 text-xs" onClick={copy} type="button">
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Copié" : "Copier le lien"}
    </button>
  );
}
