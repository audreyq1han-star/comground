import type { SafetyTargetInput } from '../../../../packages/domain/safety-contracts.ts';
import { SafetyReports } from '../../components/student/SafetyReports';
export const metadata = { title: 'Safety and private reports' };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  const query = await searchParams;
  const initialTarget: SafetyTargetInput | null = typeof query.opportunityId === 'string' && typeof query.occurrenceId === 'string' && query.opportunityId.length <= 160 && query.occurrenceId.length <= 80 ? { kind: 'LISTING', opportunityId: query.opportunityId, occurrenceId: query.occurrenceId } : null;
  return <SafetyReports initialTarget={initialTarget}/>;
}
