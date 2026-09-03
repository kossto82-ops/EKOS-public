import { describe, it, expect } from 'vitest';
import { classifyProduct, productsInQuery, preferProducts } from '../src/server/productScope.ts';

/**
 * Product scoping exists to resolve one failure the KB test sets exposed: a query
 * term matching a document in the wrong product. It only acts when the query
 * NAMES a product, so the two behaviours that matter are (1) classification is
 * right, and (2) a query that names nothing changes nothing.
 */
describe('classifyProduct', () => {
  it('classifies every product by its id prefix', () => {
    expect(classifyProduct({ id: 'up_helios_invoice_billing' })).toBe('Helios');
    expect(classifyProduct({ id: 'sp_helios_kb_tan_generate_employee_cai_tan' })).toBe('Helios');
    expect(classifyProduct({ id: 'up_agentdesk_inbox_call_notes' })).toBe('AgentDesk');
    expect(classifyProduct({ id: 'up_aurora_call_scenarios' })).toBe('Aurora');
    expect(classifyProduct({ id: 'up_reporting_transcripts_evaluation' })).toBe('Reporting');
    expect(classifyProduct({ id: 'rm_call-forwarding-queues' })).toBe('Routing Manager');
    expect(classifyProduct({ id: 'sp_01AKSN5MI5FQV6JDVIXFB3P7LESAIATTTX' })).toBe('SharePoint');
  });

  it('falls back to the name when a row has no known prefix, defaulting to SharePoint', () => {
    expect(classifyProduct({ id: 'doc_x', name: 'Helios - Invoice & Billing - Add Usage Credit.md' })).toBe('Helios');
    expect(classifyProduct({ id: 'doc_x', name: 'AgentDesk_Portal_Inbox.md' })).toBe('AgentDesk');
    expect(classifyProduct({ id: 'weird', name: 'Some Random Policy.md' })).toBe('SharePoint');
  });
});

describe('productsInQuery', () => {
  it('detects the coined product names, accent- and case-insensitively', () => {
    expect(productsInQuery('In Helios, where do I see the invoices?')).toEqual(['Helios']);
    expect(productsInQuery('en el portal AgentDesk, ¿dónde veo las facturas?')).toEqual(['AgentDesk']);
    expect(productsInQuery('¿cómo configuro Aurora?')).toEqual(['Aurora']);
    expect(productsInQuery('the voicebot greeting')).toEqual(['Aurora']);
    expect(productsInQuery('open Reporting')).toEqual(['Reporting']);
    expect(productsInQuery('customer reports permissions')).toEqual(['Reporting']);
    expect(productsInQuery('in the Routing Manager')).toEqual(['Routing Manager']);
    expect(productsInQuery('the AgentDesk portal')).toEqual(['AgentDesk']);
    expect(productsInQuery('CMT billing screen')).toEqual(['Helios']);
  });

  it('names nothing for a product-agnostic query — the common case must be untouched', () => {
    expect(productsInQuery('Where do I see the invoices?')).toEqual([]);
    expect(productsInQuery('how is an agent performing')).toEqual([]);
    expect(productsInQuery('¿dónde pongo los desvíos y el buzón de voz?')).toEqual([]);
  });

  it('does not fire on a bare product-agnostic phrase, but does on the coined name', () => {
    expect(productsInQuery('I need insight into call volumes')).toEqual([]);
    // The coined product name and the plural "reports" do.
    expect(productsInQuery('customer reports dashboard')).toEqual(['Reporting']);
  });
});

describe('preferProducts', () => {
  const R = (id: string) => ({ doc: { id }, score: 0 });

  it('lifts the named product above the rest, keeping relative order (stable partition)', () => {
    const ranked = [R('sp_a'), R('up_helios_x'), R('rm_b'), R('up_helios_y')];
    const out = preferProducts(ranked, ['Helios']);
    expect(out.map((e) => e.doc.id)).toEqual(['up_helios_x', 'up_helios_y', 'sp_a', 'rm_b']);
  });

  it('returns the SAME array reference when the query named no product', () => {
    const ranked = [R('sp_a'), R('up_helios_x')];
    // Referential identity is the guarantee that the no-product path is untouched.
    expect(preferProducts(ranked, [])).toBe(ranked);
  });

  it('never drops an out-of-product document, only demotes it', () => {
    const ranked = [R('sp_a'), R('up_agentdesk_x'), R('rm_b')];
    const out = preferProducts(ranked, ['AgentDesk']);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.doc.id).sort()).toEqual(['rm_b', 'sp_a', 'up_agentdesk_x']);
    expect(out[0].doc.id).toBe('up_agentdesk_x');
  });

  it('leaves the order alone when nothing matches the named product', () => {
    const ranked = [R('sp_a'), R('rm_b')];
    const out = preferProducts(ranked, ['Aurora']);
    expect(out.map((e) => e.doc.id)).toEqual(['sp_a', 'rm_b']);
  });
});
