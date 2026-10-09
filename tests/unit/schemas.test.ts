import approvalsFixture from '../../src/data/approvals.json';
import { ApprovalListSchema } from '../../src/schemas/approval.schema';
import {
  GreetingRequestSchema,
  MAX_MESSAGE_LENGTH,
  MessageRequestSchema,
  SummaryModelOutputSchema,
} from '../../src/schemas/ai.schema';

describe('approval fixture contract', () => {
  it('contains exactly the four assignment records, all pending review on "Sep 18"', () => {
    const approvals = ApprovalListSchema.parse(approvalsFixture);

    expect(approvals.map((a) => [a.title, a.type, a.submittedBy])).toEqual([
      ['Site Patrol Onboarding & Checklists', 'folder', 'Sam HelpAdmin'],
      ['Level 2 Drone Patrol Video Demo', 'video', 'Alex HelpAdmin'],
      ['Safety Equipment & Sensor Specs', 'pdf', 'Sam HelpAdmin'],
      ['360° Spatial Zone Layout & Camera Map', 'image', 'Elena HelpAdmin'],
    ]);
    expect(new Set(approvals.map((a) => a.id)).size).toBe(4);
    expect(approvals.every((a) => a.status === 'pending_review')).toBe(true);
    expect(approvals.every((a) => a.submittedDateLabel === 'Sep 18')).toBe(true);
  });
});

describe('request contracts', () => {
  it('accepts a minimal greeting request and an optional language tag', () => {
    expect(GreetingRequestSchema.safeParse({ sessionId: 'session-1234' }).success).toBe(true);
    expect(GreetingRequestSchema.safeParse({ sessionId: 'session-1234', language: 'hi-IN' }).success).toBe(true);
  });

  it.each([
    ['too-short session id', { sessionId: 'abc' }],
    ['session id with unsafe characters', { sessionId: 'abc$%^&*()_+12' }],
    ['malformed language', { sessionId: 'session-1234', language: 'english please' }],
    ['unknown fields', { sessionId: 'session-1234', admin: true }],
  ])('rejects %s', (_label, body) => {
    expect(GreetingRequestSchema.safeParse(body).success).toBe(false);
  });

  it('trims messages and rejects empty or oversized ones', () => {
    const ok = MessageRequestSchema.parse({ sessionId: 'session-1234', message: '  hi  ' });
    expect(ok.message).toBe('hi');

    expect(MessageRequestSchema.safeParse({ sessionId: 'session-1234', message: '   ' }).success).toBe(false);
    expect(
      MessageRequestSchema.safeParse({ sessionId: 'session-1234', message: 'x'.repeat(MAX_MESSAGE_LENGTH + 1) })
        .success,
    ).toBe(false);
  });
});

describe('summary model output contract', () => {
  const valid = {
    pendingCount: 4,
    overview: 'Four items are waiting.',
    priorityItems: [{ approvalId: 'apr-003', reason: 'Safety-related.' }],
    recommendations: ['Start with the safety specs.'],
  };

  it('accepts a well-formed summary', () => {
    expect(SummaryModelOutputSchema.safeParse(valid).success).toBe(true);
  });

  it.each([
    ['missing overview', { ...valid, overview: undefined }],
    ['non-integer count', { ...valid, pendingCount: 3.5 }],
    ['empty priority list', { ...valid, priorityItems: [] }],
    ['extra top-level keys', { ...valid, approved: ['apr-001'] }],
    ['priority item without id', { ...valid, priorityItems: [{ reason: 'x' }] }],
  ])('rejects %s', (_label, output) => {
    expect(SummaryModelOutputSchema.safeParse(output).success).toBe(false);
  });
});
