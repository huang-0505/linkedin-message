"use client";

import { scoreReferralContact } from "@/lib/contactScoring";
import type { ReferralContact, ReferralContactStatus } from "@/lib/types";

type Props = {
  contacts: ReferralContact[];
  onDelete: (id: string) => void;
  onUpdate: (
    id: string,
    patch: Partial<Pick<ReferralContact, "notes" | "status">>,
  ) => void;
};

const STATUS_LABELS: Array<{ value: ReferralContactStatus; label: string }> = [
  { value: "shortlisted", label: "Shortlisted" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
  { value: "follow_up", label: "Follow up" },
  { value: "skip", label: "Skip" },
];

export default function ContactPanel({ contacts, onDelete, onUpdate }: Props) {
  if (contacts.length === 0) return null;

  return (
    <section className="card space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Contacts picked</h2>
        <span className="text-sm text-gray-500">{contacts.length}</span>
      </div>

      <div className="space-y-3">
        {contacts.map((contact) => (
          <ContactRow
            key={contact.id}
            contact={contact}
            onDelete={onDelete}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </section>
  );
}

function ContactRow({
  contact,
  onDelete,
  onUpdate,
}: {
  contact: ReferralContact;
  onDelete: (id: string) => void;
  onUpdate: Props["onUpdate"];
}) {
  const note = contact.connectionMessage || "";
  const priority = scoreReferralContact(contact);

  return (
    <div className="rounded-md border border-gray-200 p-3 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{contact.name}</h3>
            <span className={priorityClassName(priority.label)}>
              {priority.label} priority · {priority.score}
            </span>
          </div>
          {contact.headline && (
            <p className="text-sm text-gray-700">{contact.headline}</p>
          )}
          <div className="text-xs text-gray-500 mt-1">
            {[contact.location, contact.connectionDegree, contact.category]
              .filter(Boolean)
              .join(" • ")}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <a
            href={contact.profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-xs"
          >
            Open profile
          </a>
          <button
            className="btn-secondary text-xs"
            onClick={() => copyTextToClipboard(note)}
            disabled={!note}
          >
            Copy note
          </button>
          <button className="btn-ghost text-xs" onClick={() => onDelete(contact.id)}>
            Delete
          </button>
        </div>
      </div>

      <div className="rounded-md bg-gray-50 border border-gray-200 p-2">
        <div className="text-xs font-medium text-gray-700">
          Response likelihood signals
        </div>
        <div className="text-xs text-gray-600 mt-1">
          {priority.reasons.join(" • ")}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-3">
        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-700 mb-1">
            Status
          </span>
          <select
            className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm"
            value={contact.status}
            onChange={(event) =>
              onUpdate(contact.id, {
                status: event.target.value as ReferralContactStatus,
              })
            }
          >
            {STATUS_LABELS.map((status) => (
              <option key={status.value} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-xs font-medium text-gray-700 mb-1">
            Notes
          </span>
          <input
            className="w-full rounded-md border border-gray-300 p-2 text-sm"
            value={contact.notes || ""}
            onChange={(event) =>
              onUpdate(contact.id, { notes: event.target.value })
            }
            placeholder="Add context before reaching out..."
          />
        </label>
      </div>
    </div>
  );
}

function priorityClassName(label: "High" | "Medium" | "Low"): string {
  const base = "rounded-full px-2 py-1 text-xs font-medium";
  if (label === "High") return `${base} bg-green-50 text-green-700`;
  if (label === "Medium") return `${base} bg-amber-50 text-amber-700`;
  return `${base} bg-gray-100 text-gray-700`;
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (!text) return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    // Fall back below.
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  document.body.appendChild(textArea);
  textArea.select();
  document.execCommand("copy");
  document.body.removeChild(textArea);
}
