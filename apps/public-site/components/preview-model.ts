export type ExampleAge = '13–15' | '14–15' | '16–17' | '18+';
export type ActivityId = 'garden' | 'pantry' | 'reading';
export const activities = [
  {
    id: 'garden', title: 'Community garden morning', category: 'Environment', location: 'In person', minimumAge: 16, duration: 'Two hours', guardian: false,
    description: 'Help prepare planting beds and organize materials for a community garden.',
    work: 'Work through practical garden tasks, such as getting planting beds ready and sorting tools and materials.',
    reason: 'You’re curious about the environment and enjoy work you can see taking shape.',
    check: 'Confirm the date, location, access needs, and organizer’s latest requirements.',
    questions: ['Where and when would the activity take place?', 'What should I wear or bring?', 'Who will explain the tasks and supervise the work?', 'Are the tasks and site suitable for my access needs?'],
    caption: 'An example of hands-on work outdoors.',
  },
  {
    id: 'pantry', title: 'Food pantry packing', category: 'Community', location: 'In person', minimumAge: 14, duration: 'Three hours', guardian: true,
    description: 'Sort supplies and prepare packs with a community food team.',
    work: 'Help organize supplies and assemble packs as part of a team.',
    reason: 'You like practical tasks and working alongside other people.',
    check: 'Ask how the guardian requirement works and confirm the date and organizer’s instructions.',
    questions: ['Does a guardian need to attend, or is another arrangement required?', 'What tasks are suitable for my age?', 'Is lifting involved, and what help is available?', 'What instructions or training would I receive before starting?'],
    caption: 'An example of working together on a practical task.',
  },
  {
    id: 'reading', title: 'Remote reading preparation', category: 'Education', location: 'Remote', minimumAge: 16, duration: 'Two hours', guardian: false,
    description: 'Help prepare reading materials for an education project, from home.',
    work: 'Help organize and prepare reading materials for the example project. This example does not describe direct tutoring or contact with children.',
    reason: 'You enjoy reading and want to explore a task you can do remotely.',
    check: 'Confirm the work, timing, supervision arrangements, and organizer’s contact details.',
    questions: ['What would I produce, and how would I know it is finished?', 'When is the work due, and is there a fixed meeting time?', 'Who would explain the task and review the work?', 'What equipment or software would I need?'],
    caption: 'An example of contributing from home.',
  },
] as const;
export type ExampleActivity = typeof activities[number];
export type ActivityCategory = 'All activities' | ExampleActivity['category'];
export type ActivityFormat = 'Any format' | ExampleActivity['location'];

export function filterActivities(category: ActivityCategory, format: ActivityFormat) {
  return activities.filter(activity => (category === 'All activities' || activity.category === category) && (format === 'Any format' || activity.location === format));
}

export function compareExampleAge(age: ExampleAge, minimumAge: number, guardian: boolean) {
  const lowerBound = { '13–15': 13, '14–15': 14, '16–17': 16, '18+': 18 }[age];
  if (lowerBound < minimumAge) return { kind: 'outside', title: 'This sample includes ages below the minimum.', explanation: `This example starts at age ${minimumAge}. The full ${age} sample range includes an age below that minimum.` } as const;
  if (guardian) return { kind: 'check', title: 'The age range fits. A guardian is also required.', explanation: 'Meeting the age requirement does not settle the guardian requirement. In a real activity, ask the organizer how that arrangement works.' } as const;
  return { kind: 'fits', title: 'This sample meets the age requirement.', explanation: `This example starts at age ${minimumAge}. The full ${age} sample range is within that requirement. Other details still need checking.` } as const;
}
