/**
 * Custom error classes for the Inji Certify integration layer.
 * Used by certifyService.js internally and consumed by downstream
 * tasks (Task 10 PDF service, Task 13 wallet delivery) to catch
 * and handle specific failure types without losing error context.
 */

export class CertifyNetworkError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'CertifyNetworkError';
    this.details = details;
    this.isRetryable = true;
  }
}

export class CertifyAuthError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'CertifyAuthError';
    this.details = details;
    this.isRetryable = false;
  }
}

export class CertifyValidationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'CertifyValidationError';
    this.details = details;
    this.isRetryable = false;
  }
}

export class CertifyRevocationError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'CertifyRevocationError';
    this.details = details;
    this.isRetryable = true;
  }
}
