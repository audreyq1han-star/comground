import Link from 'next/link';
import { notFound } from 'next/navigation';
import { activities } from '../../../components/preview-model';
import { CommunityScene } from '../../../components/CommunityScene';
import { ExampleFacts, RequirementResult, SampleAgeControl } from '../../../components/ExampleRequirements';
import { ShortlistAction } from '../../../components/ShortlistAction';

export const dynamicParams = false;
export function generateStaticParams() { return activities.map(activity => ({ slug: activity.id })); }
type DetailProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: DetailProps) {
  const { slug } = await params;
  const activity = activities.find(item => item.id === slug);
  return { title: activity ? `${activity.title} · Fictional example` : 'Example not found' };
}

export default async function ExampleDetailPage({ params }: DetailProps) {
  const { slug } = await params;
  const activity = activities.find(item => item.id === slug);
  if (!activity) notFound();
  return <div className="page-wrap detail-page"><Link href="/explore" className="text-link back-link"><span aria-hidden="true">←</span> Back to examples</Link><div className="detail-layout">
    <div className="detail-main"><header className="page-intro"><p className="eyebrow">Fictional example · {activity.category}</p><h1>{activity.title}</h1><p className="page-lead">{activity.description}</p><p className="preview-note">An invented activity to explore. No booking or application is available.</p></header><figure className="detail-image"><CommunityScene scene={activity.id} crop="wide" /><figcaption>{activity.caption}</figcaption></figure></div>
    <aside className="detail-aside" aria-label="Example requirements and shortlist"><p className="eyebrow">The practical details</p><ExampleFacts activity={activity} detailed /><SampleAgeControl /><RequirementResult activity={activity} /><ShortlistAction activity={activity} /></aside>
    <div className="detail-narrative"><section className="detail-section"><h2>What you’d do</h2><p>{activity.work}</p></section><section className="detail-section"><h2>Why this might interest you</h2><p>{activity.reason}</p></section><section className="detail-section"><h2>Questions to ask</h2><ul className="question-list">{activity.questions.map(question => <li key={question}>{question}</li>)}</ul><Link href="/how-it-works#checklist" className="text-link">Read the full checklist <span aria-hidden="true">↗</span></Link></section></div>
  </div></div>;
}
