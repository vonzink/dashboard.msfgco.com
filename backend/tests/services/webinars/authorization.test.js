import { describe, expect, it } from 'vitest';
import { assertCanEdit, canEditWebinar, canReadWebinar, WebinarAccessError } from '../../../services/webinars/authorization';

function requestFor(user) {
  return {
    headers: {},
    user: user ? { db: user, groups: [user.role] } : {},
  };
}

describe('Webinar Studio authorization', () => {
  const webinar = { primary_owner_user_id: 7 };
  const ownerRequest = requestFor({ id: 7, role: 'user' });
  const otherRequest = requestFor({ id: 12, role: 'user' });
  const adminRequest = requestFor({ id: 99, role: 'admin' });

  it('allows the primary owner and an administrator to read and edit a webinar', () => {
    expect(canReadWebinar(ownerRequest, webinar)).toBe(true);
    expect(canEditWebinar(ownerRequest, webinar)).toBe(true);
    expect(canReadWebinar(adminRequest, webinar)).toBe(true);
    expect(canEditWebinar(adminRequest, webinar)).toBe(true);
  });

  it('denies another user and an unmapped request', () => {
    expect(canReadWebinar(otherRequest, webinar)).toBe(false);
    expect(canEditWebinar(otherRequest, webinar)).toBe(false);
    expect(canEditWebinar(requestFor(), webinar)).toBe(false);
  });

  it('throws a safe forbidden error before a non-owner can edit', () => {
    expect(() => assertCanEdit(otherRequest, webinar)).toThrowError(WebinarAccessError);
    expect(() => assertCanEdit(otherRequest, webinar)).toThrowError(expect.objectContaining({
      status: 403,
      code: 'WEBINAR_ACCESS_DENIED',
    }));
  });
});
