// Shared types used across the app, the API route, and (in mirrored form) the
// Chrome extension. Kept intentionally small and readable.

export type JobData = {
  jobTitle: string;
  company: string;
  location?: string;
  jobUrl?: string;
  jobDescription?: string;
  sponsorshipStatus?: SponsorshipStatus;
  sponsorshipEvidence?: string;
};

export type SponsorshipStatus = "sponsors" | "no_sponsorship" | "unknown";

export type SponsorshipAnalysis = {
  status: SponsorshipStatus;
  evidence: string;
};

export type TargetPerson = {
  category: string;
  whyRelevant: string;
  searchQuery: string;
  linkedinSearchUrl: string;
  connectionMessage: string;
  followUpMessage: string;
  referralAskMessage: string;
};

export type ReferralPlan = {
  jobSummary: string;
  targetPeople: TargetPerson[];
};

export type ReferralContactStatus =
  | "shortlisted"
  | "contacted"
  | "replied"
  | "follow_up"
  | "skip";

export type ReferralContact = {
  id: string;
  addedAt: number;
  name: string;
  headline?: string;
  location?: string;
  connectionDegree?: string;
  profileUrl: string;
  category?: string;
  connectionMessage?: string;
  activityText?: string;
  notes?: string;
  status: ReferralContactStatus;
};

export type IncomingProfileContact = {
  name: string;
  headline?: string;
  location?: string;
  connectionDegree?: string;
  activityText?: string;
  profileUrl: string;
};

export type OutreachContext = {
  category: string;
  searchQuery: string;
  connectionMessage: string;
};

export type GenerateReferralPlanRequest = JobData;

// Stored in localStorage so /history can browse old plans.
export type SavedJob = {
  id: string;
  savedAt: number; // ms epoch
  job: JobData;
  plan: ReferralPlan;
};
