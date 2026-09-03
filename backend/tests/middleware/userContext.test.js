import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDbUser, getUserId, isAdmin, requireActiveDbUser, requireAdmin, requireDbUser } from '../../middleware/userContext';

// Helper to build a mock req
function mockReq(dbUser = null) {
  return { user: dbUser ? { db: dbUser } : {} };
}

function mockRes() {
  const res = { statusCode: 200 };
  res.status = vi.fn((code) => { res.statusCode = code; return res; });
  res.json = vi.fn(() => res);
  return res;
}

describe('getDbUser', () => {
  it('returns the db user when present', () => {
    const dbUser = { id: 1, email: 'test@test.com', role: 'admin' };
    expect(getDbUser(mockReq(dbUser))).toEqual(dbUser);
  });

  it('returns null when no db user', () => {
    expect(getDbUser(mockReq())).toBeNull();
  });
});

describe('getUserId', () => {
  it('returns user id when present', () => {
    expect(getUserId(mockReq({ id: 42 }))).toBe(42);
  });

  it('returns null when no db user', () => {
    expect(getUserId(mockReq())).toBeNull();
  });

  it.each([0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1, undefined])(
    'returns null for invalid DB user ID %j',
    id => {
      expect(getUserId(mockReq({ id }))).toBeNull();
    },
  );
});

describe('isAdmin', () => {
  it('returns true for admin role', () => {
    expect(isAdmin(mockReq({ id: 1, role: 'admin' }))).toBe(true);
  });

  it('returns true for Admin (case-insensitive)', () => {
    expect(isAdmin(mockReq({ id: 1, role: 'Admin' }))).toBe(true);
  });

  it('returns false for non-admin role', () => {
    expect(isAdmin(mockReq({ id: 1, role: 'user' }))).toBe(false);
  });

  it('returns false when no db user', () => {
    expect(isAdmin(mockReq())).toBe(false);
  });
});

describe('requireAdmin middleware', () => {
  it('calls next() for admin user', () => {
    const next = vi.fn();
    requireAdmin(mockReq({ id: 1, role: 'admin' }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 for non-admin', () => {
    const res = mockRes();
    const next = vi.fn();
    requireAdmin(mockReq({ id: 1, role: 'user' }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('requireDbUser middleware', () => {
  it('calls next() when db user exists', () => {
    const next = vi.fn();
    requireDbUser(mockReq({ id: 1 }), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 401 when no db user', () => {
    const res = mockRes();
    const next = vi.fn();
    requireDbUser(mockReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it.each([0, -1, 1.5, '7', Number.MAX_SAFE_INTEGER + 1, undefined])(
    'returns 401 for invalid DB user ID %j',
    id => {
      const res = mockRes();
      const next = vi.fn();
      requireDbUser(mockReq({ id }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    },
  );
});

describe('requireActiveDbUser middleware', () => {
  it.each([
    [{ id: 7, is_active: 1 }, true],
    [{ id: 7, is_active: '1' }, true],
    [{ id: 7, is_active: 0 }, false],
    [{ id: 0, is_active: 1 }, false],
    [{ id: '7', is_active: 1 }, false],
    [{ id: Number.MAX_SAFE_INTEGER + 1, is_active: 1 }, false],
    [{ id: 7 }, false],
    [null, false],
  ])('requires an explicitly active mapped employee', (dbUser, allowed) => {
    const res = mockRes();
    const next = vi.fn();
    requireActiveDbUser(mockReq(dbUser), res, next);
    expect(next).toHaveBeenCalledTimes(allowed ? 1 : 0);
    if (!allowed) {
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Active employee access required' });
    }
  });
});

describe('Cognito DB-user lookup projection', () => {
  it('selects active state for both email and Cognito-sub identity branches', () => {
    const authSource = readFileSync(path.resolve(import.meta.dirname, '../../middleware/auth.js'), 'utf8');
    expect(authSource).toMatch(/SELECT id, email, name, role, is_active FROM users WHERE email = \?/);
    expect(authSource).toMatch(/SELECT id, email, name, role, is_active FROM users WHERE cognito_sub = \?/);
  });
});
