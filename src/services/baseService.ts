/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standard structured API Error interface matching exact specs
 */
export interface ApiError {
  code: 'NETWORK_ERROR' | 'TIMEOUT' | 'VALIDATION' | 'SERVER_ERROR' | 'UNKNOWN';
  message: string;      // User-friendly legible message
  details?: string;     // Technical details for diagnostics
  timestamp: string;    // ISO 8601
  requestId: string;
}

/**
 * Generic response state containing loading, error, and data attributes
 */
export interface ResponseState<T> {
  data: T | null;
  isLoading: boolean;
  error: ApiError | null;
  retries?: number;
}

/**
 * Custom Error classes to distinguish different error scenarios clearly
 */
export class NetworkError extends Error {
  constructor(message: string, public details?: string) {
    super(message);
    this.name = 'NetworkError';
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public details?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ServerError extends Error {
  constructor(message: string, public details?: string) {
    super(message);
    this.name = 'ServerError';
  }
}

/**
 * Maps arbitrary JavaScript/TypeScript exceptions into a standard user-friendly ApiError payload
 */
export function mapToApiError(error: unknown, requestId?: string): ApiError {
  const finalRequestId = requestId || `err_gen_${Math.random().toString(36).substring(2, 11)}`;
  const timestamp = new Date().toISOString();

  if (error instanceof ValidationError) {
    return {
      code: 'VALIDATION',
      message: error.message || 'Validation failed. Please verify your input parameters.',
      details: error.details,
      timestamp,
      requestId: finalRequestId,
    };
  }

  if (error instanceof TimeoutError) {
    return {
      code: 'TIMEOUT',
      message: error.message || 'Search took too long, please try again.',
      timestamp,
      requestId: finalRequestId,
    };
  }

  if (error instanceof NetworkError) {
    return {
      code: 'NETWORK_ERROR',
      message: error.message || 'Unable to fetch data. Please check your network connection and try again.',
      details: error.details,
      timestamp,
      requestId: finalRequestId,
    };
  }

  if (error instanceof ServerError) {
    return {
      code: 'SERVER_ERROR',
      message: error.message || 'The server encountered an unexpected error. Please try again later.',
      details: error.details,
      timestamp,
      requestId: finalRequestId,
    };
  }

  // Handle errors which already have standard ApiError attributes
  const anyErr = error as any;
  if (anyErr && anyErr.code && anyErr.message) {
    return {
      code: anyErr.code,
      message: anyErr.message,
      details: anyErr.details || anyErr.message,
      timestamp: anyErr.timestamp || timestamp,
      requestId: anyErr.requestId || finalRequestId,
    };
  }

  const defaultMsg = error instanceof Error ? error.message : 'An unknown exception occurred.';
  return {
    code: 'UNKNOWN',
    message: 'Couldn\'t fetch results. Please try again.',
    details: defaultMsg,
    timestamp,
    requestId: finalRequestId,
  };
}

/**
 * Helper to execute a promise with a timeout constraint
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number = 30000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`Request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then(res => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch(err => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Utility executing a standard retrieval promise while outputting a fully qualified ResponseState
 */
export async function withLoadingState<T>(
  action: () => Promise<T>,
  requestId?: string
): Promise<ResponseState<T>> {
  try {
    const data = await action();
    return {
      data,
      isLoading: false,
      error: null,
      retries: 0
    };
  } catch (error: unknown) {
    return {
      data: null,
      isLoading: false,
      error: mapToApiError(error, requestId),
      retries: 0
    };
  }
}

/**
 * Standard exponential backoff sleeping helper
 */
export const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Robust retry runner supporting up to 3 total attempts (2 retries) with 1s, 2s, 4s exponential backoff
 */
export async function executeWithRetry<T>(
  action: () => Promise<T>,
  maxRetries: number = 2,
  isIdempotent: boolean = true
): Promise<{ data: T; retries: number }> {
  if (!isIdempotent) {
    const res = await action();
    return { data: res, retries: 0 };
  }

  const backoffs = [1000, 2000, 4000];
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await action();
      return { data: res, retries: attempt };
    } catch (err: unknown) {
      if (attempt === maxRetries) {
        throw err;
      }
      
      const delay = backoffs[attempt] || 1000;
      await sleep(delay);
    }
  }

  throw new Error('Unreachable retry block finished without outcome.');
}
