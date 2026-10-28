export interface PostNode {
  el: HTMLElement;
  /**
   * Что размывать/скрывать при срабатывании: тело статьи, медиа-превью или
   * миниатюра. `null` — скрывать нечего (например, голая ссылка).
   * Заголовок сюда не входит никогда.
   */
  contentEl: HTMLElement | null;
  id: string;
  title: string;
  body: string;
}

const BODY_SELECTORS = [
  '[slot="text-body"]',
  'div[id$="-post-rtjson-content"]',
  '[data-post-click-location="text-body"]',
  '.md',
];

const MEDIA_SELECTORS = [
  '[slot="post-media-container"]',
  'shreddit-post-media',
  'shreddit-player-2',
  'shreddit-gallery-carousel',
  '[slot="thumbnail"]',
  'shreddit-thumbnail',
];

const OLD_BODY_SELECTORS = ['.usertext-body .md', '.md'];
const OLD_MEDIA_SELECTORS = ['.expando', '.media-preview', '.thumbnail'];

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function firstWithText(el: HTMLElement, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const node = el.querySelector<HTMLElement>(selector);
    if (node && textOf(node)) return node;
  }
  return null;
}

function firstExisting(el: HTMLElement, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const node = el.querySelector<HTMLElement>(selector);
    if (node) return node;
  }
  return null;
}

function fromShreddit(el: HTMLElement): PostNode {
  const attr = el.getAttribute('post-title');
  const title = (attr || textOf(el.querySelector('[slot="title"]'))).trim();
  const bodyEl = firstWithText(el, BODY_SELECTORS);
  return {
    el,
    contentEl: bodyEl ?? firstExisting(el, MEDIA_SELECTORS),
    id: el.id || title,
    title,
    body: textOf(bodyEl),
  };
}

function fromOldReddit(el: HTMLElement): PostNode {
  const title = textOf(el.querySelector('a.title'));
  const bodyEl = firstWithText(el, OLD_BODY_SELECTORS);
  return {
    el,
    contentEl: bodyEl ?? firstExisting(el, OLD_MEDIA_SELECTORS),
    id: el.id || title,
    title,
    body: textOf(bodyEl),
  };
}

/** Собирает посты со страницы Reddit (новый интерфейс + опционально old.reddit). */
export function collectPosts(root: ParentNode, includeOld: boolean): PostNode[] {
  const modern = Array.from(root.querySelectorAll<HTMLElement>('shreddit-post'));
  let posts: PostNode[] = modern.map(fromShreddit);

  if (posts.length === 0) {
    const legacy = Array.from(
      root.querySelectorAll<HTMLElement>(
        'div[data-testid="post-container"], div[id^="t3_"]',
      ),
    );
    posts = legacy.map(fromShreddit);
  }

  if (includeOld) {
    const old = Array.from(root.querySelectorAll<HTMLElement>('.thing.link, .thing'));
    posts.push(...old.map(fromOldReddit));
  }

  return posts.filter((p) => (p.title + p.body).trim().length > 0);
}
