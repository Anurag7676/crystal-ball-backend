import type { Response } from 'supertest';
import { SseEventSchemas, type SseEventName } from '../../src/schemas/ai.schema';

export interface ParsedEvent {
  event: SseEventName;
  data: unknown;
}

/**
 * Parses a complete SSE body and validates every event payload against the published
 * contract — so any drift in event shape fails the test that produced it.
 */
export function parseSse(body: string): ParsedEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.trim())
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))?.slice(7) as SseEventName;
      const data = JSON.parse(
        lines
          .filter((l) => l.startsWith('data: '))
          .map((l) => l.slice(6))
          .join('\n'),
      );
      const schema = SseEventSchemas[event];
      if (!schema) throw new Error(`Unknown SSE event: ${event}`);
      return { event, data: schema.parse(data) };
    });
}

export const eventsOf = (res: Response) => parseSse(res.text);
export const names = (events: ParsedEvent[]) => events.map((e) => e.event);
export const find = <E extends SseEventName>(events: ParsedEvent[], name: E) =>
  events.find((e) => e.event === name)?.data as Record<string, unknown> | undefined;
export const deltaText = (events: ParsedEvent[]) =>
  events
    .filter((e) => e.event === 'delta')
    .map((e) => (e.data as { text: string }).text)
    .join('');
