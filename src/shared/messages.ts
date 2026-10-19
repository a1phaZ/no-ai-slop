import type { Stats } from './types.ts';

export type Message =
  | { type: 'stats:add'; hidden?: number; manual?: number; labeled?: number; scanned?: number }
  | { type: 'stats:get' }
  | { type: 'stats:reset' };

export interface StatsResponse {
  stats: Stats;
}

export async function sendMessage<T>(message: Message): Promise<T | undefined> {
  try {
    return (await chrome.runtime.sendMessage(message)) as T;
  } catch {
    return undefined;
  }
}
