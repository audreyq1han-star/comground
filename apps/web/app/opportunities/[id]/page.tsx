import { OpportunityDetail } from '../../../components/OpportunityDetail';
export const metadata = { title: 'Opportunity details' };
export default async function OpportunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpportunityDetail id={id} />;
}
