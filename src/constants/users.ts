/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PortalUser } from '../types';

export const INITIAL_USERS: PortalUser[] = [
  // Primary (default) administrator — real owner account. First entry in the
  // roster, so AuthContext picks it as the default identity on first load.
  {
    id: 'u_admin_rrc',
    name: 'R. Rodríguez-Cruz',
    email: 'demo.admin@northwind.example.com',
    role: 'Administrator',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['*'],
    lastActive: 'Just now',
    permissions: { manageRates: true, manageForwarding: true, manageClients: true, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u1',
    name: 'Raúl García',
    email: 'raul.garcia@portal.com',
    role: 'Administrator',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['*'],
    lastActive: 'Just now',
    permissions: { manageRates: true, manageForwarding: true, manageClients: true, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true }
  },

  // --- Team Leaders: customer_service, one per language/country group ---
  {
    id: 'u2',
    name: 'Jamie Chen',
    email: 'jamie.chen@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['northwind_de', 'northwind_legal', 'northwind_dbag', 'northwind_es'],
    departmentIds: ['customer_service'],
    lastActive: '5 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_tl_fr',
    name: 'Camille Laurent',
    email: 'camille.laurent@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['northwind_bureau', 'northwind_fr'],
    departmentIds: ['customer_service'],
    lastActive: '10 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_tl_it',
    name: 'Giulia Ferrari',
    email: 'giulia.ferrari@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['northwind_it'],
    departmentIds: ['customer_service'],
    lastActive: '7 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_tl_uk',
    name: 'Oliver Bennett',
    email: 'oliver.bennett@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['northwind_office'],
    departmentIds: ['customer_service'],
    lastActive: '3 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_tl_th',
    name: 'Niran Wattana',
    email: 'niran.wattana@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['it'],
    lastActive: '14 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: true, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_tl_jp',
    name: 'Haruto Sato',
    email: 'haruto.sato@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['northwind_jp'],
    departmentIds: ['customer_service'],
    lastActive: '6 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_tl_nl',
    name: 'Eva de Vries',
    email: 'eva.devries@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['northwind_nl'],
    departmentIds: ['customer_service'],
    lastActive: '9 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_tl_ch',
    name: 'Lukas Meier',
    email: 'lukas.meier@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['northwind_ch'],
    departmentIds: ['customer_service'],
    lastActive: '11 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_tl_intl',
    name: 'Sam Okafor',
    email: 'sam.okafor@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['northwind_club', 'northwind_center'],
    departmentIds: ['customer_service'],
    lastActive: '4 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },

  // --- Agents: customer_service, one per language/country group ---
  {
    id: 'u_a_cs_de',
    name: 'Marco Bauer',
    email: 'marco.bauer@portal.com',
    role: 'Agent',
    status: 'Away',
    brandIds: ['northwind_de', 'northwind_legal', 'northwind_dbag'],
    departmentIds: ['customer_service'],
    lastActive: '45 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: true, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_es',
    name: 'Sofia Dubois',
    email: 'sofia.dubois@portal.com',
    role: 'Operator',
    status: 'Active',
    brandIds: ['northwind_es'],
    departmentIds: ['customer_service'],
    lastActive: '12 mins ago',
    permissions: { manageRates: true, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_fr',
    name: 'Léa Petit',
    email: 'lea.petit@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_bureau', 'northwind_fr'],
    departmentIds: ['customer_service'],
    lastActive: '18 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_it',
    name: 'Matteo Rossi',
    email: 'matteo.rossi@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_it'],
    departmentIds: ['customer_service'],
    lastActive: '22 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_uk',
    name: 'Charlotte Hughes',
    email: 'charlotte.hughes@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_office'],
    departmentIds: ['customer_service'],
    lastActive: '16 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_th',
    name: 'Apinya Charoen',
    email: 'apinya.charoen@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['administration'],
    lastActive: '25 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_jp',
    name: 'Yuki Tanaka',
    email: 'yuki.tanaka@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_jp'],
    departmentIds: ['customer_service'],
    lastActive: '19 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_nl',
    name: 'Sven Bakker',
    email: 'sven.bakker@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_nl'],
    departmentIds: ['customer_service'],
    lastActive: '13 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_ch',
    name: 'Noah Fischer',
    email: 'noah.fischer@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_ch'],
    departmentIds: ['customer_service'],
    lastActive: '21 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cs_intl',
    name: 'Jordan Park',
    email: 'jordan.park@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_club', 'northwind_center'],
    departmentIds: ['customer_service'],
    lastActive: '17 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },

  // --- Agents: call_center, same groupings as customer_service ---
  {
    id: 'u_a_cc_de',
    name: 'Felix Schmidt',
    email: 'felix.schmidt@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_de', 'northwind_legal', 'northwind_dbag'],
    departmentIds: ['call_center'],
    lastActive: '8 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_es',
    name: 'Lucía Fernández',
    email: 'lucia.fernandez@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_es'],
    departmentIds: ['call_center'],
    lastActive: '11 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_fr',
    name: 'Hugo Martin',
    email: 'hugo.martin@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_bureau', 'northwind_fr'],
    departmentIds: ['call_center'],
    lastActive: '14 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_it',
    name: 'Francesca Bianchi',
    email: 'francesca.bianchi@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_it'],
    departmentIds: ['call_center'],
    lastActive: '9 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_uk',
    name: 'Jack Thompson',
    email: 'jack.thompson@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_office'],
    departmentIds: ['call_center'],
    lastActive: '6 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_th',
    name: 'Somsak Phongsri',
    email: 'somsak.phongsri@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['administration'],
    lastActive: '23 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_jp',
    name: 'Sora Yamamoto',
    email: 'sora.yamamoto@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_jp'],
    departmentIds: ['call_center'],
    lastActive: '12 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_nl',
    name: 'Lotte Visser',
    email: 'lotte.visser@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_nl'],
    departmentIds: ['call_center'],
    lastActive: '15 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_ch',
    name: 'Elias Huber',
    email: 'elias.huber@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_ch'],
    departmentIds: ['call_center'],
    lastActive: '7 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_a_cc_intl',
    name: 'Riley Cooper',
    email: 'riley.cooper@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['northwind_club', 'northwind_center'],
    departmentIds: ['call_center'],
    lastActive: '20 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },

  // --- Cross-brand departments: HR, IT, Sales, Marketing, Training, Legal ---
  {
    id: 'u_hr',
    name: 'Elena Rossi',
    email: 'elena.rossi@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['human_resources'],
    lastActive: '2 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_training',
    name: 'Thomas Weber',
    email: 'thomas.weber@portal.com',
    role: 'Operator',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['training'],
    lastActive: '8 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_it',
    name: 'Priya Anand',
    email: 'priya.anand@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['it'],
    lastActive: '1 min ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u_sales',
    name: 'Lucas Moreau',
    email: 'lucas.moreau@portal.com',
    role: 'Operator',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['sales'],
    lastActive: '15 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_marketing',
    name: 'Nina Hoffmann',
    email: 'nina.hoffmann@portal.com',
    role: 'Operator',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['marketing'],
    lastActive: '20 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: false, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u_legal',
    name: 'Isabelle Mercier',
    email: 'isabelle.mercier@portal.com',
    role: 'TeamLeader',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['legal'],
    lastActive: '5 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: true, manageAiAgents: false, manageKnowledgeBase: true }
  },

  // --- System accounts ---
  {
    id: 'u5',
    name: 'API Service',
    email: 'api.service@portal.com',
    role: 'Agent',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['*'],
    lastActive: 'Just now',
    permissions: { manageRates: false, manageForwarding: false, manageClients: false, viewLogs: true, manageAiAgents: false, manageKnowledgeBase: false }
  },
  {
    id: 'u11',
    name: 'Carlos Mendez',
    email: 'carlos.mendez@portal.com',
    role: 'Administrator',
    status: 'Active',
    brandIds: ['*'],
    departmentIds: ['*'],
    lastActive: 'Just now',
    permissions: { manageRates: true, manageForwarding: true, manageClients: true, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u18', name: 'Isabel Fernández',
    email: 'isabel.fernandez@portal.com',
    role: 'LocationManager', status: 'Active',
    brandIds: ['*'], departmentIds: ['*'],
    lastActive: 'Just now',
    permissions: { manageRates: false, manageForwarding: false, manageClients: true, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u19', name: 'Hans Weber',
    email: 'hans.weber@portal.com',
    role: 'LocationManager', status: 'Active',
    brandIds: ['*'], departmentIds: ['*'],
    lastActive: '4 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: true, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u20', name: 'Céline Dupont',
    email: 'celine.dupont@portal.com',
    role: 'LocationManager', status: 'Active',
    brandIds: ['*'], departmentIds: ['*'],
    lastActive: '11 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: true, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true }
  },
  {
    id: 'u21', name: 'Natthawut Srisuk',
    email: 'natthawut.s@portal.com',
    role: 'LocationManager', status: 'Active',
    brandIds: ['*'], departmentIds: ['*'],
    lastActive: '35 mins ago',
    permissions: { manageRates: false, manageForwarding: false, manageClients: true, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true }
  }
];
