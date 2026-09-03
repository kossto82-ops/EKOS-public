/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Product scoping for retrieval.
 *
 * The corpus spans six distinct products, and the KB test sets showed the
 * failure mode is scope: a query term ("invoices", "agent", "telephony") matches
 * a document in the WRONG product more strongly than the right one. When a query
 * names its product, that ambiguity is resolvable — "in Helios, where are the
 * invoices" should not land on the AgentDesk inbox.
 *
 * This is derived, never stored. A document's product is already encoded in its
 * id prefix (the same prefixes every ingestion path assigns) and its name, so a
 * `product` column would be denormalization that can drift from the id. Both
 * functions here are pure so retrieval and the tests share one classifier.
 *
 * IMPORTANT: this only helps a query that NAMES a product. The trap questions in
 * the test sets deliberately do not ("where do I see the invoices?"), and nothing
 * here moves them — that is a separate, harder problem. What this fixes is the
 * large, common class of queries that do say which product they mean, and it
 * hardens those against cross-product leak.
 */

export type Product = 'Helios' | 'AgentDesk' | 'Aurora' | 'Reporting' | 'Routing Manager' | 'SharePoint';

/** Lowercase and strip accents, so "atención" matches "atencion". */
function fold(text: string): string {
  return (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Which product a document belongs to.
 *
 * The id prefix is authoritative — it is assigned once at ingest and never
 * derived from mutable content. The name fallback exists only for a row whose id
 * somehow lacks a known prefix; everything in the current corpus is caught by the
 * prefix. Anything unrecognized is SharePoint, which is the crawled-corpus bucket
 * and the safe default (it neither claims nor excludes a portal).
 */
export function classifyProduct(doc: { id?: string; name?: string }): Product {
  const id = doc.id || '';
  if (id.startsWith('up_helios_') || id.startsWith('sp_helios_kb_')) return 'Helios';
  if (id.startsWith('up_agentdesk_')) return 'AgentDesk';
  if (id.startsWith('up_aurora_')) return 'Aurora';
  if (id.startsWith('up_reporting_')) return 'Reporting';
  if (id.startsWith('rm_')) return 'Routing Manager';
  if (id.startsWith('sp_')) return 'SharePoint';

  // Name fallback for an unprefixed row.
  const name = doc.name || '';
  if (/^Helios[\s_-]/.test(name)) return 'Helios';
  if (/^AgentDesk_Portal/.test(name)) return 'AgentDesk';
  if (/^Aurora_Portal/.test(name)) return 'Aurora';
  if (/^Reporting_Foundry/.test(name)) return 'Reporting';
  return 'SharePoint';
}

/**
 * Product name patterns, matched against the accent-folded query.
 *
 * Deliberately conservative — each pattern is a coined product name or an
 * unambiguous tool acronym, not a generic word. In particular "report" (bare
 * singular, as in "I need a report on…") is NOT matched; only the plural or the
 * full product names are, because the singular is ordinary English. Getting a
 * false positive here is worse than getting nothing: it would reorder a query
 * that never meant to name a product.
 */
const PRODUCT_PATTERNS: Array<{ product: Product; re: RegExp }> = [
  { product: 'Helios', re: /\bhelios\b/ },
  { product: 'Helios', re: /\bcmt\b/ }, // Customer Management Tool — the Helios surface
  { product: 'AgentDesk', re: /\bagentdesk\b/ },
  { product: 'Aurora', re: /\baurora\b/ },
  { product: 'Aurora', re: /\bvoice ?bot\b/ },
  { product: 'Reporting', re: /\breporting\b/ },
  { product: 'Reporting', re: /\breports\b/ },
  { product: 'Routing Manager', re: /\brouting manager\b/ },
  { product: 'SharePoint', re: /\bsharepoint\b/ },
];

/** The product(s) a query explicitly names. Empty when it names none. */
export function productsInQuery(query: string): Product[] {
  const q = fold(query);
  const found = new Set<Product>();
  for (const { product, re } of PRODUCT_PATTERNS) {
    if (re.test(q)) found.add(product);
  }
  return Array.from(found);
}

/**
 * Stable-partition a ranked list so documents in the named products come first.
 *
 * A preference, not a filter: an out-of-product document is moved DOWN, never
 * dropped, so a genuinely relevant cross-product result still reaches the model
 * within the grounding budget — and a query that named no product is returned
 * untouched (referential identity), which keeps the no-product path provably
 * unchanged. Relative order within each group is preserved, so this only ever
 * lifts the named product above the rest and changes nothing else.
 */
export function preferProducts<T extends { doc: { id?: string; name?: string } }>(
  ranked: T[],
  queryProducts: Product[]
): T[] {
  if (queryProducts.length === 0) return ranked;
  const wanted = new Set(queryProducts);
  const inProduct: T[] = [];
  const others: T[] = [];
  for (const entry of ranked) {
    (wanted.has(classifyProduct(entry.doc)) ? inProduct : others).push(entry);
  }
  if (inProduct.length === 0 || others.length === 0) return ranked; // nothing to reorder
  return [...inProduct, ...others];
}
