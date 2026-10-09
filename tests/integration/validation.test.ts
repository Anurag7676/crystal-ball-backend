import request from 'supertest';
import { ErrorResponseSchema } from '../../src/schemas/ai.schema';
import { buildTestApp, SESSION_ID } from '../helpers/testApp';

describe('AI request validation (before any LLM call)', () => {
  it.each(['greeting', 'summary', 'chat', 'help', 'teach'])(
    'POST /api/ai/%s rejects a body without a session id with a JSON 400',
    async (action) => {
      const { app, provider } = buildTestApp();

      const res = await request(app).post(`/api/ai/${action}`).send({}).expect(400);

      const body = ErrorResponseSchema.parse(res.body);
      expect(body.error.code).toBe('validation_error');
      expect(body.error.details?.some((d) => d.path === 'sessionId')).toBe(true);
      expect(provider?.calls).toHaveLength(0);
    },
  );

  it('rejects chat messages over the length limit', async () => {
    const { app, provider } = buildTestApp();

    await request(app)
      .post('/api/ai/chat')
      .send({ sessionId: SESSION_ID, message: 'x'.repeat(1001) })
      .expect(400);
    expect(provider?.calls).toHaveLength(0);
  });

  it('returns a JSON 400 for malformed JSON instead of an HTML error page', async () => {
    const { app } = buildTestApp();

    const res = await request(app)
      .post('/api/ai/chat')
      .set('Content-Type', 'application/json')
      .send('{"sessionId": ')
      .expect(400);

    expect(ErrorResponseSchema.parse(res.body).error.code).toBe('validation_error');
  });

  it('rejects oversized bodies with 413', async () => {
    const { app } = buildTestApp();

    const res = await request(app)
      .post('/api/ai/chat')
      .send({ sessionId: SESSION_ID, message: 'x', padding: 'y'.repeat(20_000) })
      .expect(413);

    expect(ErrorResponseSchema.parse(res.body).error.code).toBe('validation_error');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
  });
});
