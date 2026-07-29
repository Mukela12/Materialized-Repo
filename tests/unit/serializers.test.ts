import { describe, it, expect } from 'vitest';
import { sanitizeUser, toPublicBrand } from '../../server/serializers';

const user = {
  id: 'u1',
  email: 'a@b.com',
  displayName: 'A',
  role: 'creator',
  password: 'deadbeef.salt',
  emailVerificationToken: 'tok_123',
  emailVerificationExpires: new Date('2026-01-01'),
  isAdmin: false,
  commissionRateOverride: null,
};

describe('sanitizeUser', () => {
  it('strips password and the verification token/expiry', () => {
    const safe = sanitizeUser(user);
    expect('password' in safe).toBe(false);
    expect('emailVerificationToken' in safe).toBe(false);
    expect('emailVerificationExpires' in safe).toBe(false);
  });

  it('keeps the non-sensitive fields', () => {
    const safe = sanitizeUser(user) as any;
    expect(safe.id).toBe('u1');
    expect(safe.email).toBe('a@b.com');
    expect(safe.role).toBe('creator');
    expect(safe.isAdmin).toBe(false);
    expect(safe.commissionRateOverride).toBeNull();
  });

  it('does not mutate the original user', () => {
    const before = { ...user };
    sanitizeUser(user);
    expect(user.password).toBe(before.password);
    expect(user.emailVerificationToken).toBe(before.emailVerificationToken);
  });

  it('is a no-op for a user already missing the sensitive fields', () => {
    const safe = sanitizeUser({ id: 'x', email: 'e' } as any) as any;
    expect(safe).toEqual({ id: 'x', email: 'e' });
  });
});

/**
 * The admin-grant columns migration 0011 added to `brands`.
 *
 * These reach an UNAUTHENTICATED route (GET /api/brands, GET /api/brands/:id) via
 * `db.select().from(brands)`, which returns every declared column. The note is
 * free text an admin writes, grantedBy is an internal user id, and the expiry
 * would let anyone enumerate which brands are on a paid window.
 */
const brand = {
  id: 'b1',
  name: 'Materialized Fashion',
  website: 'materialized.com',
  category: 'Fashion',
  isActive: true,
  ownerId: 'u1',
  inventoryAccessUntil: new Date('2026-08-28'),
  inventoryAccessGrantedBy: 'admin-user-id',
  inventoryAccessNote: 'Admin fee settled — invoice INV-0042',
};

describe('toPublicBrand', () => {
  it('strips all three admin-grant fields', () => {
    const safe = toPublicBrand(brand);
    expect('inventoryAccessUntil' in safe).toBe(false);
    expect('inventoryAccessGrantedBy' in safe).toBe(false);
    expect('inventoryAccessNote' in safe).toBe(false);
  });

  it('leaves every legitimately public field intact', () => {
    const safe = toPublicBrand(brand);
    expect(safe).toEqual({
      id: 'b1',
      name: 'Materialized Fashion',
      website: 'materialized.com',
      category: 'Fashion',
      isActive: true,
      ownerId: 'u1',
    });
  });

  it('never leaks the note, which can carry an invoice reference', () => {
    expect(JSON.stringify(toPublicBrand(brand))).not.toContain('INV-0042');
  });

  it('does not mutate the row it was handed', () => {
    toPublicBrand(brand);
    expect(brand.inventoryAccessNote).toBe('Admin fee settled — invoice INV-0042');
  });

  it('tolerates a brand with no grant set', () => {
    const ungranted = { id: 'b2', name: 'X', inventoryAccessUntil: null };
    expect(toPublicBrand(ungranted)).toEqual({ id: 'b2', name: 'X' });
  });
});
