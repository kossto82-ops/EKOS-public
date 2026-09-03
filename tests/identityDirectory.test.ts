import { describe, it, expect, beforeAll } from 'vitest';
import { createTestApp, seedTestDatabase } from './testApp.ts';
import { resolveEksUser } from '../src/server/auth/identityMap.ts';

/**
 * The user_directory table + identityMap.resolveEksUser — the seam that turns a
 * corporate AD user_name into an EKOS PortalUser for OAuth mode. Seeded from
 * INITIAL_USERS (corporate_username = email local-part). See
 * docs/AUTH_INTEGRATION_PLAN.md §5.
 */
beforeAll(async () => {
  createTestApp(); // initialises the DB (runs migrations, incl. user_directory)
  await seedTestDatabase();
});

describe('resolveEksUser — directory-backed corporate→EKOS mapping', () => {
  it('maps a seeded corporate username to the right EKOS user and role', () => {
    const admin = resolveEksUser('raul.garcia'); // u1, Administrator
    expect(admin?.id).toBe('u1');
    expect(admin?.role).toBe('Administrator');

    const operator = resolveEksUser('sofia.dubois'); // u_a_cs_es, Operator
    expect(operator?.id).toBe('u_a_cs_es');
    expect(operator?.role).toBe('Operator');
    expect(operator?.departmentIds).toContain('customer_service');
  });

  it('is case-insensitive on the corporate username', () => {
    expect(resolveEksUser('Raul.Garcia')?.id).toBe('u1');
    expect(resolveEksUser('  RAUL.GARCIA  ')?.id).toBe('u1');
  });

  it('returns undefined for an unprovisioned corporate user (caller fails closed)', () => {
    expect(resolveEksUser('ghost.user')).toBeUndefined();
    expect(resolveEksUser('')).toBeUndefined();
    expect(resolveEksUser(undefined)).toBeUndefined();
  });

  it('rebuilds a complete PortalUser (permissions + scopes) from the row', () => {
    const admin = resolveEksUser('raul.garcia')!;
    expect(admin.brandIds).toEqual(['*']);
    expect(admin.departmentIds).toEqual(['*']);
    expect(admin.permissions.manageKnowledgeBase).toBe(true);
    expect(admin.email).toContain('@');
  });
});
