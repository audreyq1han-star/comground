const REPOSITORY_ERROR = Symbol.for('comground.RepositoryError');
export class RepositoryError extends Error {
  readonly [REPOSITORY_ERROR] = true;
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'RepositoryError';
    this.code = code;
    this.status = status;
  }
}

/** Next development routes may retain a repository from a different module instance. */
export function isRepositoryError(error: unknown): error is RepositoryError {
  return error instanceof Error && (error as RepositoryError)[REPOSITORY_ERROR] === true;
}
