import { requireAccount } from './account-auth.ts';
import { requireReviewer } from './auth.ts';
import { createDistributionHandlers } from './distribution-handler-core.ts';
import { communities, distribution } from './distribution-runtime.ts';
import { getRuntimeConfig } from './runtime-config.ts';
import { requireStudent } from './student-auth.ts';

export const distributionHandlers = createDistributionHandlers({
  distribution, communities, student: requireStudent,
  operator: request => { requireReviewer(request); return getRuntimeConfig().mode === 'demo' ? 'demo-reviewer' : requireAccount(request, { role: 'OPERATOR', verified: true }).id; },
});
