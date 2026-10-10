import request from 'supertest';
import { FixtureApprovalRepository } from '../../src/repositories/approval.repository';
import { textScript } from '../helpers/fakes';
import { buildTestApp, mutableApprovals } from '../helpers/testApp';

/**
 * Regression tests for AI context assembly: what each action actually sends to the model.
 * The fake provider records every request, so no paid model calls are made.
 */

type App = Parameters<typeof request>[0];
const post = (app: App, action: string, sessionId: string, message?: string) =>
  request(app)
    .post(`/api/ai/${action}`)
    .send(message === undefined ? { sessionId } : { sessionId, message })
    .expect(200);

describe('AI context assembly', () => {
  it('Teach recognises apr-002 and its real submitter, and gets it as the selected item when asked', async () => {
    const { app, provider } = buildTestApp({ script: textScript('Lesson [policy-2].') });

    await post(app, 'teach', 'ctx-teach-0001', 'How do I review the Level 2 Drone Patrol Video Demo?');

    const system = provider!.calls[0]!.messages[0]!.content;
    expect(system).toContain('"id": "apr-002"');
    expect(system).toContain('"submittedBy": "Alex HelpAdmin"');
    expect(system).toMatch(/<referenced_items>[\s\S]*"id": "apr-002"[\s\S]*<\/referenced_items>/);
  });

  it('a fresh Teach session has no history and is told not to refer to earlier lessons', async () => {
    const { app, provider } = buildTestApp({ script: textScript('Lesson.') });

    await post(app, 'teach', 'ctx-teach-0002', 'Teach me how to review an approval.');

    const { messages } = provider!.calls[0]!;
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[0]!.content).toMatch(/do not say "again"/i);
  });

  it('Teach histories are isolated between sessions', async () => {
    const { app, provider } = buildTestApp({ script: textScript('Lesson.') });

    await post(app, 'teach', 'ctx-teach-aaaa', 'Teach me how to review an approval.');
    await post(app, 'teach', 'ctx-teach-bbbb', 'Teach me how to review an approval.');

    expect(provider!.calls[1]!.messages.map((m) => m.role)).toEqual(['system', 'user']);
  });

  it('Help includes metadata for an approval the question names, while procedures stay policy-grounded', async () => {
    const { app, provider } = buildTestApp({ script: textScript('Check it plays end to end [policy-2].') });

    await post(app, 'help', 'ctx-help-0001', 'What should I check before approving the Level 2 Drone Patrol Video Demo?');

    const system = provider!.calls[0]!.messages[0]!.content;
    expect(system).toMatch(/<referenced_items>[\s\S]*"id": "apr-002"[\s\S]*"submittedBy": "Alex HelpAdmin"/);
    expect(system).toContain('[policy-2] Review workflow:'); // retrieval unchanged
    expect(system).toMatch(/rules and procedures must come only from the policy/i);
    expect(system).toMatch(/have not opened any file/i);
  });

  it('Help resolves a follow-up ("it") to the item named in the previous question', async () => {
    const { app, provider } = buildTestApp({ script: textScript('Videos need 720p [policy-4].') });

    await post(app, 'help', 'ctx-help-0002', 'What resolution does the Level 2 Drone Patrol Video Demo need?');
    await post(app, 'help', 'ctx-help-0002', 'Who submitted it?');

    expect(provider!.calls[1]!.messages[0]!.content).toMatch(/<referenced_items>[\s\S]*"id": "apr-002"/);
  });

  it('Help adds no approval metadata to purely procedural questions', async () => {
    const { app, provider } = buildTestApp({ script: textScript('Steps [policy-2].') });

    await post(app, 'help', 'ctx-help-0003', 'What are the steps to review an approval?');

    expect(provider!.calls[0]!.messages[0]!.content).not.toContain('<referenced_items>');
  });

  it('Chat sees every approval with its current status and is told the queue overrides earlier turns', async () => {
    const { repo, setStatus } = mutableApprovals(await new FixtureApprovalRepository().list());
    const { app, provider } = buildTestApp({ approvals: repo, script: textScript('It is pending.') });

    await post(app, 'chat', 'ctx-chat-0001', 'What is the status of the drone video?');
    setStatus('apr-002', 'approved');
    await post(app, 'chat', 'ctx-chat-0001', 'And now?');

    const system = provider!.calls[1]!.messages[0]!.content;
    expect(system).toMatch(/"id": "apr-002"[^}]*"status": "approved"/);
    expect(system).toMatch(/current queue overrides anything said earlier/i);
    expect(system).toMatch(/never claim a status changed/i);
  });

  it('a status change updates the next Summary and Greeting context', async () => {
    const { repo, setStatus } = mutableApprovals(await new FixtureApprovalRepository().list());
    const { app, provider } = buildTestApp({ approvals: repo, script: textScript('Hi') });

    setStatus('apr-002', 'approved');
    await post(app, 'greeting', 'ctx-greet-0001');
    await post(app, 'summary', 'ctx-greet-0001');

    expect(provider!.calls[0]!.messages[1]!.content).toContain('pendingCount: 3');
    const summaryPrompt = provider!.calls[1]!.messages.map((m) => m.content).join('\n');
    expect(summaryPrompt).toContain('pendingCount: 3');
    expect(summaryPrompt).not.toContain('apr-002');
  });

  it.each(['chat', 'help', 'teach'])('%s is told it only has metadata and must not invent contents, deadlines or severity', async (action) => {
    const { app, provider } = buildTestApp({ script: textScript('ok') });

    await post(app, action, `ctx-rules-${action}`, 'What does the drone video show?');

    const system = provider!.calls[0]!.messages[0]!.content;
    expect(system).toMatch(/have not opened any file/i);
    expect(system).toMatch(/never describe or guess what a folder, video, PDF or image contains/i);
    expect(system).toMatch(/deadlines|severity/i);
  });
});
