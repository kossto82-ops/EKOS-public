/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildOpenApiDocument } from '../src/server/openapi.ts';

/**
 * Writes docs/openapi.json from the route registry. Run via `npm run api:spec`.
 *
 * The file is committed so a reviewer can see contract changes in a diff, and
 * `tests/apiSurface.test.ts` fails when it no longer matches what the code would
 * generate — the same trick tests/docsDrift.test.ts uses for prose, applied to the
 * whole API surface instead of a few countable claims.
 */
const OUT = path.join(process.cwd(), 'docs', 'openapi.json');

const document = buildOpenApiDocument();
const serialized = `${JSON.stringify(document, null, 2)}\n`;

const existing = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
fs.writeFileSync(OUT, serialized);

const operations = Object.values(document.paths as Record<string, object>).reduce(
  (n, methods) => n + Object.keys(methods).length,
  0,
);
console.log(
  existing === serialized
    ? `docs/openapi.json already current (${operations} operations)`
    : `docs/openapi.json written — ${operations} operations`,
);
