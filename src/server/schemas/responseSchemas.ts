/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

/**
 * What each route actually returns.
 *
 * Request payloads were schematized first (apiSchemas.ts); responses were not, and
 * that is the half a caller depends on. `tests/api.test.ts` was 179 lines against
 * ~2.2k lines of handlers, and what it checked was mostly `toHaveProperty` — so a
 * field could change type, a nullable column could start arriving as `null` where
 * the client expected a string, or a route could stop returning `data` entirely,
 * and nothing would fail.
 *
 * These are deliberately **loose** objects: they pin the fields callers actually
 * read and let extra columns through. Over-specifying a DB row means every new
 * column breaks the tests for no reason; under-specifying means the contract is
 * decoration. The line drawn here is "what the client would crash without".
 *
 * They are also the source for the OpenAPI document (src/server/openapi.ts), so a
 * response shape is described in exactly one place.
 */

/** Success envelope: `{ success: true, data }`. */
export const ok = <T extends z.ZodType>(data: T) =>
  z.object({ success: z.literal(true), data });

/** Routes that only acknowledge, with no payload. */
export const okEmpty = z.looseObject({ success: z.literal(true) });

/**
 * The single failure envelope every route now shares
 * (src/server/middleware/errors.ts). `details` is present only on ERR_VALIDATION.
 */
export const failureEnvelope = z.looseObject({
  success: z.literal(false),
  error: z.looseObject({
    code: z.string(),
    message: z.string(),
    details: z
      .array(z.looseObject({ path: z.string(), code: z.string(), message: z.string() }))
      .optional(),
  }),
  metadata: z
    .looseObject({ timestamp: z.string(), requestId: z.string().nullable() })
    .optional(),
});

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * A document as the API returns it. `departmentIds` is asserted as an array
 * because the column stores JSON text and every response must parse it back —
 * shipping the raw string crashes the client's `.map`/`.includes` (a defect this
 * codebase has already had).
 */
export const documentRow = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.string(),
  scope: z.string(),
  brandId: z.string().nullish(),
  departmentIds: z.array(z.string()),
  approvalStatus: z.string().nullish(),
  version: z.string().nullish(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/** A knowledge source. Config keys are spread onto the row, hence loose. */
export const sourceRow = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  status: z.enum(["healthy", "syncing", "warning", "error"]),
  lastUpdate: z.string(),
  // Asserted because the UI renders it as a date: it used to be absent and every
  // row showed "Invalid Date".
  lastSync: z.string(),
  recordCount: z.number(),
});

/** A brand. teamIds/pricingPlans are JSON-text columns parsed back into arrays. */
export const brandRow = z.looseObject({
  id: z.string(),
  displayName: z.string(),
  shortCode: z.string(),
  vatRate: z.number().nullish(),
  teamIds: z.array(z.string()),
  pricingPlans: z.array(z.unknown()),
  isActive: z.boolean(),
});

export const syncLogRow = z.looseObject({
  id: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  type: z.string(),
  recordsProcessed: z.number(),
  duration: z.string(),
  status: z.string(),
  endTime: z.string(),
});

export const searchGapRow = z.looseObject({
  id: z.string(),
  query: z.string(),
  timestamp: z.string(),
  hasResults: z.boolean(),
  dominantSource: z.string(),
  escalated: z.boolean(),
  confidence: z.string(),
  resolved: z.boolean(),
});

export const reviewTaskRow = z.looseObject({
  id: z.string(),
  status: z.string(),
});

/**
 * A generated answer. Every field is asserted non-optional on purpose: the route
 * normalizes the model's JSON precisely because a missing field rendered as
 * "undefined%" confidence and "Invalid Date" in the UI.
 */
export const knowledgeAnswer = z.looseObject({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  content: z.string(),
  confidenceScore: z.number(),
  sources: z.array(
    z.looseObject({
      id: z.string(),
      name: z.string(),
      snippet: z.string().optional(),
      score: z.number().optional(),
    })
  ),
  status: z.string(),
  answerType: z.string(),
  businessDomain: z.string(),
  lastUpdated: z.string(),
  reviewOwner: z.string(),
});

// ---------------------------------------------------------------------------
// Per-route responses
// ---------------------------------------------------------------------------

export const documentsListResponse = ok(
  z.looseObject({
    documents: z.array(documentRow),
    totalCount: z.number(),
    filteredCount: z.number(),
    availableCategories: z.array(z.string()),
    hasMore: z.boolean(),
    nextOffset: z.number().nullable(),
  })
);

export const documentCreateResponse = ok(
  z.looseObject({ document: documentRow, ingestionJobId: z.string() })
);

export const documentPatchResponse = ok(z.looseObject({ document: documentRow }));

export const governanceDecisionResponse = ok(
  z.looseObject({ updated: z.number(), documents: z.array(documentRow) })
);

export const documentDeleteResponse = ok(
  z.looseObject({ documentId: z.string(), deleted: z.literal(true) })
);

export const sourcesListResponse = ok(z.array(sourceRow));
export const sourceStatusResponse = ok(sourceRow);

export const brandsListResponse = ok(z.array(brandRow));
export const brandResponse = ok(brandRow);

export const syncStatusResponse = ok(
  z.looseObject({
    syncLogs: z.array(syncLogRow),
    indexIntegrity: z.number(),
    totalIndexedKeys: z.number(),
    scheduledInterval: z.string(),
    nextScheduledSync: z.string(),
    isSyncing: z.boolean(),
  })
);

