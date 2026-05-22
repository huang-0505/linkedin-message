import type { ReferralContact } from "./types";

export type ContactPriority = {
  label: "High" | "Medium" | "Low";
  score: number;
  reasons: string[];
};

export function scoreReferralContact(contact: ReferralContact): ContactPriority {
  let score = 45;
  const reasons: string[] = [];
  const text = [
    contact.name,
    contact.headline,
    contact.location,
    contact.connectionDegree,
    contact.category,
    contact.notes,
    contact.activityText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const hasNoRecentActivity = hasAny(text, ["has no recent posts", "no recent posts"]);

  if (hasAny(text, ["2nd", "mutual connection", "mutual"])) {
    score += 15;
    reasons.push("warmer connection signal");
  }

  if (hasAny(text, ["same-role", "same role", "forward deployed", "fde"])) {
    score += 14;
    reasons.push("strong role match");
  }

  if (hasAny(text, ["recruiter", "talent acquisition", "sourcer"])) {
    score += 12;
    reasons.push("recruiting contact");
  }

  if (hasAny(text, ["manager", "lead", "head of", "director"])) {
    score += 8;
    reasons.push("possible hiring influence");
  }

  if (hasAny(text, ["brown", "alumni", "university"])) {
    score += 8;
    reasons.push("shared background hook");
  }

  if (
    !hasNoRecentActivity &&
    hasAny(text, ["posted", "commented", "activity", "recent"])
  ) {
    score += 10;
    reasons.push("visible recent activity");
  }

  if (hasNoRecentActivity) {
    score -= 10;
    reasons.push("low visible activity");
  }

  if (hasAny(text, ["3rd+", "3rd"])) {
    score -= 8;
    reasons.push("colder connection");
  }

  if (hasAny(text, ["message"])) {
    score += 4;
    reasons.push("message path visible");
  }

  score = Math.max(0, Math.min(100, score));

  if (reasons.length === 0) {
    reasons.push("limited visible profile signals");
  }

  return {
    label: score >= 70 ? "High" : score >= 45 ? "Medium" : "Low",
    score,
    reasons: reasons.slice(0, 3),
  };
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle));
}
