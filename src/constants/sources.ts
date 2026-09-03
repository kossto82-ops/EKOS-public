/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { KnowledgeSource } from '../types/knowledge';
import type { KbSnapshot } from './kbMapping';
import sharepointSnapshot from '../data/sharepoint-kb-snapshot.json';
import routingMgrSnapshot from '../data/routingmgr-kb-snapshot.json';

// recordCount is derived from the committed crawl snapshots (not a hardcoded
// figure), so it can't drift from the documents actually ingested in
// src/constants/kb.ts. Both sources below are ingested there.
const sharepointDocCount = (sharepointSnapshot as unknown as KbSnapshot).documents?.length ?? 0;
const routingMgrDocCount = (routingMgrSnapshot as unknown as KbSnapshot).documents?.length ?? 0;

// The two knowledge sources whose documents seed the KB:
//  - SharePoint Knowledge Base (Northwind ES), see sharepoint-kb-snapshot.json
//  - Routing Manager call-routing KB (Northwind DE), see routingmgr-kb-snapshot.json
// Live refresh runs over Microsoft Graph once the SP_* env vars are set
// (docs/SHAREPOINT_SYNC.md). coverage/confidenceScore/freshnessScore are static
// seed values (no live scoring model yet) — see the S4 "Sources & Sync" notes.
export const INITIAL_KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  {
    id: 'src_sharepoint_kb',
    name: 'SharePoint — Knowledge Base (Northwind ES)',
    description: 'Corporate Knowledge Base for Brand ES / Northwind ES: SOPs, telephony carrier setup, billing, customer service scripts, systems guides and FAQs, synced from the Customer Service Department SharePoint library.',
    type: 'mcp',
    status: 'healthy',
    lastUpdate: '2026-07-17T00:00:00Z',
    coverage: 100,
    owner: 'Customer Service Operations',
    businessArea: 'Customer Service & Operations',
    criticality: 'Critical',
    primaryAudience: ['Customer Service Agents', 'Team Leaders', 'Operations'],
    recordCount: sharepointDocCount,
    monthlyQueries: 0,
    confidenceScore: 90,
    lastSync: '2026-07-17T00:00:00Z',
    freshnessScore: 95,
    daysSinceReview: 0,
    reviewTeam: 'Customer Service Operations',
    department: 'Customer Service',
    operationalRisk: 'Low',
    mcpStatus: 'connected',
    isAuthoritative: true
  },
  {
    id: 'src_routingmgr_kb',
    name: 'Routing Manager — Call-Routing KB (Northwind DE)',
    description: 'Telephony call-routing and carrier-configuration knowledge for Northwind DE (Brand DE), ingested from the Routing Manager system (routingmgr.northwind.internal).',
    type: 'mcp',
    status: 'healthy',
    lastUpdate: '2026-07-17T00:00:00Z',
    coverage: 100,
    owner: 'Telephony Operations',
    businessArea: 'Telephony & Routing',
    criticality: 'Critical',
    primaryAudience: ['Customer Service Agents', 'Telephony Operations'],
    recordCount: routingMgrDocCount,
    monthlyQueries: 0,
    confidenceScore: 90,
    lastSync: '2026-07-17T00:00:00Z',
    freshnessScore: 95,
    daysSinceReview: 0,
    reviewTeam: 'Telephony Operations',
    department: 'Customer Service',
    operationalRisk: 'Low',
    mcpStatus: 'connected',
    isAuthoritative: true
  }
];
