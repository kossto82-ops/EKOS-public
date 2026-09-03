/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { db } from "../../db/db.ts";
import { kbGovernanceConfigs, kbSearchGaps } from "../../db/schema.ts";
import { eq } from "drizzle-orm";
import { encryptValue, decryptValue } from "../crypto.ts";
import { requireUser, requireTab, requireAction } from "../middleware/auth.ts";
import { asyncHandler } from "../middleware/errors.ts";
import { validate } from "../middleware/validate.ts";
import { logger } from "../logger.ts";
import {
  AiConfigSaveSchema,
  DeskSettingsSaveSchema,
  ReviewTaskReportSchema,
  ReviewTasksSaveSchema,
  SearchGapsSaveSchema,
} from "../schemas/apiSchemas.ts";

// Every route below requires a recognized caller identity. Reads mirror the
// tab that surfaces them ("settings" for config, "governance" for gaps/tasks).
// WRITES require the Administrator-only `manage_governance` action: the
// governance tab is visible to LocationManager too (canAccessTab), but they
// are read-only there, and that must be enforced server-side — not only by a
// disabled button. See src/server/middleware/auth.ts for the identity caveat.
export const router = express.Router();
router.use('/api', requireUser);

// D. Governance Configurations Endpoints
router.get("/api/db/governance/ai-config", requireTab("settings"), asyncHandler(async (_req, res) => {
  const config = db.select().from(kbGovernanceConfigs).where(eq(kbGovernanceConfigs.key, "ai_provider_config")).all()[0];
  if (config) {
    const parsed = JSON.parse(config.value);
    let apiKey = parsed.apiKey;
    if (apiKey && apiKey.includes(':')) {
      try {
        apiKey = decryptValue(apiKey);
      } catch (decErr) {
        logger.error({ err: decErr }, "Failed to decrypt stored API key for masking");
      }
    }
    if (!apiKey || apiKey.trim() === "") {
      if (parsed.provider === "gemini" && process.env.GEMINI_API_KEY) {
        apiKey = "••••••••env";
      } else if (parsed.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
        apiKey = "••••••••env";
      } else if (parsed.provider === "openai" && process.env.OPENAI_API_KEY) {
        apiKey = "••••••••env";
      } else if (parsed.provider === "groq" && process.env.GROQ_API_KEY) {
        apiKey = "••••••••env";
      } else {
        apiKey = "";
      }
    } else {
      apiKey = '••••••••' + apiKey.slice(-4);
    }
    const safeData = { ...parsed, apiKey };
    return res.json({ success: true, data: safeData });
  }
  const defaultKey = process.env.GEMINI_API_KEY ? '••••••••env' : '';
  return res.json({
    success: true,
    data: {
      provider: "gemini",
      apiKey: defaultKey,
      model: "gemini-2.5-flash",
      temperature: 0.2,
      maxHistory: 10
    }
  });
}));

// WRITE is gated on the governance tab (Administrator/LocationManager), not the
// broader "settings" tab: the AI-config edit UI lives under governance, and a
// settings-tab-only role (TeamLeader / IT-dept agent) must not be able to
// repoint the provider/endpoint/key that every /search and /kb-chat call uses.
// Reads stay on "settings" so those roles can still view the (masked) config.
//
// The body is now validated against the SAME schema the settings form uses
// (AiProviderConfigSchema). Before, this route stored whatever JSON it was given
// as the live provider config: an unknown provider, a non-numeric temperature or
// a numeric apiKey (which made `.trim()` below throw an opaque 500) all landed in
// the row that every AI call subsequently resolves.
router.post(
  "/api/db/governance/ai-config",
  requireAction("manage_governance"),
  validate({ body: AiConfigSaveSchema }),
  asyncHandler(async (req, res) => {
    const configVal = { ...req.body };
    const now = new Date().toISOString();
    const existing = db.select().from(kbGovernanceConfigs).where(eq(kbGovernanceConfigs.key, "ai_provider_config")).all()[0];
    if (existing) {
      const existingParsed = JSON.parse(existing.value);
      if ((!configVal.apiKey || configVal.apiKey.trim() === "" || configVal.apiKey.includes("••••")) && existingParsed?.apiKey) {
        configVal.apiKey = existingParsed.apiKey;
      }
    }

    if (configVal.apiKey && configVal.apiKey.trim() !== "" && !configVal.apiKey.includes(':') && !configVal.apiKey.includes("••••")) {
      configVal.apiKey = encryptValue(configVal.apiKey);
    }

    if (existing) {
      db.update(kbGovernanceConfigs).set({
        value: JSON.stringify(configVal),
        updatedAt: now
      }).where(eq(kbGovernanceConfigs.key, "ai_provider_config")).run();
    } else {
      db.insert(kbGovernanceConfigs).values({
        key: "ai_provider_config",
        value: JSON.stringify(configVal),
        tenantId: "tenant_default",
        createdAt: now,
        updatedAt: now
      }).run();
    }
    return res.json({ success: true });
  })
);

