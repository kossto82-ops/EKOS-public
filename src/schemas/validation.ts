import { z } from 'zod';

// 1. AiProviderConfig Validation Schema
export const AiProviderConfigSchema = z.object({
  provider: z.enum(['gemini', 'anthropic', 'openai', 'groq', 'custom'], {
    message: 'Please select a valid Model Provider.',
  }),
  apiKey: z.string().optional().refine((val) => {
    if (!val || val.trim() === '') return true;
    if (val.includes('••••')) return true;
    return val.length >= 10;
  }, {
    message: 'API key must be at least 10 characters in length if provided.',
  }),
  model: z.string()
    .min(1, { message: 'Active model name is required and cannot be empty.' }),
  temperature: z.number()
    .min(0, { message: 'Temperature cannot be below 0.0.' })
    .max(1, { message: 'Temperature cannot exceed 1.0.' }),
  maxHistory: z.number()
    .min(1, { message: 'Memory history must have at least 1 turn.' })
    .max(100, { message: 'Memory history turns cannot exceed 100.' }),
  customEndpointUrl: z.string().url({ message: 'Must be a valid endpoint URL.' }).optional().or(z.literal('')),
  systemPromptOverride: z.string().optional(),
});

// 2. Brand Validation Schema
export const BrandSchema = z.object({
  displayName: z.string()
    .min(2, { message: 'Brand alias name must contain at least 2 characters.' })
    .max(100, { message: 'Brand alias name cannot exceed 100 characters.' }),
  shortCode: z.string()
    .min(2, { message: 'Country short code must be at least 2 characters.' })
    .max(10, { message: 'Country short code cannot exceed 10 characters.' }),
  vatRate: z.number()
    .min(0, { message: 'VAT/Tax rate cannot be a negative value.' })
    .max(1, { message: 'VAT/Tax rate cannot exceed 1.0 (100%).' }),
  vatLabel: z.string()
    .min(1, { message: 'Tax label (e.g., VAT/IVA/MwSt) is required.' }),
  currency: z.string()
    .min(1, { message: 'Currency denominator is required.' }),
});

// 3. PortalUser Validation Schema
export const PortalUserSchema = z.object({
  name: z.string()
    .min(2, { message: 'User name must be at least 2 characters.' })
    .max(50, { message: 'User name cannot exceed 50 characters.' }),
  email: z.string()
    .email({ message: 'Please specify a valid email address.' }),
  role: z.enum(['Administrator', 'TeamLeader', 'Operator', 'Agent'], {
    message: 'Please select a valid user role.',
  }),
  brandIds: z.array(z.string())
    .min(1, { message: 'User must belong to at least one brand segment.' }),
});

// 4. KBDocument Validation Schema
export const KBDocumentSchema = z.object({
  name: z.string()
    .min(2, { message: 'Document name must be at least 2 characters.' })
    .max(200, { message: 'Document name cannot exceed 200 characters.' }),
  type: z.enum(['pdf', 'xlsx', 'docx', 'csv', 'txt'], {
    message: 'Please select a supported document type.',
  }),
  scope: z.enum(['global', 'brand'], {
    message: 'Please select a valid scope.',
  }),
  owner: z.string()
    .min(2, { message: 'Assigned custodian name must be at least 2 characters.' })
    .max(50, { message: 'Custodian name cannot exceed 50 characters.' }),
});

// 5. DeskSettings Validation Schema (for TeamManager.tsx)
export const DeskSettingsSchema = z.object({
  maxAnswerSec: z.number()
    .min(1.5, { message: 'Target answer threshold must be at least 1.5 seconds.' })
    .max(10, { message: 'Target answer threshold cannot exceed 10.0 seconds.' }),
  escalationStarLimit: z.number()
    .min(1, { message: 'Escalation star limit must be at least 1 star.' })
    .max(4, { message: 'Escalation star limit cannot exceed 4 stars.' }),
  enableSlack: z.boolean(),
  enableGdpr: z.boolean(),
});
