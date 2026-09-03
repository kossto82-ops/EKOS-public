/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { KBDocument, ReviewTask } from '../types';
import { mapSnapshotToKbDocuments, mapUploadToKbDocuments, KbSnapshot, UploadBatch } from './kbMapping';
import snapshotJson from '../data/sharepoint-kb-snapshot.json';
import routingMgrSnapshotJson from '../data/routingmgr-kb-snapshot.json';
import callforwardingSnapshotJson from '../data/callforwarding-kb-snapshot.json';
import manualUploadsJson from '../data/manual-uploads.json';

/**
 * Real knowledge base content, ingested from the Northwind ES SharePoint
 * Knowledge Base (Customer Service Department site — see docs/SHAREPOINT_SYNC.md).
 * The snapshot JSON is the committed crawl output; the mapping converts each
 * crawled file into a KBDocument row (folder → category, frontmatter →
 * metadata, YAML header stripped from the grounding content).
 *
 * To refresh: re-run the crawl (npm run ingest:sharepoint once SP_* creds are
 * set, or the connector-based crawl) and the seed will upsert new documents.
 */
const snapshot = snapshotJson as unknown as KbSnapshot;
const routingMgrSnapshot = routingMgrSnapshotJson as unknown as KbSnapshot;
const callforwardingSnapshot = callforwardingSnapshotJson as unknown as KbSnapshot;
const manualUploads = manualUploadsJson as unknown as UploadBatch;

/**
 * Documents added to EKOS by a person rather than crawled from a system, so
 * they carry a real uploader and owner and have no kb_sources entry — see
 * mapUploadToKbDocuments. Add future uploads to src/data/manual-uploads.json.
 */
const MANUAL_UPLOADER = { id: 'u_admin_rrc', name: 'R. Rodríguez-Cruz' };

export const KB_DOCUMENTS: KBDocument[] = [
  // SharePoint KB (Northwind ES) — ids sp_<itemId>
  ...mapSnapshotToKbDocuments(snapshot),
  // Routing Manager KB (routingmgr.northwind.internal) — raw ids already carry the
  // rm_<slug> prefix, so pass an empty prefix to avoid doubling it.
  ...mapSnapshotToKbDocuments(routingMgrSnapshot, ''),
  // Call-forwarding operator database (imported from the QueryBuddy
  // call-forwarding KB via SharePoint). Owned by R. Rodríguez-Cruz through the
  // frontmatter owner/owner_id, so it maps like any SharePoint doc — ids sp_cf_*.
  ...mapSnapshotToKbDocuments(callforwardingSnapshot),
  // Uploaded through the KB by a named owner — ids up_<slug>
  ...mapUploadToKbDocuments(manualUploads, MANUAL_UPLOADER),
];

export const INITIAL_KB_DOCS = KB_DOCUMENTS;


export const INITIAL_SEARCH_GAPS = [
  {
    id: 'init_gap_1',
    query: 'Cómo desviar llamadas desde una centralita 3CX',
    timestamp: new Date(Date.now() - 3600000 * 2).toISOString(),
    hasResults: false,
    dominantSource: 'N/A',
    escalated: true,
    confidence: 'Low',
    resolved: false,
  },
  {
    id: 'init_gap_2',
    query: 'Portabilidad de número fijo a Northwind ES',
    timestamp: new Date(Date.now() - 3600000 * 5).toISOString(),
    hasResults: false,
    dominantSource: 'N/A',
    escalated: true,
    confidence: 'Low',
    resolved: false,
  },
  {
    id: 'init_gap_3',
    query: '¿Qué código desactiva el desvío de llamadas en IberLink?',
    timestamp: new Date(Date.now() - 3600000 * 12).toISOString(),
    hasResults: true,
    dominantSource: 'IberLink.md',
    escalated: false,
    confidence: 'High',
    resolved: true,
  },
];

export const INITIAL_REVIEW_TASKS: ReviewTask[] = [
  {
    id: 'init_task_1',
    documentName: '01_Pricing_Plans.md',
    feedbackType: 'Outdated Net Pricing',
    agentQuery: '¿Cuál es la tarifa del plan básico de Northwind ES?',
    messageContent: 'El agente citó una tarifa que podría no reflejar la última revisión comercial.',
    status: 'Feedback Received',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    owner: 'Customer Service Operations',
    department: 'Billing & Finance',
    departmentIds: ['finance'],
    priority: 'Urgent',
    aiConfidence: 95,
    similarIncidents: 4,
    flags: ['Price Mismatch', 'SLA Alert'],
  },
  {
    id: 'init_task_2',
    documentName: 'Call_Forwarding_Setup es.md',
    feedbackType: 'Missing Information',
    agentQuery: 'How to configure call forwarding on DemoTel devices?',
    messageContent:
      'We only have standard codes for IberLink, TeleNord, and Rhonecom. — Grounded: the call-forwarding operator database (sp_cf_*, incl. sp_cf_es covering DemoTel and the other Spanish carriers) now provides per-carrier codes.',
    status: 'Grounded & Updated',
    createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    owner: 'Telecommunications Specialist',
    department: 'Telephony',
    departmentIds: ['it'],
    priority: 'High',
    aiConfidence: 87,
    similarIncidents: 2,
    flags: ['Missing Coverage'],
  },
  {
    id: 'init_task_3',
    documentName: 'Escalation_Rules.md',
    feedbackType: 'Incorrect Guidelines',
    agentQuery: '¿Cuándo se escala una incidencia a Team Leader?',
    messageContent: 'La matriz de escalado citada no coincidía con la versión vigente.',
    status: 'Grounded & Updated',
    createdAt: new Date(Date.now() - 3600000 * 48).toISOString(),
    owner: 'Operations Manager',
    department: 'Customer Service',
    priority: 'Medium',
    aiConfidence: 79,
    similarIncidents: 1,
    flags: ['SLA Drift'],
  },
  {
    id: 'init_task_4',
    documentName: 'Master Training.docx',
    feedbackType: 'Missing Information',
    agentQuery: '¿Cuál es la marcación interna del departamento de atención al cliente?',
    messageContent: 'El manual de formación cubre la marcación interna, pero falta el detalle para llamadas internacionales.',
    status: 'Feedback Received',
    createdAt: new Date(Date.now() - 3600000 * 6).toISOString(),
    owner: 'Customer Service Operations',
    department: 'HR & Training',
    priority: 'High',
    aiConfidence: 72,
    similarIncidents: 3,
    flags: ['Missing Coverage', 'Regional Gap'],
  },
  {
    id: 'init_task_5',
    documentName: 'TOTP Configuration for External Portal Authentication in Aurora.md',
    feedbackType: 'Outdated Content',
    agentQuery: '¿Cómo se valida la clave TOTP de un portal externo?',
    messageContent: 'Confirmar que el paso de validación con Test Code sigue vigente en la última versión de Aurora.',
    status: 'Under Review',
    createdAt: new Date(Date.now() - 3600000 * 18).toISOString(),
    owner: 'Service Team',
    department: 'Customer Service',
    priority: 'Medium',
    aiConfidence: 81,
    similarIncidents: 2,
    flags: ['Outdated Link'],
  },
];
