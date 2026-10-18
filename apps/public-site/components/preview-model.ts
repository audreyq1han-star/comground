export type ExampleAge = '13–15' | '14–15' | '16–17' | '18+';
export type ActivityId = 'garden' | 'pantry' | 'reading';
export const activities = [
  { id: 'garden', title: 'Community garden morning', category: 'Environment', location: 'In person', minimumAge: 16, duration: 'Two hours', guardian: false, description: 'Help prepare planting beds and organize garden materials in a community setting.', reason: 'For someone curious about outdoor work and local environmental projects.', check: 'Confirm the date, location, access needs, and organizer’s latest requirements.' },
  { id: 'pantry', title: 'Food pantry packing', category: 'Community', location: 'In person', minimumAge: 14, duration: 'Three hours', guardian: true, description: 'Sort supplies and prepare packs alongside a community food team.', reason: 'For someone interested in practical community service and working with others.', check: 'Ask how the guardian requirement works and confirm the date and organizer’s instructions.' },
  { id: 'reading', title: 'Remote reading preparation', category: 'Education', location: 'Remote', minimumAge: 16, duration: 'Two hours', guardian: false, description: 'Help prepare reading materials for an example education project.', reason: 'For someone interested in reading, education, and a remote activity.', check: 'Confirm the work, timing, supervision arrangements, and organizer’s contact details.' },
] as const;
export function compareExampleAge(age: ExampleAge, minimumAge: number, guardian: boolean) {
  const lowerBound = { '13–15': 13, '14–15': 14, '16–17': 16, '18+': 18 }[age];
  if (lowerBound < minimumAge) return { kind: 'outside', title: 'Outside this example age range', explanation: `This example starts at age ${minimumAge}. The full ${age} range includes an age below that minimum.` } as const;
  if (guardian) return { kind: 'check', title: 'Check a requirement', explanation: 'The example age range fits. A guardian is required for this example; confirm the arrangement before a real application.' } as const;
  return { kind: 'fits', title: 'Example age range fits', explanation: `This example accepts ages ${minimumAge} and over. The selected age range fits. Other details still need checking.` } as const;
}
