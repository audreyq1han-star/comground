import { ExploreExamples } from '../../components/ExploreExamples';

export const metadata = { title: 'Explore examples' };
export default function ExplorePage() {
  return <div className="page-wrap"><header className="page-intro"><p className="eyebrow">Three fictional activities</p><h1>What catches your interest?</h1><p className="page-lead">Explore an outdoor project, a team task, or something you can do from home.</p><p className="preview-note">Fictional activities. No bookings or applications.</p></header><ExploreExamples /></div>;
}
