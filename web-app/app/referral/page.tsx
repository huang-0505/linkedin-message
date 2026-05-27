"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import ContactPanel from "@/components/ContactPanel";
import JobCard from "@/components/JobCard";
import TargetPersonCard from "@/components/TargetPersonCard";
import {
  inferJobTitleFromDescription,
  inferJobTitleFromUrl,
} from "@/lib/jobText";
import {
  deleteReferralContact,
  loadOutreachContext,
  loadReferralContacts,
  saveJobWithPlan,
  saveReferralContact,
  updateReferralContact,
} from "@/lib/storage";
import type {
  IncomingProfileContact,
  JobData,
  ReferralContact,
  ReferralPlan,
} from "@/lib/types";

const EMPTY_JOB: JobData = {
  jobTitle: "",
  company: "",
  location: "",
  jobUrl: "",
  jobDescription: "",
};

const GENERATE_TIMEOUT_MS = 5000;

export default function ReferralPage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
      <ReferralPageInner />
    </Suspense>
  );
}

function ReferralPageInner() {
  const params = useSearchParams();
  const [job, setJob] = useState<JobData>(EMPTY_JOB);
  const [plan, setPlan] = useState<ReferralPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [contacts, setContacts] = useState<ReferralContact[]>([]);

  // Read job from query params (preferred), then chrome.storage.local via a
  // bridge key in localStorage if the extension wrote there.
  useEffect(() => {
    const fromParams = readJobFromParams(params);
    if (fromParams) {
      setJob(fromParams);
      return;
    }
    if (params?.get("source") === "extension") {
      const bridged = readJobFromBridge();
      if (bridged) setJob(bridged);
    }
  }, [params]);

  useEffect(() => {
    setContacts(loadReferralContacts());

    const handleIncomingContact = (event: Event) => {
      const incoming =
        (event as CustomEvent<IncomingProfileContact>).detail ||
        readContactFromBridge();
      if (!incoming?.name || !incoming.profileUrl) return;

      const saved = saveReferralContact(incoming, loadOutreachContext());
      setContacts(loadReferralContacts());
      setWarning(`Added ${saved.name} to contacts.`);
    };

    window.addEventListener("lra:add-contact", handleIncomingContact);

    const bridged = readContactFromBridge();
    if (bridged) {
      const saved = saveReferralContact(bridged, loadOutreachContext());
      setContacts(loadReferralContacts());
      setWarning(`Added ${saved.name} to contacts.`);
    }

    return () => {
      window.removeEventListener("lra:add-contact", handleIncomingContact);
    };
  }, []);

  const canGenerate = useMemo(
    () => job.jobTitle.trim().length > 0 && job.company.trim().length > 0,
    [job],
  );

  async function generate() {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, GENERATE_TIMEOUT_MS);

    setLoading(true);
    setError(null);
    setWarning(null);
    setPlan(null);
    try {
      const res = await fetch("/api/generate-referral-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(job),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed: ${res.status}`);
      }
      const data = (await res.json()) as {
        plan: ReferralPlan;
      };
      setPlan(data.plan);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError(
          "Generation took too long. Restart the local web app and try again.",
        );
        return;
      }
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      window.clearTimeout(timeoutId);
      setLoading(false);
    }
  }

  function onSave() {
    if (!plan) return;
    const rec = saveJobWithPlan(job, plan);
    setSavedAt(rec.savedAt);
  }

  function onClear() {
    setJob(EMPTY_JOB);
    setPlan(null);
    setError(null);
    setWarning(null);
    setSavedAt(null);
  }

  function onUpdateContact(
    id: string,
    patch: Partial<Pick<ReferralContact, "notes" | "status">>,
  ) {
    setContacts(updateReferralContact(id, patch));
  }

  function onDeleteContact(id: string) {
    setContacts(deleteReferralContact(id));
  }

  return (
    <div className="space-y-5">
      <JobCard job={job} onChange={setJob} />

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-primary"
          onClick={generate}
          disabled={!canGenerate || loading}
        >
          {loading ? "Generating…" : "Generate Referral Plan"}
        </button>
        <button className="btn-secondary" onClick={onSave} disabled={!plan}>
          {savedAt ? "Saved ✓" : "Save Job"}
        </button>
        <button className="btn-ghost" onClick={onClear}>
          Clear
        </button>
      </div>

      {loading && (
        <p className="text-sm text-gray-600">
          Building a rule-based referral plan locally...
        </p>
      )}

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 text-red-800 p-3 text-sm">
          {error}
        </div>
      )}
      {warning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-800 p-3 text-sm">
          {warning}
        </div>
      )}

      <ContactPanel
        contacts={contacts}
        onUpdate={onUpdateContact}
        onDelete={onDeleteContact}
      />

      {plan && (
        <div className="space-y-4">
          <div className="card">
            <h2 className="text-lg font-semibold">Job summary</h2>
            <p className="text-gray-700 mt-1 whitespace-pre-wrap">
              {plan.jobSummary}
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plan.targetPeople.map((p, i) => (
              <TargetPersonCard key={`${p.category}-${i}`} person={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function readJobFromParams(
  params: URLSearchParams | ReturnType<typeof useSearchParams>,
): JobData | null {
  if (!params) return null;
  const jobTitle = params.get("jobTitle") || "";
  const company = params.get("company") || "";
  const jobDescription = params.get("jobDescription") || "";
  if (!jobTitle && !company) return null;
  return {
    jobTitle:
      jobTitle ||
      inferJobTitleFromDescription(jobDescription) ||
      inferJobTitleFromUrl(params.get("jobUrl") || ""),
    company,
    location: params.get("location") || "",
    jobUrl: params.get("jobUrl") || "",
    jobDescription,
  };
}

// The extension also writes job data to localStorage under this key as a
// bridge from chrome.storage.local (since web pages can't read chrome.storage
// directly). The extension sets this through an injected script when the user
// clicks "Find Referral".
const BRIDGE_KEY = "lra:incoming-job";
const CONTACT_BRIDGE_KEY = "lra:incoming-contact";

function readJobFromBridge(): JobData | null {
  try {
    const raw = window.localStorage.getItem(BRIDGE_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(BRIDGE_KEY);
    return normalizeIncomingJob(JSON.parse(raw) as JobData);
  } catch {
    return null;
  }
}

function normalizeIncomingJob(job: JobData): JobData {
  return {
    ...job,
    jobTitle:
      job.jobTitle ||
      inferJobTitleFromDescription(job.jobDescription || "") ||
      inferJobTitleFromUrl(job.jobUrl || ""),
  };
}

function readContactFromBridge(): IncomingProfileContact | null {
  try {
    const raw = window.localStorage.getItem(CONTACT_BRIDGE_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(CONTACT_BRIDGE_KEY);
    return JSON.parse(raw) as IncomingProfileContact;
  } catch {
    return null;
  }
}
