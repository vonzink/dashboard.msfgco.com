/**
 * Tests for the validate() and validateQuery() Express middleware wrappers
 */
import { describe, it, expect, vi } from 'vitest';
import { validate, validateQuery } from '../../validation/schemas';
import { z } from 'zod';

function mockReq(body = {}, query = {}) {
  return { body, query };
}

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('validate() middleware', () => {
  const schema = z.object({
    name: z.string().min(1).max(100),
    age: z.number().int().positive().optional(),
  });

  it('passes valid body and calls next()', () => {
    const req = mockReq({ name: 'Alice', age: 30 });
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body.name).toBe('Alice');
    expect(req.body.age).toBe(30);
  });

  it('overwrites req.body with parsed data (trimming, defaults)', () => {
    const trimSchema = z.object({ name: z.string().trim() });
    const req = mockReq({ name: '  Bob  ' });
    const res = mockRes();
    const next = vi.fn();

    validate(trimSchema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body.name).toBe('Bob');
  });

  it('returns 400 for invalid body', () => {
    const req = mockReq({ name: '' });
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
  });

  it('returns field path in error response', () => {
    const req = mockReq({ name: 123 }); // wrong type
    const res = mockRes();
    const next = vi.fn();

    validate(schema)(req, res, next);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ field: 'name' }));
  });

  it('logs only the pathname for invalid-body requests with query parameters', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const query = [
      'api_key=VALIDATION_API_KEY_4f91',
      'token=VALIDATION_TOKEN_4f91',
      'code=VALIDATION_OAUTH_CODE_4f91',
      'state=VALIDATION_OAUTH_STATE_4f91',
      'MiXeD_CrEdEnTiAl=VALIDATION_MIXED_CASE_4f91',
      'encoded=VALIDATION_ENCODED%2FVALUE%3F4f91',
      'duplicate=VALIDATION_DUPLICATE_ONE_4f91',
      'duplicate=VALIDATION_DUPLICATE_TWO_4f91',
      'page=VALIDATION_SAFE_LOOKING_4f91',
    ].join('&');
    const fallbackQuery = 'token=VALIDATION_URL_FALLBACK_4f91';

    try {
      for (const req of [
        {
          body: { name: '' },
          method: 'POST',
          originalUrl: `/validation-query-canary?${query}`,
          url: `/validation-query-canary?${fallbackQuery}`,
        },
        {
          body: { name: '' },
          method: 'POST',
          url: `/validation-url-fallback?${fallbackQuery}`,
        },
      ]) {
        validate(schema)(req, mockRes(), vi.fn());
      }

      const records = warning.mock.calls.map(([, payload]) => JSON.parse(payload));
      const serialized = JSON.stringify(warning.mock.calls);
      expect(warning).toHaveBeenCalledTimes(2);
      expect(records.map(record => record.url)).toEqual([
        '/validation-query-canary',
        '/validation-url-fallback',
      ]);
      expect(serialized).not.toContain('?');
      for (const canary of [
        'api_key=',
        'token=',
        'code=',
        'state=',
        'MiXeD_CrEdEnTiAl=',
        'encoded=',
        'duplicate=',
        'page=',
        'VALIDATION_API_KEY_4f91',
        'VALIDATION_TOKEN_4f91',
        'VALIDATION_OAUTH_CODE_4f91',
        'VALIDATION_OAUTH_STATE_4f91',
        'VALIDATION_MIXED_CASE_4f91',
        'VALIDATION_ENCODED%2FVALUE%3F4f91',
        'VALIDATION_ENCODED/VALUE?4f91',
        'VALIDATION_DUPLICATE_ONE_4f91',
        'VALIDATION_DUPLICATE_TWO_4f91',
        'VALIDATION_SAFE_LOOKING_4f91',
        'VALIDATION_URL_FALLBACK_4f91',
      ]) {
        expect(serialized).not.toContain(canary);
      }
    } finally {
      warning.mockRestore();
    }
  });
});

describe('validateQuery() middleware', () => {
  const schema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    q: z.string().min(1).optional(),
  });

  it('parses and coerces query params', () => {
    const req = mockReq({}, { page: '3', limit: '50' });
    const res = mockRes();
    const next = vi.fn();

    validateQuery(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.page).toBe(3);
    expect(req.query.limit).toBe(50);
  });

  it('applies defaults', () => {
    const req = mockReq({}, {});
    const res = mockRes();
    const next = vi.fn();

    validateQuery(schema)(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.page).toBe(1);
    expect(req.query.limit).toBe(20);
  });

  it('returns 400 for invalid query', () => {
    const req = mockReq({}, { page: '0' }); // min 1
    const res = mockRes();
    const next = vi.fn();

    validateQuery(schema)(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
