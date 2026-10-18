import Link from 'next/link';
import { GridPattern } from '../../components/magicui/grid-pattern';

export const metadata = { title: 'How it works' };
const steps = [
  ['Find an idea.', 'Browse by the kind of work or how you’d take part. Outdoors, with a team, or from home is enough of a starting point.'],
  ['Look at the requirements.', 'Interest alone does not tell you whether an activity will work. Check the age requirement, time commitment, location, and any guardian or training requirements.'],
  ['Keep a small shortlist.', 'Compare the details of a few examples. You can remove an idea or look at another one without making a commitment.'],
  ['Ask before making a plan.', 'For a real activity, confirm the current details with the organizer. If you need school recognition, speak to your school before taking part.'],
];
const checklist = [
  ['The activity', 'What will I actually do? Who can answer my questions?'],
  ['The requirements', 'Does the activity accept my age? Is training, permission, or a guardian required?'],
  ['The practical plan', 'When and where is it? Can I get there and back? Are there costs or equipment to arrange?'],
  ['Support and access', 'Who will supervise? What support or adjustments can the organizer provide?'],
  ['School recognition', 'If I need service hours or credit, what does my school require before I start?'],
  ['The current details', 'Is the activity still available, and have any requirements changed?'],
];
const questions = [
  ['Can I join from this preview?', 'No. The activities are fictional, and there are no applications or account signups here.'],
  ['Is this matching me with an opportunity?', 'You can try fixed sample age ranges and see a requirement check. This preview does not create a profile, use AI, or make a full eligibility decision.'],
  ['Will an activity count for service hours or credit?', 'Your school decides what it recognizes. A shortlist or requirement check does not guarantee either.'],
  ['What happens to my choices?', 'The sample choices and shortlist stay while you move between these pages. Reloading clears them. There is no account or email signup.'],
];

export default function HowItWorksPage() {
  return <div className="page-wrap reading-page"><header className="page-intro"><p className="eyebrow">A few useful steps</p><h1>Interest first.<br />Details next.</h1><p className="page-lead">You don’t need to know your future plans to explore volunteering. Start with something you’d like to try, then look at what taking part would involve.</p><p className="preview-note">This preview uses fictional activities so you can try the process without an account.</p></header>
    <div className="process-steps">{steps.map(([title, body], index) => <section key={title} className="guidance-section"><span className="step-number">0{index + 1}</span><div><h2>{title}</h2><p>{body}</p>{index === 1 && <p className="requirement-note">A 14+ activity does not fit every age in a 13–15 sample. A guardian requirement is a separate question, even when the age range fits.</p>}</div></section>)}</div>
    <section className="checklist-section" id="checklist" aria-labelledby="checklist-title"><GridPattern width={36} height={36} squares={[[2, 1], [12, 5]]} /><p className="eyebrow">Before you apply to a real activity</p><h2 id="checklist-title">Questions worth asking</h2><p>Use these questions to start a conversation with the organizer, your school, or someone helping you plan.</p><ol className="checklist">{checklist.map(([title, body]) => <li key={title}><h3>{title}</h3><p>{body}</p></li>)}</ol></section>
    <section className="guidance-section faq-section" aria-labelledby="questions-title"><div><p className="eyebrow">About this preview</p><h2 id="questions-title">A few more answers.</h2></div><div className="faq-list">{questions.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div></section>
    <div className="guide-action"><Link href="/explore" className="primary-link">Try it with the examples <span aria-hidden="true">↗</span></Link><Link href="/for-families" className="text-link">Read the family guide <span aria-hidden="true">↗</span></Link></div>
  </div>;
}
