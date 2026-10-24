import { NextResponse } from "next/server";

import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/** True/false when the database answers; null when it cannot be asked (never fails the health check itself). */
async function columnReady(table: string, column: string): Promise<boolean | null> {
  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const { error } = await createServiceClient().from(table).select(column).limit(0);
    if (!error) return true;
    return /does not exist|schema cache|not found/i.test(error.message) ? false : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const [threads, payroll] = await Promise.all([columnReady("activities", "audience"), columnReady("payroll_periods", "units_frozen_at")]);
  return NextResponse.json({
    ok: true,
    supabase: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    maps: Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    // Release migrations present in the database this deploy talks to (true / false / null = could not tell).
    schema: { threads, payrollAtomicApprove: payroll },
  });
}
