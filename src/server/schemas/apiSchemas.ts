/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";
import { AiProviderConfigSchema, DeskSettingsSchema } from "../../schemas/validation.ts";

/**
 * Request schemas for every write (and every parameterized read) the API exposes.
 *
 * Two rules shaped this file:
 *
 *  1. **Preserve behavior where the old handler corrected instead of rejecting.**
 *     `?limit=99999` was clamped to 1000, not refused; an unsupported document
 *     `type` silently became "pdf". Those are load-bearing tolerances, so they are
 *     expressed as transforms here rather than being turned into new 400s.
 *  2. **Tighten where the old handler trusted the caller.** Enum columns
 *     (`scope`, `departmentScope`, source `status`), numeric columns written
 *     straight into SQLite, and the AI-provider config — which was stored
 *     verbatim with no validation at all — are now checked at the boundary.
 *
 * Where the UI already validates a payload (src/schemas/validation.ts), the SAME
 * schema is reused here so the API can't be talked into a state the UI would have
 * refused. That was the actual hole: `AiProviderConfigSchema` guarded the settings
 * form while a direct POST could store any JSON as the live provider config.
 */

/** Mirrors `parseInt(...) || fallback` then clamp — a bad or out-of-range page is corrected, not rejected. */
const boundedInt = (fallback: number, min: number, max: number) =>
  z.preprocess(
    (v) => (parseInt(String(v ?? fallback), 10) || fallback),
    z.number().transform((n) => Math.min(Math.max(n, min), max))
  );

/** Loose string map for payload sections the routes deliberately pass through untyped. */
const looseRecord = z.looseObject({});

// ---------------------------------------------------------------------------
// Shared vocabularies (kept in one place so a route and its schema can't drift)
// ---------------------------------------------------------------------------

export const APPROVAL_STATUSES = ["Approved", "Draft", "Under Review", "Expired", "Banned"] as const;
export const DOCUMENT_TYPES = ["pdf", "xlsx", "docx", "csv", "txt", "md"] as const;
export const SOURCE_STATUSES = ["healthy", "syncing", "warning", "error"] as const;
export const GOVERNANCE_DECISIONS = ["approved", "rejected", "banned"] as const;

/**
 * The provider-call overrides a client may send alongside a prompt. `temperature`
 * is coerced because it arrives from a range input; everything else must already
 * be a string. Loose: unknown keys are dropped by the routes anyway.
 *
 * `.nullish()`, not `.optional()`: the client sends an explicit `aiConfig: null`
 * when no provider config is stored (see src/api/searchApi.ts), and the handlers
 * treat null and absent identically (`rawAiConfig ? {...} : undefined`). The same
 * reasoning applies to every optional field below that a handler coalesces with
 * `||` — rejecting null there would break callers that send it deliberately.
 */
const AiConfigOverrideSchema = z.looseObject({
  provider: z.string().nullish(),
  model: z.string().nullish(),
  apiKey: z.string().nullish(),
  temperature: z.coerce.number().nullish(),
  customEndpointUrl: z.string().nullish(),
  systemPromptOverride: z.string().nullish(),
}).nullish();

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const DocumentsQuerySchema = z.object({
  brandId: z.string().optional(),
  departmentId: z.string().optional(),
  limit: boundedInt(200, 1, 1000),
  offset: boundedInt(0, 0, Number.MAX_SAFE_INTEGER),
});

