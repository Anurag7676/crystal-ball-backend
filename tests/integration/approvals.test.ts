import request from 'supertest';
import { ApprovalsResponseSchema } from '../../src/schemas/approval.schema';
import { ErrorResponseSchema } from '../../src/schemas/ai.schema';
import { buildTestApp, FRONTEND_URL } from '../helpers/testApp';

describe('GET /api/approvals', () => {
  it('returns the four pending approvals from the fixture, matching the response contract', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/api/approvals').expect(200);

    const body = ApprovalsResponseSchema.parse(res.body);
    expect(body.source).toBe('fixture');
    expect(body.approvals).toHaveLength(4);
    expect(body.approvals.map((a) => a.id)).toEqual(['apr-001', 'apr-002', 'apr-003', 'apr-004']);
  });

  it('allows CORS only for the configured frontend origin', async () => {
    const { app } = buildTestApp();

    const allowed = await request(app).get('/api/approvals').set('Origin', FRONTEND_URL);
    expect(allowed.headers['access-control-allow-origin']).toBe(FRONTEND_URL);

    const blocked = await request(app).get('/api/approvals').set('Origin', 'https://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('error responses', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/nope').expect(404);
    expect(ErrorResponseSchema.parse(res.body).error.code).toBe('not_found');
  });

  it('reports health without leaking configuration', async () => {
    const { app } = buildTestApp();
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', ai: 'configured' });
  });
});
