/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import { db } from "../../db/db.ts";
import { kbBrands } from "../../db/schema.ts";
import { eq } from "drizzle-orm";
import { requireUser, requireAction } from "../middleware/auth.ts";
import { asyncHandler, notFound } from "../middleware/errors.ts";
import { validate } from "../middleware/validate.ts";
import { logger } from "../logger.ts";
import { BrandCreateSchema, BrandPatchSchema, BrandStatusSchema } from "../schemas/apiSchemas.ts";

// Reads require a recognized caller identity; brand MUTATIONS (create/update/
// status) require the "manage_rates" permission (Administrator only) — brand
// records carry VAT rates and pricing plans that flow into AI pricing answers,
// so an ungated write let any recognized user poison rates or disable brands.
// See src/server/middleware/auth.ts for what this does and does not guarantee.
//
// Payload validation lives in src/server/schemas/apiSchemas.ts (BrandCreate/
// BrandPatch/BrandStatus), which mirrors the constraints BrandSchema
// (src/schemas/validation.ts) enforces in the client BrandManager — a direct API
// call used to bypass those entirely, so vatRate was Number()-coerced with no
// range or NaN guard and fed straight into AI pricing answers.
export const router = express.Router();
router.use('/api', requireUser);

/** Parses the two JSON-text columns back into arrays for the client-facing shape. */
function parseBrandRow(row: any) {
  let teamIds: string[] = [];
  let pricingPlans: any[] = [];
  try {
    if (row.teamIds) teamIds = JSON.parse(row.teamIds);
  } catch {
    logger.warn({ brandId: row.id }, "Failed to parse teamIds of brand");
  }
  try {
    if (row.pricingPlans) pricingPlans = JSON.parse(row.pricingPlans);
  } catch {
    logger.warn({ brandId: row.id }, "Failed to parse pricingPlans of brand");
  }
  return { ...row, teamIds, pricingPlans, isActive: row.isActive !== null && row.isActive !== undefined ? !!row.isActive : true };
}

// E. Brands Endpoints
router.get("/api/db/brands", asyncHandler(async (_req, res) => {
  const list = db.select().from(kbBrands).all();
  return res.json({ success: true, data: list.map(parseBrandRow) });
}));

router.post(
  "/api/db/brands",
  requireAction("manage_rates"),
  validate({ body: BrandCreateSchema }),
  asyncHandler(async (req, res) => {
    const brand = req.body;
    const now = new Date().toISOString();
    const enriched = {
      id: brand.id || `brand_${Math.random().toString(36).substring(2, 11)}`,
      displayName: brand.displayName,
      shortCode: brand.shortCode,
      country: brand.country || null,
      locale: brand.locale || null,
      vatRate: brand.vatRate ?? null,
      vatLabel: brand.vatLabel || null,
      currency: brand.currency || null,
      currencySymbol: brand.currencySymbol || null,
      color: brand.color || null,
      teamIds: Array.isArray(brand.teamIds) ? JSON.stringify(brand.teamIds) : '[]',
      pricingPlans: Array.isArray(brand.pricingPlans) ? JSON.stringify(brand.pricingPlans) : '[]',
      isActive: brand.isActive !== undefined && brand.isActive !== null ? !!brand.isActive : true,
      tenantId: brand.tenantId || "tenant_default",
      createdAt: now,
      updatedAt: now
    };

    db.insert(kbBrands).values(enriched).run();

    return res.json({
      success: true,
      data: {
        ...enriched,
        teamIds: Array.isArray(brand.teamIds) ? brand.teamIds : [],
        pricingPlans: Array.isArray(brand.pricingPlans) ? brand.pricingPlans : [],
        isActive: !!enriched.isActive
      }
    });
  })
);

router.patch(
  "/api/db/brands/:id",
  requireAction("manage_rates"),
  validate({ body: BrandPatchSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const updateData = req.body;
    const now = new Date().toISOString();

    const fieldsToSet: any = {
      updatedAt: now
    };
    if (updateData.displayName !== undefined) fieldsToSet.displayName = updateData.displayName;
    if (updateData.shortCode !== undefined) fieldsToSet.shortCode = updateData.shortCode;
    if (updateData.country !== undefined) fieldsToSet.country = updateData.country;
    if (updateData.locale !== undefined) fieldsToSet.locale = updateData.locale;
    if (updateData.vatRate !== undefined) fieldsToSet.vatRate = updateData.vatRate;
    if (updateData.vatLabel !== undefined) fieldsToSet.vatLabel = updateData.vatLabel;
    if (updateData.currency !== undefined) fieldsToSet.currency = updateData.currency;
    if (updateData.currencySymbol !== undefined) fieldsToSet.currencySymbol = updateData.currencySymbol;
    if (updateData.color !== undefined) fieldsToSet.color = updateData.color;
    if (updateData.teamIds !== undefined) {
      fieldsToSet.teamIds = Array.isArray(updateData.teamIds) ? JSON.stringify(updateData.teamIds) : '[]';
    }
    if (updateData.pricingPlans !== undefined) {
      fieldsToSet.pricingPlans = Array.isArray(updateData.pricingPlans) ? JSON.stringify(updateData.pricingPlans) : '[]';
    }
    if (updateData.isActive !== undefined) fieldsToSet.isActive = !!updateData.isActive;
    if (updateData.tenantId !== undefined) fieldsToSet.tenantId = updateData.tenantId;

    db.update(kbBrands).set(fieldsToSet).where(eq(kbBrands.id, id)).run();

    // Fetch updated record to return
    const updated = db.select().from(kbBrands).where(eq(kbBrands.id, id)).all()[0];
    if (!updated) {
      throw notFound("Brand not found");
    }

    return res.json({ success: true, data: parseBrandRow(updated) });
  })
);

router.patch(
  "/api/db/brands/:id/status",
  requireAction("manage_rates"),
  validate({ body: BrandStatusSchema }),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { isActive } = req.body;
    const now = new Date().toISOString();

    db.update(kbBrands).set({
      isActive,
      updatedAt: now
    }).where(eq(kbBrands.id, id)).run();

    const updated = db.select().from(kbBrands).where(eq(kbBrands.id, id)).all()[0];
    if (!updated) {
      throw notFound("Brand not found");
    }

    return res.json({ success: true, data: parseBrandRow(updated) });
  })
);