router.get("/api/db/governance/desk-settings", requireTab("settings"), asyncHandler(async (_req, res) => {
  const config = db.select().from(kbGovernanceConfigs).where(eq(kbGovernanceConfigs.key, "desk_settings")).all()[0];
  if (config) {
    return res.json({ success: true, data: JSON.parse(config.value) });
  }
  return res.json({
    success: true,
    data: {
      maxAnswerSec: 3.5,
      escalationStarLimit: 2,
      enableSlack: true,
      enableGdpr: true
    }
  });
}));

// Validated against DeskSettingsSchema — the same thresholds the TeamManager form
// checks — so the stored desk policy can't be pushed out of range through the API.
router.post(
  "/api/db/governance/desk-settings",
  requireAction("manage_governance"),
  validate({ body: DeskSettingsSaveSchema }),
  asyncHandler(async (req, res) => {
    const settingsVal = req.body;
    const now = new Date().toISOString();
    const existing = db.select().from(kbGovernanceConfigs).where(eq(kbGovernanceConfigs.key, "desk_settings")).all()[0];
    if (existing) {
      db.update(kbGovernanceConfigs).set({
        value: JSON.stringify(settingsVal),
        updatedAt: now
      }).where(eq(kbGovernanceConfigs.key, "desk_settings")).run();
    } else {
      db.insert(kbGovernanceConfigs).values({
        key: "desk_settings",
        value: JSON.stringify(settingsVal),
        tenantId: "tenant_default",
        createdAt: now,
        updatedAt: now
      }).run();
    }
    return res.json({ success: true });
  })
);

router.get("/api/db/governance/gaps", requireTab("governance"), asyncHandler(async (_req, res) => {
  const gaps = db.select().from(kbSearchGaps).all();
  return res.json({ success: true, data: gaps });
}));

router.post(
  "/api/db/governance/gaps",
  requireAction("manage_governance"),
  validate({ body: SearchGapsSaveSchema }),
  asyncHandler(async (req, res) => {
    const gaps = req.body;
    const now = new Date().toISOString();
    // Atomic batch — see the same reasoning on POST /api/db/sources: an
    // unwrapped per-row loop can half-apply a bulk replace on a mid-batch error.
    db.transaction((tx) => {
      for (const gap of gaps) {
        const existing = tx.select().from(kbSearchGaps).where(eq(kbSearchGaps.id, gap.id)).all()[0];
        if (existing) {
          tx.update(kbSearchGaps).set({
            query: gap.query,
            timestamp: gap.timestamp,
            hasResults: gap.hasResults,
            dominantSource: gap.dominantSource,
            escalated: gap.escalated,
            confidence: gap.confidence,
            resolved: gap.resolved,
            updatedAt: now
          }).where(eq(kbSearchGaps.id, gap.id)).run();
        } else {
          tx.insert(kbSearchGaps).values({
            id: gap.id,
            query: gap.query,
            timestamp: gap.timestamp,
            hasResults: gap.hasResults,
            dominantSource: gap.dominantSource,
            escalated: gap.escalated,
            confidence: gap.confidence,
            resolved: gap.resolved,
            tenantId: "tenant_default",
            createdAt: now,
            updatedAt: now
          }).run();
        }
      }
    });
    return res.json({ success: true });
  })
);

// Persistence-path note: the Governance work-queue UI currently reads/writes
// review tasks directly against localStorage (see useKbGovernanceData.ts) —
// it does not call these two endpoints. They stay validated and reachable as
// defense-in-depth (see RESOLVED_TASK_STATUSES below) for any caller that
// does hit them directly, and as the intended landing spot if the UI is ever
// migrated off localStorage onto this API.
router.get("/api/db/governance/tasks", requireTab("governance"), asyncHandler(async (_req, res) => {
  const config = db.select().from(kbGovernanceConfigs).where(eq(kbGovernanceConfigs.key, "review_tasks")).all()[0];
  if (config) {
    return res.json({ success: true, data: JSON.parse(config.value) });
  }
  return res.json({ success: true, data: [] });
}));

