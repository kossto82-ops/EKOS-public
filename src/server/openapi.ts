/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";
import { API_ROUTES, pathParams, toOpenApiPath, type RouteSpec } from "./apiRegistry.ts";
import { failureEnvelope } from "./schemas/responseSchemas.ts";
import { exposureFor } from "./exposure.ts";

/**
 * Builds the OpenAPI document from the route registry.
 *
 * No new dependency: Zod 4 converts a schema to JSON Schema natively
 * (`z.toJSONSchema`), which is what an OpenAPI 3.1 document embeds — 3.1 dropped
 * the custom schema dialect that made a translation layer necessary in 3.0.
 *
 * The point is direction of truth. `docs/API_SPECIFICATION.md` describes this API
 * in prose that nothing can check; this document is *derived* from the schemas the
 * server validates with, so it cannot describe a field the code does not enforce.
 * `npm run api:spec` writes it to docs/openapi.json and a test fails if the
 * committed file is out of date.
 */

/** `io: 'input'` for requests (pre-transform), `'output'` for responses. */
function jsonSchema(schema: z.ZodType, io: "input" | "output") {
  const converted = z.toJSONSchema(schema, {
    io,
    // Unrepresentable constructs (a transform's runtime behavior, for instance)
    // become permissive rather than throwing: the alternative is no document at all.
    unrepresentable: "any",
    override: (ctx) => {
      // Drop the per-schema $schema key — it belongs at the document level, not on
      // every embedded schema object.
      delete (ctx.jsonSchema as Record<string, unknown>).$schema;
    },
  });
  delete (converted as Record<string, unknown>).$schema;
  return converted;
}

function operationFor(route: RouteSpec) {
  const params = pathParams(route.path).map((name) => ({
    name,
    in: "path" as const,
    required: true,
    schema: { type: "string" as const },
  }));

  if (route.requestQuery) {
    const query = jsonSchema(route.requestQuery, "input") as any;
    for (const [name, schema] of Object.entries(query.properties ?? {})) {
      params.push({
        name,
        in: "query" as any,
        required: (query.required ?? []).includes(name),
        schema: schema as any,
      });
    }
  }

  // Every failure shares one shape, so it is described once in components and
  // referenced — inlining it on all 36 operations made the document five times
  // bigger and buried the part that actually differs between routes.
  const failure = (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/FailureEnvelope" } } },
  });

  const responses: Record<string, unknown> = {
    "200": {
      description: "Success",
      content: { "application/json": { schema: jsonSchema(route.response, "output") } },
    },
  };

  // Documented uniformly because they are produced uniformly, by the central error
  // middleware rather than by each handler.
  if (route.guard !== "none") {
    responses["401"] = failure("Missing or unrecognized caller identity (ERR_UNAUTHORIZED)");
  }
  if (route.guard.startsWith("requireTab") || route.guard.startsWith("requireAction")) {
    responses["403"] = failure("Caller's role is not permitted (ERR_FORBIDDEN)");
  }
  if (route.requestBody || route.requestQuery) {
    responses["400"] = failure("Schema validation failed (ERR_VALIDATION, with per-field details)");
  }
  if (route.path === "/readyz") {
    responses["503"] = { description: "A required dependency is unusable", content: { "application/json": { schema: jsonSchema(route.response, "output") } } };
  }
  if (route.externalDependency) {
    responses["500"] = failure("The upstream provider call failed");
  }

  return {
    operationId: `${route.method}${toOpenApiPath(route.path).replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : ""))}`,
    summary: route.summary,
    tags: [route.tag],
    // Authorization is part of the contract, so it is described rather than left
    // for a reader to discover by getting a 403.
    "x-authorization": route.guard,
    // Network exposure (SecurityGuidelines §12) — orthogonal to authorization.
    // 'internal' = infra-only (probes); 'external' = browser-reachable.
    "x-exposure": exposureFor(route.method, route.path) ?? "external",
    ...(params.length ? { parameters: params } : {}),
    ...(route.requestBody
      ? {
          requestBody: {
            required: true,
            content: { "application/json": { schema: jsonSchema(route.requestBody, "input") } },
          },
        }
      : {}),
    responses,
    ...(route.guard === "none" ? { security: [] } : {}),
  };
}

export function buildOpenApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of API_ROUTES) {
    const p = toOpenApiPath(route.path);
    paths[p] = paths[p] ?? {};
    paths[p][route.method] = operationFor(route);
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "EKOS API",
      // Deliberately not a hand-written version string that would rot: the API has
      // no version prefix (see docs/API_SPECIFICATION.md §1) and this document is
      // regenerated from the code.
      version: "0",
      description:
        "Generated from src/server/apiRegistry.ts — do not edit by hand; run `npm run api:spec`.\n\n" +
        "Authentication is an interim, UNSIGNED bearer id (`Authorization: Bearer <userId>`) " +
        "resolved against the user roster, not a verified token. Every operation's " +
        "`x-authorization` field states what the server enforces. See docs/KNOWN_LIMITATIONS.md.",
    },
    components: {
      schemas: {
        FailureEnvelope: jsonSchema(failureEnvelope, "output"),
      },
      securitySchemes: {
        bearerUserId: {
          type: "http",
          scheme: "bearer",
          description: "Unsigned user id. Not cryptographically verified — see the note above.",
        },
      },
    },
    security: [{ bearerUserId: [] }],
    tags: [
      { name: "operations", description: "Unauthenticated liveness and readiness probes." },
      { name: "auth", description: "Corporate OAuth2 BFF login flow (login, callback, logout, me)." },
      { name: "documents", description: "Knowledge base documents and their governance state." },
      { name: "sources", description: "Connected knowledge sources." },
      { name: "sync", description: "Sync log, index telemetry and the SharePoint crawl." },
      { name: "governance", description: "Provider config, desk policy, search gaps, review queue." },
      { name: "brands", description: "Brand records carrying VAT rates and pricing plans." },
      { name: "ai", description: "Retrieval, generation and embedding management." },
    ],
    paths,
  };
}
