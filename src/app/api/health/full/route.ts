// Detailed health check — auth required. Runs every check including a live
// Intercom API probe (opt-out with ?probe=0). Returns per-check status and
// an overall status suitable for an admin UI.

import { NextRequest } from 'next/server';
import {
  checkBootstrap,
  checkDatabase,
  checkEnv,
  checkFts,
  checkIncremental,
  checkIntercomApi,
  checkSyncErrors,
  checkTables,
  checkUsersFile,
  checkWorkerProcess,
  overallStatus,
  type CheckResult,
} from '@/lib/health';
import { requireUser, authErrorResponse } from '@/lib/auth-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    await requireUser();
  } catch (e) {
    const r = authErrorResponse(e);
    if (r) return r;
    throw e;
  }

  const probe = req.nextUrl.searchParams.get('probe') !== '0';

  // Run cheap local checks concurrently. Intercom probe is optional and
  // sequential because it makes a real HTTPS call.
  const localChecks = await Promise.all([
    checkDatabase(),
    checkTables(),
    checkFts(),
    checkBootstrap(),
    checkWorkerProcess(),
    checkIncremental(),
    checkSyncErrors(),
    checkEnv(),
    checkUsersFile(),
  ]);
  const checks: CheckResult[] = [...localChecks];
  if (probe) checks.push(await checkIntercomApi());

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
