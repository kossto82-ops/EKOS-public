/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ApiResponse } from '../types/apiContracts';
import { getApiBaseUrl, getAuthMode, API_TIMEOUT_MS, RETRY_ATTEMPTS, BACKOFF_FACTOR, INITIAL_DELAY_MS } from './envConfig';

interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Helper to simulate delay / sleep for exponential backoff
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Generates a unique request trace ID
 */
const generateRequestId = (prefix: string): string => 
  `req_${prefix}_${Math.random().toString(36).substring(2, 11)}`;

/**
 * Enterprise API Client with robust security policies, timeout protection,
 * automatic retries for idempotent requests, and standard error envelope mapping.
 */
class ApiClient {
  private baseUrl: string;
  private timeoutMs: number;

  constructor() {
    this.baseUrl = getApiBaseUrl();
    this.timeoutMs = API_TIMEOUT_MS;
  }

  /**
   * Helper to construct complete URLs, handling base formatting elegantly
   */
  private buildUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    
    return this.baseUrl ? `${this.baseUrl}${cleanPath}` : cleanPath;
  }

  /**
   * Safe fetch runner executing request with timeout, authorization injects, and error mapping
   */
  private async executeRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    options: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    const requestId = generateRequestId(method.toLowerCase());
    const url = this.buildUrl(path);
    const timeout = options.timeoutMs ?? this.timeoutMs;
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Dynamic headers assembly
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
      ...options.headers,
    };

    // In legacy mode the caller identity is the unsigned user id in the
    // Authorization header. In oauth mode the credential is the httpOnly session
    // cookie (sent via credentials:'include' below) — the SPA has no token to
    // attach, so we must NOT send a Bearer header.
    if (getAuthMode() === 'legacy') {
      try {
        const token = localStorage.getItem('auth_token');
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      } catch {
        // Storage access blocked or unavailable in some sandbox contexts
      }
    }

    const config: RequestInit = {
      method,
      headers,
      signal: controller.signal,
      // Send the session cookie on same-origin (and CORS-allowed) requests. The
      // backend sets credentials:true; harmless in legacy mode.
      credentials: 'include',
    };

    if (body !== undefined) {
      config.body = JSON.stringify(body);
    }

    try {
      let response: Response;
      try {
        response = await fetch(url, config);
      } catch (fetchErr: unknown) {
        throw fetchErr;
      }

      clearTimeout(timeoutId);

      // Handle unauthorized / forbidden states securely.
      // 401 means the identity itself is missing/unrecognized (see
      // src/server/middleware/auth.ts's requireUser) — the stored token is
      // genuinely bad, so drop it. 403 means the identity IS valid but this
      // particular action/tab isn't permitted for that role (requireTab /
      // requireAction) — a completely normal, expected outcome for a
      // lower-privileged user, not a sign the session is broken. Clearing
      // the token on 403 was wiping identity for every subsequent request
      // in the session after the very first permission-denied response.
      if (response.status === 401) {
        try {
          localStorage.removeItem('auth_token');
        } catch {}

        // In oauth mode a 401 means no valid session — hand the browser to the
        // corporate login (which the backend 302s onward to the auth server).
        // Guarded to oauth so legacy/demo never navigates away on a 401. The
        // path is a top-level navigation, not an XHR, so the redirect chain and
        // Set-Cookie work as a normal browser flow.
        if (typeof window !== 'undefined' && getAuthMode() === 'oauth') {
          const loginUrl = this.buildUrl('/auth/login');
          if (!window.location.pathname.startsWith('/auth/')) {
            window.location.href = loginUrl;
          }
        }
      }

      if (response.status === 401 || response.status === 403) {
        return {
          success: false,
          data: null as unknown as T,
          error: {
            code: 'ERR_UNAUTHORIZED',
            message: `Session invalid or insufficient permissions (HTTP ${response.status})`
          },
          metadata: { timestamp: new Date().toISOString(), requestId }
        };
      }

      if (!response.ok) {
        let errorMsg = `Server returned error code: HTTP ${response.status}`;
        let errorCode = `ERR_HTTP_${response.status}`;
        try {
          const errJson = await response.json();
          if (errJson && errJson.error) {
            errorMsg = errJson.error.message || errorMsg;
            errorCode = errJson.error.code || errorCode;
          }
        } catch {
          // If not JSON or failed to parse, use default
        }
        return {
          success: false,
          data: null as unknown as T,
          error: {
            code: errorCode as any,
            message: errorMsg
          },
          metadata: { timestamp: new Date().toISOString(), requestId }
        };
      }

      // Parse JSON payload securely
      const json = await response.json();
      
      // If the backend already returns a standard ApiResponse envelope, return it directly
      if (json && typeof json === 'object' && 'success' in json) {
        return json as ApiResponse<T>;
      }

      // Otherwise, wrap the parsed payload in our consistent envelope
      return {
        success: true,
        data: json as T,
        metadata: {
          timestamp: new Date().toISOString(),
          requestId
        }
      };

    } catch (error: unknown) {
      clearTimeout(timeoutId);
      
      const isAbort = error instanceof Error && error.name === 'AbortError';
      const errorMessage = isAbort 
        ? `Request timed out after ${timeout}ms` 
        : (error instanceof Error ? error.message : 'Unknown network failure occurred');

      return {
        success: false,
        data: null as unknown as T,
        error: {
          code: isAbort ? 'ERR_TIMEOUT' : 'ERR_NETWORK_FAILURE',
          message: errorMessage
        },
        metadata: {
          timestamp: new Date().toISOString(),
          requestId
        }
      };
    }
  }

  /**
   * Executes HTTP GET with optional automatic exponential backoff retries
   */
  async get<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    const maxRetries = options.retries ?? RETRY_ATTEMPTS;
    let delay = INITIAL_DELAY_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await this.executeRequest<T>('GET', path, undefined, options);
      
      if (response.success) {
        return response;
      }

      // Don't retry on user-error authorization states
      if (response.error?.code === 'ERR_UNAUTHORIZED' || attempt === maxRetries) {
        return response;
      }

      // Wait before next retry using exponential backoff
      await sleep(delay);
      delay *= BACKOFF_FACTOR;
    }

    return {
      success: false,
      data: null as unknown as T,
      error: {
        code: 'ERR_MAX_RETRIES_EXCEEDED',
        message: `Idempotent GET request failed after ${maxRetries} re-attempts`
      },
      metadata: {
        timestamp: new Date().toISOString(),
        requestId: generateRequestId('get_failed')
      }
    };
  }

  /**
   * Executes HTTP POST - Non-idempotent: Strictly NEVER re-attempted automatically
   */
  async post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.executeRequest<T>('POST', path, body, options);
  }

  /**
   * Executes HTTP PUT - Strictly single attempt execution
   */
  async put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.executeRequest<T>('PUT', path, body, options);
  }

  /**
   * Executes HTTP PATCH - Non-idempotent partial update: single attempt only
   */
  async patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.executeRequest<T>('PATCH', path, body, options);
  }

  /**
   * Executes HTTP DELETE - Strictly single attempt execution
   */
  async delete<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
    return this.executeRequest<T>('DELETE', path, undefined, options);
  }
}

export const apiClient = new ApiClient();