export const DocumentCreateSchema = z.looseObject({
  id: z.string().optional(),
  // Trailing/leading whitespace is stripped and an over-long name is truncated
  // (not rejected) — a 200+ char filename came from a real upload, not an attack.
  name: z.string().trim().min(1, "name must be a non-empty string").transform((s) => s.slice(0, 200)),
  // An unsupported or missing type still becomes "pdf": by the time the request
  // gets here the text has already been extracted, so refusing it loses work.
  type: z.preprocess(
    (v) => (typeof v === "string" && (DOCUMENT_TYPES as readonly string[]).includes(v) ? v : "pdf"),
    z.enum(DOCUMENT_TYPES)
  ),
  // nullish, not optional: these are all read as `value || <default>` by the
  // route, so an explicit null from a client means "use the default" — see the
  // note on AiConfigOverrideSchema.
  status: z.string().nullish(),
  scope: z.enum(["global", "brand"]).nullish(),
  brandId: z.string().nullish(),
  category: z.string().nullish(),
  isImportant: z.boolean().nullish(),
  content: z.string().nullish(),
  uploadedAt: z.string().nullish(),
  uploadedBy: z.string().nullish(),
  owner: z.string().nullish(),
  department: z.string().nullish(),
  departmentScope: z.enum(["global", "specific"]).nullish(),
  departmentIds: z.array(z.string()).nullish(),
  // Present-but-unauthorized is a 403, decided in the route; this only fixes the
  // vocabulary so an unknown status can never reach the governance column.
  approvalStatus: z.enum(APPROVAL_STATUSES).optional(),
});

/**
 * PATCH is a field whitelist with three different permission bars (see the route).
 * The schema types the writable fields; it deliberately does NOT decide who may
 * write which one — that stays in the handler, where the caller's role is known.
 */
export const DocumentPatchSchema = z.looseObject({
  approvalStatus: z.enum(APPROVAL_STATUSES).optional(),
  content: z.string().optional(),
  owner: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  category: z.string().optional(),
  department: z.string().optional(),
  departmentScope: z.enum(["global", "specific"]).optional(),
  departmentIds: z.array(z.string()).optional(),
  scope: z.enum(["global", "brand"]).optional(),
  brandId: z.string().nullable().optional(),
  version: z.string().optional(),
  lastReviewDate: z.string().optional(),
});

export const GovernanceDecisionSchema = z.object({
  documentName: z.string().trim().min(1, "documentName (non-empty string) is required"),
  decision: z.enum(GOVERNANCE_DECISIONS),
});

// ---------------------------------------------------------------------------
// Knowledge sources
// ---------------------------------------------------------------------------

/**
 * A source row. Only `id`/`name` are structurally required (they key the upsert);
 * the descriptive fields are serialized into the `config` JSON blob, so they stay
 * loose — but the ones that hit typed columns are checked.
 */
const SourceUpsertSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.string().nullish(),
  status: z.string().nullish(),
  recordCount: z.number().nullish(),
  lastUpdate: z.string().nullish(),
});

export const SourcesUpsertSchema = z
  .array(SourceUpsertSchema)
  .describe("Request body must be an array of sources with string id and name fields");

export const SourceStatusSchema = z.object({
  status: z.enum(SOURCE_STATUSES),
});

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------

/**
 * Reuses the schema the settings form validates against, so the API and the UI
 * agree on what a provider config is. This route previously accepted ANY JSON and
 * stored it as the live config that every /search and /kb-chat call then resolved.
 */
export const AiConfigSaveSchema = AiProviderConfigSchema;

/** Same reuse for the desk thresholds the TeamManager form writes. */
export const DeskSettingsSaveSchema = DeskSettingsSchema;

export const SearchGapsSaveSchema = z.array(
  z.looseObject({
    id: z.string().min(1),
    query: z.string().nullish(),
    timestamp: z.string().nullish(),
    hasResults: z.boolean().nullish(),
    dominantSource: z.string().nullish(),
    escalated: z.boolean().nullish(),
    confidence: z.string().nullish(),
    resolved: z.boolean().nullish(),
  })
);

export const ReviewTasksSaveSchema = z.array(
  z.looseObject({
    id: z.string().min(1),
    status: z.string().min(1),
  })
);

