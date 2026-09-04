export class FinanceDomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'FinanceDomainError';
  }
}

export function isFinanceDomainError(error: unknown): error is FinanceDomainError {
  return error instanceof FinanceDomainError;
}
