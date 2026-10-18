import { ExampleShortlist } from '../../components/ExampleShortlist';

export const metadata = { title: 'Example shortlist' };
export default function ShortlistPage() {
  return <div className="page-wrap"><header className="page-intro"><p className="eyebrow">Compare a few possibilities</p><h1>Your example shortlist</h1><p className="page-lead">Look at the time, format, and requirements side by side. Then decide which questions you would ask first.</p><p className="preview-note">Fictional activities only. This list stays as you browse these pages and clears when you reload. Nothing is booked or sent.</p></header><ExampleShortlist /></div>;
}
