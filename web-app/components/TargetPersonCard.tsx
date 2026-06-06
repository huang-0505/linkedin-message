"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildLinkedInPeopleSearchUrl,
  normalizeLinkedInPeopleSearchQuery,
  removeLinkedInLocationFromQuery,
} from "@/lib/linkedin";
import { rememberOutreachContext } from "@/lib/storage";
import type { TargetPerson } from "@/lib/types";

export default function TargetPersonCard({ person }: { person: TargetPerson }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => editablePerson(person));

  useEffect(() => {
    setDraft(editablePerson(person));
  }, [person]);

  const linkedinSearchUrl = useMemo(
    () =>
      buildLinkedInPeopleSearchUrl(draft.searchQuery, {
        currentCompanyId: person.currentCompanyId,
      }),
    [draft.searchQuery, person.currentCompanyId],
  );

  async function copy(label: string, text: string) {
    setCopyFailed(null);

    const didCopy = await copyTextToClipboard(text);
    if (didCopy) {
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
      return;
    }

    setCopyFailed(label);
    setTimeout(() => setCopyFailed(null), 2000);
  }

  async function openSearchWithNote() {
    const context = {
      category: person.category,
      searchQuery: normalizeLinkedInPeopleSearchQuery(draft.searchQuery),
      connectionMessage: draft.connectionMessage,
    };

    rememberOutreachContext(context);
    broadcastOutreachContext(context);

    const copyPromise = copy("connection", draft.connectionMessage);
    window.open(linkedinSearchUrl, "_blank", "noopener,noreferrer");
    await copyPromise;
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{person.category}</h3>
          <p className="text-sm text-gray-600 mt-1">{person.whyRelevant}</p>
        </div>
        <button
          type="button"
          onClick={openSearchWithNote}
          className="btn-primary shrink-0"
        >
          Copy Outreach + Search
        </button>
      </div>

      <div className="text-xs text-gray-500">
        <label className="block">
          <span className="block font-medium text-gray-700 mb-1">
            LinkedIn search query
          </span>
          {person.currentCompanyName && (
            <span className="mb-2 inline-flex rounded-full bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700">
              Current company: {person.currentCompanyName}
            </span>
          )}
          <input
            className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs text-gray-800"
            value={draft.searchQuery}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                searchQuery: normalizeLinkedInPeopleSearchQuery(event.target.value),
              }))
            }
          />
        </label>
      </div>

      <MessageBlock
        label={`Cold outreach (${draft.connectionMessage.length} chars)`}
        text={draft.connectionMessage}
        onChange={(text) =>
          setDraft((current) => ({ ...current, connectionMessage: text }))
        }
        onCopy={() => copy("connection", draft.connectionMessage)}
        copied={copied === "connection"}
        copyFailed={copyFailed === "connection"}
      />
    </div>
  );
}

function editablePerson(person: TargetPerson) {
  return {
    searchQuery: removeLinkedInLocationFromQuery(
      person.searchQuery,
      person.searchLocation,
    ),
    connectionMessage: person.connectionMessage,
  };
}

function broadcastOutreachContext(context: {
  category: string;
  searchQuery: string;
  connectionMessage: string;
}) {
  window.postMessage(
    {
      type: "LRA_REMEMBER_OUTREACH_CONTEXT",
      context,
    },
    window.location.origin,
  );
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall back below for browsers or extension contexts that block this API.
  }

  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.setAttribute("readonly", "");
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    document.body.appendChild(textArea);
    textArea.select();
    const didCopy = document.execCommand("copy");
    document.body.removeChild(textArea);
    return didCopy;
  } catch {
    return false;
  }
}

function MessageBlock({
  label,
  text,
  onChange,
  onCopy,
  copied,
  copyFailed,
}: {
  label: string;
  text: string;
  onChange: (text: string) => void;
  onCopy: () => void;
  copied: boolean;
  copyFailed: boolean;
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-700">{label}</span>
        <button onClick={onCopy} className="btn-secondary text-xs">
          {copied ? "Copied!" : copyFailed ? "Copy failed" : "Copy"}
        </button>
      </div>
      <textarea
        className="mt-2 min-h-[88px] w-full resize-y rounded-md border border-gray-300 bg-white p-2 text-sm text-gray-800"
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
