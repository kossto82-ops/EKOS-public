/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ZodType } from "zod";

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
}

/**
 * Schema validation at the edge.
 *
 * `zod` was already a dependency and already held the shapes the UI validates
 * against (src/schemas/validation.ts) — but not one server route used it. All
 * 2.2k lines of handlers hand-rolled their own `typeof x !== "string"` ladders,
 * which meant: inconsistent messages, gaps (POST /governance/ai-config accepted
 * literally any JSON and stored it as the live provider config), and crashes
 * dressed up as 500s (`configVal.apiKey.trim()` on a numeric apiKey).
 *
 * Parsed output lands on `req.valid` and, for the body, is also written back to
 * `req.body` so that defaults/coercions apply to existing reads. A parse failure
 * is thrown to the central error handler, which renders it as one
 * `ERR_VALIDATION` envelope with per-field details.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const valid: { body?: unknown; query?: unknown } = {};
      if (schemas.query) valid.query = schemas.query.parse(req.query);
      if (schemas.body) {
        // `?? {}` so a request that sent no body at all is reported as the
        // specific missing/invalid field, not as "expected object, got undefined".
        valid.body = schemas.body.parse(req.body ?? {});
        req.body = valid.body;
      }
      req.valid = { ...(req.valid ?? {}), ...valid };
      next();
    } catch (err) {
      next(err);
    }
  };
}