// Statuses a task cannot be re-approved OUT of. 'Feedback Received' is
// deliberately NOT here: it is the fresh-intake status for a reported issue, so
// a reviewer's FIRST approval (Feedback Received -> Grounded & Updated) must be
// allowed. Including it previously reverted every first approval server-side
// while the client had already marked the task resolved — a permanent
// task/document desync. Genuinely-resolved states (approved, explicitly
// rejected, banned) still may not be silently re-approved.
const RESOLVED_TASK_STATUSES = new Set(["Grounded & Updated", "Rejected", "Banned"]);

router.post(
  "/api/db/governance/tasks",
  requireAction("manage_governance"),
  validate({ body: ReviewTasksSaveSchema }),
  asyncHandler(async (req, res) => {
    const tasksVal = req.body;
    const now = new Date().toISOString();
    const existing = db.select().from(kbGovernanceConfigs).where(eq(kbGovernanceConfigs.key, "review_tasks")).all()[0];

    // Server-side enforcement of the same eligibility rule the bulk-approve UI applies:
    // a task already resolved (Grounded & Updated / Rejected / Banned) cannot be
    // silently re-approved by a caller that bypasses the client-side check.
    let blockedCount = 0;
    let sanitizedTasks = tasksVal;
    if (existing) {
      const existingStatusById = new Map((JSON.parse(existing.value) as any[]).map((t) => [t.id, t.status]));
      sanitizedTasks = tasksVal.map((task: any) => {
        const previousStatus = existingStatusById.get(task.id);
        // Only a transition into "Grounded & Updated" from a *different*, already-resolved
        // status counts as a bypass attempt — a task that was already "Grounded & Updated"
        // being resubmitted with the same status is a harmless no-op, not a re-approval,
        // and shouldn't be counted in blockedCount.
        const isBlockedReapproval =
          task.status === "Grounded & Updated" &&
          !!previousStatus &&
          previousStatus !== task.status &&
          RESOLVED_TASK_STATUSES.has(previousStatus);
        if (isBlockedReapproval) {
          blockedCount++;
          return { ...task, status: previousStatus };
        }
        return task;
      });
    }

    if (existing) {
      db.update(kbGovernanceConfigs).set({
        value: JSON.stringify(sanitizedTasks),
        updatedAt: now
      }).where(eq(kbGovernanceConfigs.key, "review_tasks")).run();
    } else {
      db.insert(kbGovernanceConfigs).values({
        key: "review_tasks",
        value: JSON.stringify(sanitizedTasks),
        tenantId: "tenant_default",
        createdAt: now,
        updatedAt: now
      }).run();
    }
    return res.json({ success: true, blockedCount });
  })
);

// Report intake: an agent/operator filing an issue from the Assistant needs to
// create a review task, but must NOT gain read/manage access to the queue.
// So this route is gated only by requireUser (applied router-wide) instead of
// requireTab("governance") — any recognized caller can *produce* a task here,
// while GET/POST /tasks above stay restricted to governance roles. The status
// is forced server-side to a fresh, unresolved value so a reporter can't
// self-approve by submitting "Grounded & Updated".
router.post(
  "/api/db/governance/report",
  validate({ body: ReviewTaskReportSchema }),
  asyncHandler(async (req, res) => {
    const task = req.body;

    // Never trust a client-supplied status on intake — a reported issue always
    // enters the queue as freshly received, awaiting a governance reviewer.
    const safeTask = { ...task, status: "Feedback Received" };

    const now = new Date().toISOString();
    const existing = db.select().from(kbGovernanceConfigs).where(eq(kbGovernanceConfigs.key, "review_tasks")).all()[0];
    const currentTasks: any[] = existing ? JSON.parse(existing.value) : [];

    // Idempotency: if a task with this id already exists, don't duplicate it.
    if (currentTasks.some((t) => t.id === safeTask.id)) {
      return res.json({ success: true, data: safeTask, duplicate: true });
    }

    const updated = [safeTask, ...currentTasks];
    if (existing) {
      db.update(kbGovernanceConfigs).set({
        value: JSON.stringify(updated),
        updatedAt: now
      }).where(eq(kbGovernanceConfigs.key, "review_tasks")).run();
    } else {
      db.insert(kbGovernanceConfigs).values({
        key: "review_tasks",
        value: JSON.stringify(updated),
        tenantId: "tenant_default",
        createdAt: now,
        updatedAt: now
      }).run();
    }
    return res.json({ success: true, data: safeTask });
  })
);