export const ReviewTaskReportSchema = z.looseObject({
  id: z.string().min(1),
  documentName: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Every field is optional (the route supplies defaults), but the types matter:
 * these values are inserted straight into kb_sync_jobs, so a string in
 * `recordsProcessed` used to surface as an opaque 500 from SQLite.
 */
export const SyncRunSchema = z.looseObject({
  sourceId: z.string().nullish(),
  sourceName: z.string().nullish(),
  type: z.string().nullish(),
  recordsProcessed: z.number().int().nullish(),
  duration: z.string().nullish(),
  status: z.string().nullish(),
  endTime: z.string().nullish(),
});

// ---------------------------------------------------------------------------
// Brands
// ---------------------------------------------------------------------------

/**
 * `vatRate` is a union rather than `z.coerce.number().nullable()` on purpose:
 * Number(null) is 0, so coercion would turn "no rate set" into "0% VAT" — a value
 * that then flows into AI pricing answers.
 */
const vatRate = z.union([
  z.null(),
  z.coerce
    .number()
    .refine((n) => Number.isFinite(n), "vatRate must be a finite number")
    .refine((n) => n >= 0 && n <= 1, "vatRate must be a fraction between 0 and 1 (e.g. 0.19 for 19%)"),
]);

const brandFields = {
  id: z.string().nullish(),
  country: z.string().nullish(),
  locale: z.string().nullish(),
  vatLabel: z.string().nullish(),
  currency: z.string().nullish(),
  currencySymbol: z.string().nullish(),
  color: z.string().nullish(),
  teamIds: z.array(z.string()).nullish(),
  pricingPlans: z.array(looseRecord).nullish(),
  isActive: z.boolean().nullish(),
  tenantId: z.string().nullish(),
};

export const BrandCreateSchema = z.looseObject({
  ...brandFields,
  displayName: z.string().trim().min(2, "displayName must be a string of 2–100 characters").max(100, "displayName must be a string of 2–100 characters"),
  shortCode: z.string().trim().min(2, "shortCode must be a string of 2–10 characters").max(10, "shortCode must be a string of 2–10 characters"),
  vatRate: vatRate.optional(),
});

export const BrandPatchSchema = z.looseObject({
  ...brandFields,
  displayName: z.string().trim().min(2, "displayName must be a string of 2–100 characters").max(100, "displayName must be a string of 2–100 characters").optional(),
  shortCode: z.string().trim().min(2, "shortCode must be a string of 2–10 characters").max(10, "shortCode must be a string of 2–10 characters").optional(),
  vatRate: vatRate.optional(),
});

export const BrandStatusSchema = z.object({
  isActive: z.boolean({ message: "isActive field is required in request body" }),
});

// ---------------------------------------------------------------------------
// AI routes
// ---------------------------------------------------------------------------

export const AiConnectionTestSchema = z.looseObject({
  provider: z.string().nullish(),
  apiKey: z.string().trim().min(1, "Missing API Key"),
  model: z.string().nullish(),
  customEndpointUrl: z.string().nullish(),
});

export const EmbeddingBackfillSchema = z.looseObject({
  rechunk: z.boolean().nullish(),
  force: z.boolean().nullish(),
  limit: z.coerce.number().nullish(),
});

export const SearchSchema = z.looseObject({
  query: z.string().trim().min(1, "Query parameter is required and must be a non-empty string."),
  brandId: z.string().nullish(),
  departmentId: z.string().nullish(),
  locale: z.string().nullish(),
  aiConfig: AiConfigOverrideSchema,
});

export const KbChatSchema = z.looseObject({
  message: z.string().trim().min(1, "message is required and must be a non-empty string."),
  history: z
    .array(z.looseObject({ role: z.string().nullish(), content: z.string() }))
    .nullish(),
  activeBrandId: z.string().nullish(),
  departmentId: z.string().nullish(),
  aiConfig: AiConfigOverrideSchema,
});

export const CopilotGenerateSchema = z.looseObject({
  promptType: z.string().nullish(),
  tone: z.string().nullish(),
  inputText: z.string().nullish(),
  systemPrompt: z.string().nullish(),
  activeBrandId: z.string().nullish(),
  aiConfig: AiConfigOverrideSchema,
});

export const CopilotDraftSchema = z.looseObject({
  mode: z.string().nullish(),
  tone: z.string().nullish(),
  inputText: z.string().nullish(),
  activeBrand: z.looseObject({ id: z.string().nullish() }).nullish(),
  aiConfig: AiConfigOverrideSchema,
});
