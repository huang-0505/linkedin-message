// Server-side route. Returns a deterministic rule-based ReferralPlan.

import { NextResponse } from "next/server";
import { cleanJobTitle } from "@/lib/jobText";
import { buildRulePlan } from "@/lib/rulePlan";
import type { GenerateReferralPlanRequest } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: GenerateReferralPlanRequest;
  try {
    body = (await request.json()) as GenerateReferralPlanRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body?.jobTitle || !body?.company) {
    return NextResponse.json(
      { error: "jobTitle and company are required." },
      { status: 400 },
    );
  }

  body = {
    ...body,
    jobTitle: cleanJobTitle(body.jobTitle),
  };

  return NextResponse.json({ plan: buildRulePlan(body) }, { status: 200 });
}
