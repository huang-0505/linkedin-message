"use client";

import { useEffect, useState } from "react";
import TargetPersonCard from "@/components/TargetPersonCard";
import {
  clearSavedJobs,
  deleteSavedJob,
  loadSavedJobs,
} from "@/lib/storage";
import type { SavedJob } from "@/lib/types";

export default function HistoryPage() {
  const [jobs, setJobs] = useState<SavedJob[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setJobs(loadSavedJobs());
  }, []);

  function onDelete(id: string) {
    deleteSavedJob(id);
    setJobs(loadSavedJobs());
    if (openId === id) setOpenId(null);
  }

  function onClearAll() {
    if (!confirm("Clear all saved jobs and plans?")) return;
    clearSavedJobs();
    setJobs([]);
    setOpenId(null);
  }

  if (jobs.length === 0) {
    return (
      <div className="card">
        <h1 className="text-lg font-semibold mb-2">History</h1>
        <p className="text-gray-600 text-sm">
          No saved jobs yet. Generate a referral plan on the{" "}
          <a className="text-brand underline" href="/referral">
            /referral
          </a>{" "}
          page and click <strong>Save Job</strong>.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">History ({jobs.length})</h1>
        <button className="btn-secondary" onClick={onClearAll}>
          Clear all
        </button>
      </div>

      <div className="space-y-3">
        {jobs.map((j) => {
          const isOpen = openId === j.id;
          return (
            <div key={j.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-semibold">
                    {j.job.jobTitle} — {j.job.company}
                  </div>
                  <div className="text-xs text-gray-500">
                    Saved {new Date(j.savedAt).toLocaleString()}
                    {j.job.location ? ` • ${j.job.location}` : ""}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost"
                    onClick={() => setOpenId(isOpen ? null : j.id)}
                  >
                    {isOpen ? "Hide" : "View plan"}
                  </button>
                  <button className="btn-ghost" onClick={() => onDelete(j.id)}>
                    Delete
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">
                    {j.plan.jobSummary}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {j.plan.targetPeople.map((p, i) => (
                      <TargetPersonCard key={`${j.id}-${i}`} person={p} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
