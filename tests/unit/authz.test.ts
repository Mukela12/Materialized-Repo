import { describe, it, expect } from 'vitest';
import { canAccessUserResource, canBrowseLibrary } from '../../server/authz';

describe('canAccessUserResource', () => {
  it('denies an unauthenticated caller', () => {
    expect(canAccessUserResource(null, 'u1')).toBe(false);
    expect(canAccessUserResource(undefined, 'u1')).toBe(false);
  });

  it('allows the owner to access their own resource', () => {
    expect(canAccessUserResource({ id: 'u1' }, 'u1')).toBe(true);
  });

  it('denies a different, non-admin user', () => {
    expect(canAccessUserResource({ id: 'u1' }, 'u2')).toBe(false);
  });

  it('allows an admin to access anyone', () => {
    expect(canAccessUserResource({ id: 'admin', isAdmin: true }, 'u2')).toBe(true);
    expect(canAccessUserResource({ id: 'admin', isAdmin: true }, 'admin')).toBe(true);
  });

  it('treats null/false isAdmin as non-admin', () => {
    expect(canAccessUserResource({ id: 'u1', isAdmin: null }, 'u2')).toBe(false);
    expect(canAccessUserResource({ id: 'u1', isAdmin: false }, 'u2')).toBe(false);
  });
});

describe('canBrowseLibrary', () => {
  it('lets publishers and brands browse the whole library', () => {
    expect(canBrowseLibrary({ role: 'affiliate' })).toBe(true);
    expect(canBrowseLibrary({ role: 'brand' })).toBe(true);
  });

  it('keeps creators to their own listings', () => {
    expect(canBrowseLibrary({ role: 'creator' })).toBe(false);
    expect(canBrowseLibrary({ role: 'creator', isAdmin: false })).toBe(false);
  });

  it('lets an admin browse whatever their role', () => {
    expect(canBrowseLibrary({ role: 'creator', isAdmin: true })).toBe(true);
  });

  it('denies an unauthenticated caller', () => {
    expect(canBrowseLibrary(null)).toBe(false);
    expect(canBrowseLibrary(undefined)).toBe(false);
  });
});
