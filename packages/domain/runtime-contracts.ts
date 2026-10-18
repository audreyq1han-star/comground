export type RuntimeMode = 'demo' | 'test' | 'production';
export type RuntimeCapabilities = {
  mode: RuntimeMode;
  capabilities: { demoPersonas: boolean; accounts: boolean; emailDelivery: boolean; aiExplanations: boolean; realFeeds: false; syntheticYouth: boolean; teenEnrollment: false };
  admissionPolicy: 'TEEN_AND_ADULT_LOCAL_REVIEW_PENDING_POLICY';
  catalogue: 'SYNTHETIC_DEMO' | 'EMPTY_PENDING_FEEDS';
};
