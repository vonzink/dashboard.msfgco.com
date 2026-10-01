import { describe, expect, it } from 'vitest';
import {
  assertCanEdit,
  assertCanRead,
  canEditWebinar,
  canReadAllWebinars,
  canReadWebinar,
  WebinarAccessError,
} from '../../../services/webinars/authorization';

function requestFor(user, webinarStudioAccess) {
  return {
    headers: {},
    user: user ? { db: user, groups: [user.role] } : {},
    ...(webinarStudioAccess ? { webinarStudioAccess } : {}),
  };
}

describe('Webinar Studio authorization', () => {
  const webinar = { primary_owner_user_id: 7 };
  const ownerRequest = requestFor({ id: 7, role: 'user' });
  const otherRequest = requestFor({ id: 12, role: 'user' });
  const adminRequest = requestFor({ id: 99, role: 'admin' });
  const readerRequest = requestFor({ id: 12, role: 'user' }, Object.freeze({ mode: 'everyone', readAll: true }));

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

  it('lets a request the feature gate marked readAll read any webinar without editing it', () => {
    expect(canReadAllWebinars(readerRequest)).toBe(true);
    expect(canReadWebinar(readerRequest, webinar)).toBe(true);
    expect(canEditWebinar(readerRequest, webinar)).toBe(false);
    expect(() => assertCanRead(readerRequest, webinar)).not.toThrow();
    expect(() => assertCanEdit(readerRequest, webinar)).toThrowError(WebinarAccessError);
  });

  it('treats administrators as readers of everything and ignores forged annotations', () => {
    expect(canReadAllWebinars(adminRequest)).toBe(true);
    expect(canReadAllWebinars(otherRequest)).toBe(false);
    expect(canReadAllWebinars(requestFor({ id: 12, role: 'user' }, { mode: 'everyone', readAll: 'yes' }))).toBe(false);
    expect(canReadAllWebinars(requestFor({ id: 12, role: 'user' }, { mode: 'assigned', readAll: false }))).toBe(false);
  });

  it('throws a safe forbidden error before a non-owner can read or edit', () => {
    expect(() => assertCanRead(otherRequest, webinar)).toThrowError(expect.objectContaining({
      status: 403,
      code: 'WEBINAR_ACCESS_DENIED',
    }));
    expect(() => assertCanEdit(otherRequest, webinar)).toThrowError(WebinarAccessError);
    expect(() => assertCanEdit(otherRequest, webinar)).toThrowError(expect.objectContaining({
      status: 403,
      code: 'WEBINAR_ACCESS_DENIED',
    }));
  });
});
