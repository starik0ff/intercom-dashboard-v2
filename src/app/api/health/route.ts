// Lightweight liveness probe — no auth, safe for load balancer / nginx.
// Only checks that DB opens and required env vars are present.
// Returns HTTP 200 when healthy, 503 when not.

import {
  checkDatabase,
  checkEnv,
  overallStatus,
  type CheckResult,
} from '@/lib/health';

export const dynamic = 'force-dynamic';

export async function GET() {
  const checks: CheckResult[] = [await checkDatabase(), await checkEnv()];
  const status = overallStatus(checks);
  return Response.json(
    {
      status,
      now: Math.floor(Date.now() / 1000),
      checks,
    },
    { status: status === 'fail' ? 503 : 200 },
  );
}
