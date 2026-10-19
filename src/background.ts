import type { Message, StatsResponse } from './shared/messages.ts';
import type { Stats } from './shared/types.ts';
import { DEFAULT_STATS, loadStats, saveStats } from './shared/storage.ts';

function badgeText(stats: Stats): string {
  if (stats.hidden > 999) return '999+';
  const dot = stats.manual > 0 ? '•' : '';
  if (stats.hidden > 0) return `${stats.hidden}${dot}`;
  return stats.manual > 0 ? '•' : '';
}

async function renderBadge(stats: Stats): Promise<void> {
  await chrome.action.setBadgeText({ text: badgeText(stats) });
  await chrome.action.setBadgeBackgroundColor({
    color: stats.manual > 0 ? '#d97706' : '#4b5563',
  });
  await chrome.action.setTitle({
    title: `no-ai-slop — скрыто: ${stats.hidden}, вручную помечено: ${stats.manual}`,
  });
}

function applyDelta(base: Stats, delta: { hidden?: number; manual?: number; scanned?: number }): Stats {
  return {
    hidden: Math.max(0, base.hidden + (delta.hidden ?? 0)),
    manual: Math.max(0, base.manual + (delta.manual ?? 0)),
    scanned: Math.max(0, base.scanned + (delta.scanned ?? 0)),
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as Message;
  void (async () => {
    if (msg.type === 'stats:get') {
      const response: StatsResponse = { stats: await loadStats() };
      sendResponse(response);
      return;
    }
    if (msg.type === 'stats:reset') {
      await saveStats({ ...DEFAULT_STATS });
      await renderBadge(DEFAULT_STATS);
      sendResponse({ stats: { ...DEFAULT_STATS } } satisfies StatsResponse);
      return;
    }
    if (msg.type === 'stats:add') {
      const next = applyDelta(await loadStats(), msg);
      await saveStats(next);
      await renderBadge(next);
      sendResponse({ stats: next } satisfies StatsResponse);
      return;
    }
    sendResponse(undefined);
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  void loadStats().then(renderBadge);
});

void loadStats().then(renderBadge);
