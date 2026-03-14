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
