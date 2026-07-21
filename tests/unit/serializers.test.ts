import { describe, it, expect } from 'vitest';
import { sanitizeUser } from '../../server/serializers';

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