export const syncRunResponse = ok(
  z.looseObject({ jobId: z.string(), status: z.string(), estimatedDurationMs: z.number() })
);

export const sharepointStatusResponse = ok(
  z.looseObject({
    configured: z.boolean(),
    driveId: z.string().nullable(),
    rootFolderId: z.string().nullable(),
    excludeFolders: z.array(z.string()),
    message: z.string(),
  })
);

/**
 * The SharePoint run answers 200 in three shapes: a successful crawl, and — with
 * no Graph credentials — a `configured:false` failure envelope that the Sync board
 * renders as a state rather than an error.
 */
export const sharepointSyncResponse = z.union([
  z.looseObject({ success: z.literal(true), configured: z.literal(true), data: z.looseObject({}) }),
  z.looseObject({ success: z.literal(false), configured: z.boolean(), error: z.looseObject({ code: z.string(), message: z.string() }) }),
]);

export const aiConfigResponse = ok(
  z.looseObject({
    provider: z.string(),
    // Always masked or empty — never the stored key. Asserted as a string so a
    // regression that leaked the raw value would still have to pass the masking
    // test in tests/apiContract.test.ts.
    apiKey: z.string(),
    model: z.string(),
  })
);

export const deskSettingsResponse = ok(
  z.looseObject({
    maxAnswerSec: z.number(),
    escalationStarLimit: z.number(),
    enableSlack: z.boolean(),
    enableGdpr: z.boolean(),
  })
);

export const searchGapsResponse = ok(z.array(searchGapRow));
export const reviewTasksResponse = ok(z.array(reviewTaskRow));
export const reviewTasksSaveResponse = z.looseObject({
  success: z.literal(true),
  blockedCount: z.number(),
});
export const reportResponse = z.looseObject({
  success: z.literal(true),
  data: reviewTaskRow,
  duplicate: z.boolean().optional(),
});

export const embeddingStatusResponse = ok(
  z.looseObject({
    total: z.number(),
    embedded: z.number(),
    signature: z.string().nullable(),
    mode: z.enum(["hybrid", "lexical"]),
  })
);

export const embeddingBackfillResponse = ok(
  z.looseObject({
    embedded: z.number(),
    failed: z.number(),
    coverage: z.looseObject({ total: z.number(), embedded: z.number() }),
  })
);

export const searchResponse = ok(
  z.looseObject({
    answer: knowledgeAnswer,
    retrievalLatencyMs: z.number(),
    // Per-stage breakdown of retrievalLatencyMs: which of loading candidates,
    // retrieving, and calling the provider actually cost the time.
    timings: z.looseObject({
      candidatesMs: z.number(),
      retrievalMs: z.number(),
      llmMs: z.number(),
      totalMs: z.number(),
    }),
    vectorSimilarityThreshold: z.number(),
    vectorRelativeFloor: z.number().nullable(),
    indexVersion: z.string(),
    retrievalMode: z.enum(["hybrid", "lexical"]),
    retrievalSource: z.enum(["live_ai", "local_fallback"]),
  })
);

export const kbChatResponse = z.looseObject({
  success: z.literal(true),
  reply: z.string(),
  content: z.string(),
  sources: z.array(z.string()),
  confidence: z.enum(["High", "Medium", "Low"]),
  sourcesDetails: z.array(
    z.looseObject({
      name: z.string(),
      version: z.string(),
      lastReviewDate: z.string(),
      owner: z.string(),
      department: z.string(),
    })
  ),
});

export const copilotGenerateResponse = z.looseObject({
  success: z.literal(true),
  result: z.string(),
});

export const copilotDraftResponse = z.looseObject({
  success: z.literal(true),
  content: z.string(),
});

export const crmCasesResponse = z.looseObject({
  success: z.literal(true),
  cases: z.array(z.unknown()),
});

export const aiConnectionTestResponse = z.looseObject({
  ok: z.literal(true),
  success: z.literal(true),
});

/** Debug route — the stored row with its apiKey redacted, or nothing stored yet. */
export const debugDbResponse = z.looseObject({ config: z.unknown() });

// ---------------------------------------------------------------------------
// Auth (BFF login flow)
// ---------------------------------------------------------------------------

/** The current caller's EKOS identity — no secrets, safe to hand the client. */
export const authMeResponse = ok(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.string(),
    brandIds: z.array(z.string()),
    departmentIds: z.array(z.string()),
  })
);

export const authLogoutResponse = okEmpty;

/**
 * /auth/login and /auth/callback normally answer with a 302 redirect and no
 * JSON body; when OAuth is not configured (or the handshake fails) they return
 * the shared failure envelope. Documented loosely because the success path is a
 * redirect, and exercised via the flow test rather than the surface probe.
 */
export const authRedirectResponse = z.looseObject({ success: z.boolean() });

// ---------------------------------------------------------------------------
// Operational
// ---------------------------------------------------------------------------

export const healthzResponse = z.object({
  status: z.literal("ok"),
  uptimeSec: z.number(),
});

export const readyzResponse = z.object({
  status: z.enum(["ok", "degraded", "unavailable"]),
  uptimeSec: z.number(),
  checks: z.array(
    z.object({
      name: z.string(),
      ok: z.boolean(),
      required: z.boolean(),
      detail: z.string(),
    })
  ),
});
