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
    expect(body).toMatchObject({ total: 4, page: 1, pageSize: 10, pageCount: 1, pendingCount: 4 });
  });

  it('filters by type, submitter and search on the server', async () => {
    const { app } = buildTestApp();

    const byType = await request(app).get('/api/approvals').query({ type: 'pdf,image' }).expect(200);
    expect(byType.body.approvals.map((a: { id: string }) => a.id)).toEqual(['apr-003', 'apr-004']);

    const combined = await request(app)
      .get('/api/approvals')
      .query({ submittedBy: 'Sam HelpAdmin', q: 'safety' })
      .expect(200);
    expect(ApprovalsResponseSchema.parse(combined.body).approvals.map((a) => a.id)).toEqual(['apr-003']);
  });

  it('paginates with total, pageCount and the clamped page', async () => {
    const { app } = buildTestApp();

    const res = await request(app).get('/api/approvals?pageSize=3&page=2').expect(200);

    const body = ApprovalsResponseSchema.parse(res.body);
    expect(body.approvals.map((a) => a.id)).toEqual(['apr-004']);
    expect(body).toMatchObject({ total: 4, page: 2, pageSize: 3, pageCount: 2 });
  });

  it.each(['pageSize=500', 'page=0', 'type=doc', 'sort=title'])('rejects ?%s with a JSON 400', async (qs) => {
    const { app } = buildTestApp();
    const res = await request(app).get(`/api/approvals?${qs}`).expect(400);
    expect(ErrorResponseSchema.parse(res.body).error.code).toBe('validation_error');
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
