/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { logger } from "../logger.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id for this request — echoed in every failure envelope. */
      id?: string;
      /** Schema-parsed request parts, populated by validate() (src/server/middleware/validate.ts). */
      valid?: { body?: any; query?: any; params?: any };
    }
  }
}

/**
 * Why this file exists.
 *
 * Every route used to end in `catch (e) { res.status(500).json({ success:false,
 * error: e.message }) }`. Three problems, all of them real:
 *
 *  1. It relayed raw internal messages (SQLite constraint text, provider error
 *     bodies, file paths) to whoever called the API.
 *  2. It produced a DIFFERENT envelope from the AI routes, which already used
 *     `{success:false, error:{code, message}}` — and the client only ever knew how
 *     to read the object form (src/config/apiClient.ts reads `error.message` /
 *     `error.code`). So a 400 from any `/api/db/*` route surfaced in the UI as the
 *     generic "Server returned error code: HTTP 400" and the actual reason was
 *     silently dropped.
 *  3. Anything thrown OUTSIDE a handler's try — or in a handler that had none —
 *     became an unhandled rejection instead of a response.
 *
 * So: one envelope, one place that decides status codes, and a correlation id the
 * client already sends (`X-Request-Id`) but nobody was reading.
 */

/** An error that carries its own HTTP status and stable machine-readable code. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, "ERR_INVALID_INPUT", message, details);
export const unauthorized = (message: string) =>
  new ApiError(401, "ERR_UNAUTHORIZED", message);
export const forbidden = (message: string) =>
  new ApiError(403, "ERR_FORBIDDEN", message);
export const notFound = (message: string) =>
  new ApiError(404, "ERR_NOT_FOUND", message);

/**
 * The single failure envelope. Matches ApiResponse in src/types/apiContracts.ts —
 * which was already the declared contract, just not what half the routes emitted.
 */
export function fail(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  const req = res.req as Request | undefined;
  const error: Record<string, unknown> = { code, message };
  if (details !== undefined) error.details = details;
  return res.status(status).json({
    success: false,
    error,
    metadata: {
      timestamp: new Date().toISOString(),
      requestId: req?.id ?? null,
    },
  });
}

/**
 * Correlation id. The client already generates one per request and sends it as
 * `X-Request-Id` (src/config/apiClient.ts) — honor it so a UI-side report and a
 * server log line can be matched, and mint one when it's absent. The inbound
 * value is pattern-checked before being echoed back: it lands in a response
 * header, so it must not carry arbitrary caller-controlled content.
 */
export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  req.id = incoming && /^[A-Za-z0-9._:-]{1,80}$/.test(incoming) ? incoming : `req_${randomUUID()}`;
  res.setHeader("X-Request-Id", req.id);
  next();
}

/**
 * Forwards a rejected async handler to the error middleware. Express 4 does not
 * await handlers, so without this an `await` that throws outside a try/catch is
 * an unhandled rejection and the caller just hangs until its own timeout.
 */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 404 for unmatched API paths. Mount after the routers and BEFORE the Vite/static
 * middleware: otherwise a typo'd endpoint is answered by the SPA fallback with
 * `200 text/html`, and the caller parses an HTML page as its JSON payload.
 */
export function apiNotFound(req: Request, res: Response) {
  return fail(res, 404, "ERR_NOT_FOUND", `No API route matches ${req.method} ${req.originalUrl.split("?")[0]}`);
}

/** Flattens a ZodError into a stable, client-renderable details array. */
function zodDetails(err: ZodError) {
  return err.issues.map((issue) => ({
    path: issue.path.map(String).join(".") || "(root)",
    code: issue.code,
    message: issue.message,
  }));
}

/**
 * Terminal error middleware. Must be registered LAST, after every router and
 * after the static/Vite middleware.
 */
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    // The response already went out (e.g. a stream that failed mid-flight);
    // there is no envelope left to send, so just make it visible in the log.
    logger.error(
      { err, requestId: req.id, method: req.method, path: req.originalUrl },
      "Request failed after headers were sent"
    );
    return next(err);
  }

  if (err instanceof ZodError) {
    const details = zodDetails(err);
    const first = details[0];
    return fail(
      res,
      400,
      "ERR_VALIDATION",
      first ? `${first.path}: ${first.message}` : "Request payload failed validation",
      details
    );
  }

  if (err instanceof ApiError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }

  // express.json() failures. These arrive as generic errors with a `type`, and
  // used to fall through to a 500 — a malformed JSON body is the caller's fault.
  if (err?.type === "entity.parse.failed") {
    return fail(res, 400, "ERR_MALFORMED_JSON", "Request body is not valid JSON.");
  }
  if (err?.type === "entity.too.large") {
    return fail(res, 413, "ERR_PAYLOAD_TOO_LARGE", "Request body exceeds the configured size limit.");
  }

  // Anything else is a server-side defect. Log it in full (with the correlation
  // id so a user-reported failure can be found), return nothing internal.
  logger.error(
    { err, requestId: req.id, method: req.method, path: req.originalUrl },
    "Unhandled error in request handler"
  );
  return fail(
    res,
    500,
    "ERR_INTERNAL",
    "The server failed to complete this request. Reference the request id when reporting it."
  );
}
