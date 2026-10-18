import { RepositoryError } from './errors.ts';

export const distributionFail = (code: string, status: number, message: string): never => { throw new RepositoryError(code, status, message); };
export function distributionVersion(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) return distributionFail('INVALID_INPUT', 422, 'Provide the current version.');
  return value as number;
}
export function plainDistributionCopy(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || value.trim().length < 3 || value.trim().length > maximum || /[<>\x00-\x08\x0b-\x1f\x7f]|https?:\/\/|www\.|\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(value)) return distributionFail('INVALID_INPUT', 422, `Use plain synthetic copy between 3 and ${maximum} characters, without links, addresses or markup.`);
  return value.trim();
}
export function communitySlug(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) || value.length < 3 || value.length > 60 || ['admin','api','account','digest','onboarding','profile','login'].includes(value)) return distributionFail('INVALID_SLUG', 422, 'Use a public slug of 3–60 lowercase letters, numbers and single hyphens.');
  return value;
}
export function distributionActor(value: string): string {
  if (!/^(demo-reviewer|account-[a-f0-9-]{36})$/.test(value)) return distributionFail('INVALID_ACTOR', 403, 'An authenticated operator must make this decision.');
  return value;
}
export function distributionPagination(offset = 0, limit = 20): { offset: number; limit: number } {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) return distributionFail('INVALID_QUERY', 400, 'Use a nonnegative offset and a limit between 1 and 50.');
  return { offset, limit };
}
