// apps/worker/src/jobs/index.ts
// Registar poslova. `JobRegistry` je `Record<JobType, JobHandler>`, pa dodavanje
// novog tipa u `packages/shared/src/db.ts` obara build sve dok se ovde ne doda
// handler — tip iz baze i kod ne mogu tiho da se raziđu.

import type { JobRegistry } from "./types";
import { runEnrichBasic } from "./enrich-basic";
import { runEnrichFull } from "./enrich-full";
import { runMonthlyGrant } from "./monthly-grant";
import { runRefreshGoogle } from "./refresh-google";
import { runScan } from "./scan";

export const HANDLERS: JobRegistry = {
  scan: runScan,
  enrich_basic: runEnrichBasic,
  enrich_full: runEnrichFull,
  refresh_google: runRefreshGoogle,
  monthly_grant: runMonthlyGrant,
};

export type { JobContext, JobHandler, JobResult } from "./types";
