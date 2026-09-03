import { Department } from '../types';

export const DEPARTMENTS: Department[] = [
  { id: 'customer_service', displayName: 'Customer Service', icon: 'Headset', color: 'indigo', description: 'Client-facing operations, billing, and support knowledge.' },
  {
    id: 'call_center',
    displayName: 'Call Center',
    icon: 'PhoneCall',
    color: 'blue',
    description: 'Live call handling, scripts, and real-time agent support.',
  },
  { id: 'human_resources', displayName: 'Human Resources', icon: 'Users', color: 'rose', description: 'Onboarding, policies, benefits, and internal procedures.' },
  { id: 'training', displayName: 'Training', icon: 'GraduationCap', color: 'emerald', description: 'Learning materials, certifications, and skill development.' },
  { id: 'administration', displayName: 'Administration', icon: 'Building2', color: 'amber', description: 'Internal admin processes, compliance, and documentation.' },
  { id: 'it', displayName: 'IT', icon: 'Server', color: 'slate', description: 'Infrastructure, security policies, and technical procedures.' },
  { id: 'sales', displayName: 'Sales', icon: 'TrendingUp', color: 'orange', description: 'Sales playbooks, pricing strategy, and client acquisition.' },
  { id: 'marketing', displayName: 'Marketing', icon: 'Megaphone', color: 'pink', description: 'Brand guidelines, campaigns, and content strategy.' },
  { id: 'finance', displayName: 'Finance', icon: 'Calculator', color: 'cyan', description: 'Budgeting, expense policy, and financial reporting.' },
  { id: 'legal', displayName: 'Legal', icon: 'Scale', color: 'violet', description: 'Contracts, compliance, and regulatory documentation.' },
];
