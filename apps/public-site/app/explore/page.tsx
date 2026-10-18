import { ExploreExamples } from '../../components/ExploreExamples';

export const metadata = { title: 'Explore examples' };
export default function ExplorePage() {
  return <div className="page-wrap"><header className="page-intro"><p className="eyebrow">Three fictional activities</p><h1>What catches your interest?</h1><p className="page-lead">Try an outdoor project, a practical team task, or something you can do from home. Open an example to see the work and the questions that come with it.</p><p className="preview-note">These activities are made up for the preview. They cannot be booked.</p></header><ExploreExamples /></div>;
}
