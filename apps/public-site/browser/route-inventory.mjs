// Public routes come from the approved content/design packet. Their existence
// and rendered controls are verified against the candidate before acceptance.
export const publicRoutes = [
  '/', '/explore/', '/explore/garden/', '/explore/pantry/',
  '/explore/reading/', '/shortlist/', '/how-it-works/', '/for-families/',
];

// Explicit read-only probes, separate from observed journey network requests.
// No real account, record ID, data payload or application operation is used.
export const excludedRoutes = [
  '/dashboard/', '/onboarding/', '/profile/', '/opportunities/',
  '/opportunities/public-review-no-record/', '/matches/', '/saved/',
  '/activity/', '/alerts/', '/settings/alerts/', '/digest/', '/evidence/',
  '/safety/', '/communities/public-review-no-record/', '/account/',
  '/account/signup/', '/account/login/', '/account/recover/',
  '/account/reset/', '/account/verify/', '/account/password/',
  '/account/sessions/', '/account/privacy/', '/account/notifications/',
  '/account/youth-review/', '/account/reviews/', '/admin/',
  '/admin/reports/', '/admin/opportunities/', '/api/', '/api/health/',
  '/api/runtime/', '/api/opportunities/', '/api/matches/',
  '/api/student/session/', '/api/student/profile/', '/api/student/saves/',
  '/api/student/activity/', '/api/student/evidence/', '/api/account/session/',
  '/api/account/register/', '/api/admin/session/', '/api/admin/overview/',
];
