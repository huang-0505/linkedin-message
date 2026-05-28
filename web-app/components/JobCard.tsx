"use client";

import { analyzeSponsorship } from "@/lib/jobText";
import type { JobData, SponsorshipStatus } from "@/lib/types";

type Props = {
  job: JobData;
  onChange: (next: JobData) => void;
};

export default function JobCard({ job, onChange }: Props) {
  function updateDescription(description: string) {
    const sponsorship = analyzeSponsorship(description);
    onChange({
      ...job,
      jobDescription: description,
      sponsorshipStatus: sponsorship.status,
      sponsorshipEvidence: sponsorship.evidence,
    });
  }

  return (
    <div className="card space-y-3">
      <h2 className="text-lg font-semibold">Job</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Field
          label="Job title"
          value={job.jobTitle}
          onChange={(v) => onChange({ ...job, jobTitle: v })}
        />
        <Field
          label="Company"
          value={job.company}
          onChange={(v) => onChange({ ...job, company: v })}
        />
        <Field
          label="Location"
          value={job.location ?? ""}
          onChange={(v) => onChange({ ...job, location: v })}
        />
        <Field
          label="Job URL"
          value={job.jobUrl ?? ""}
          onChange={(v) => onChange({ ...job, jobUrl: v })}
        />
        <SponsorshipSelect
          value={job.sponsorshipStatus ?? "unknown"}
          onChange={(v) => onChange({ ...job, sponsorshipStatus: v })}
        />
        <Field
          label="Sponsorship evidence"
          value={job.sponsorshipEvidence ?? ""}
          onChange={(v) => onChange({ ...job, sponsorshipEvidence: v })}
        />
      </div>

      <div>
        <label className="text-sm font-medium text-gray-700">
          Job description
        </label>
        <textarea
          className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm min-h-[140px]"
          value={job.jobDescription ?? ""}
          onChange={(e) => updateDescription(e.target.value)}
          placeholder="Paste or edit the job description text..."
        />
      </div>
    </div>
  );
}

function SponsorshipSelect({
  value,
  onChange,
}: {
  value: SponsorshipStatus;
  onChange: (v: SponsorshipStatus) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">
        Visa sponsorship
      </label>
      <select
        className="mt-1 w-full rounded-md border border-gray-300 bg-white p-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value as SponsorshipStatus)}
      >
        <option value="unknown">Unknown</option>
        <option value="sponsors">Sponsors</option>
        <option value="no_sponsorship">Does not sponsor</option>
      </select>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <input
        className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
