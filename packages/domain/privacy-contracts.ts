/** Separate adult and synthetic teen workflows; neither asserts verified age or legal approval. */
export type AccountPrivacyConsentInput = { policyVersion: 'adult-account-v1'; adultConfirmed: true; personalization: boolean; aiExplanations?: boolean } | { policyVersion: 'teen-local-v1'; adultConfirmed: false; personalization: boolean; aiExplanations?: false };
export type StudentPrivacyState = {
  version: number;
  profileVersion: number | null;
  policyVersion: 'adult-account-v1' | 'teen-local-v1' | 'local-demo-v1' | null;
  storage: boolean;
  adultConfirmed: boolean;
  personalization: boolean;
  aiExplanations: boolean;
  updatedAt: string | null;
};
export type PrivacyUpdateInput = AccountPrivacyConsentInput & { expectedVersion: number; expectedProfileVersion: number };
