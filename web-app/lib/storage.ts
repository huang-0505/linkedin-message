// Tiny localStorage helpers. Everything is client-side only.

import type {
  IncomingProfileContact,
  JobData,
  OutreachContext,
  ReferralContact,
  ReferralPlan,
  SavedJob,
} from "./types";

const SAVED_JOBS_KEY = "lra:saved-jobs";
const CONTACTS_KEY = "lra:referral-contacts";
const OUTREACH_CONTEXT_KEY = "lra:active-outreach-context";

export function loadSavedJobs(): SavedJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedJob[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveJobWithPlan(job: JobData, plan: ReferralPlan): SavedJob {
  const all = loadSavedJobs();
  const record: SavedJob = {
    id: cryptoRandomId(),
    savedAt: Date.now(),
    job,
    plan,
  };
  const next = [record, ...all].slice(0, 100); // cap to avoid bloating storage
  window.localStorage.setItem(SAVED_JOBS_KEY, JSON.stringify(next));
  return record;
}

export function deleteSavedJob(id: string): void {
  const next = loadSavedJobs().filter((j) => j.id !== id);
  window.localStorage.setItem(SAVED_JOBS_KEY, JSON.stringify(next));
}

export function clearSavedJobs(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SAVED_JOBS_KEY);
}

export function rememberOutreachContext(context: OutreachContext): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(OUTREACH_CONTEXT_KEY, JSON.stringify(context));
}

export function loadOutreachContext(): OutreachContext | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(OUTREACH_CONTEXT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as OutreachContext;
  } catch {
    return null;
  }
}

export function loadReferralContacts(): ReferralContact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CONTACTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ReferralContact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveReferralContact(
  incoming: IncomingProfileContact,
  context: OutreachContext | null,
): ReferralContact {
  const all = loadReferralContacts();
  const existing = all.find(
    (contact) => normalizeUrl(contact.profileUrl) === normalizeUrl(incoming.profileUrl),
  );
  const record: ReferralContact = {
    id: existing?.id || cryptoRandomId(),
    addedAt: existing?.addedAt || Date.now(),
    name: incoming.name,
    headline: incoming.headline,
    location: incoming.location,
    connectionDegree: incoming.connectionDegree,
    profileUrl: incoming.profileUrl,
    activityText: incoming.activityText,
    category: context?.category || existing?.category,
    connectionMessage: context?.connectionMessage || existing?.connectionMessage,
    notes: existing?.notes || "",
    status: existing?.status || "shortlisted",
  };
  const next = [record, ...all.filter((contact) => contact.id !== record.id)].slice(
    0,
    200,
  );
  window.localStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
  return record;
}

export function updateReferralContact(
  id: string,
  patch: Partial<Pick<ReferralContact, "notes" | "status">>,
): ReferralContact[] {
  const next = loadReferralContacts().map((contact) =>
    contact.id === id ? { ...contact, ...patch } : contact,
  );
  window.localStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
  return next;
}

export function deleteReferralContact(id: string): ReferralContact[] {
  const next = loadReferralContacts().filter((contact) => contact.id !== id);
  window.localStorage.setItem(CONTACTS_KEY, JSON.stringify(next));
  return next;
}

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "").trim().toLowerCase();
}

function cryptoRandomId(): string {
  // Use crypto.randomUUID where available, fall back to timestamp.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
