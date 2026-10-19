export interface PostNode {
  el: HTMLElement;
  id: string;
  title: string;
  body: string;
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function firstText(el: HTMLElement, selectors: string[]): string {
  for (const selector of selectors) {
    const text = textOf(el.querySelector(selector));
    if (text) return text;
  }
  return '';
}

function fromShreddit(el: HTMLElement): PostNode {
  const attr = el.getAttribute('post-title');
  const title = (attr || textOf(el.querySelector('[slot="title"]'))).trim();
  const body = firstText(el, [
    '[slot="text-body"]',
    'div[id$="-post-rtjson-content"]',
    '[data-post-click-location="text-body"]',
    '.md',
  ]);
  return { el, id: el.id || title, title, body };
}

function fromOldReddit(el: HTMLElement): PostNode {
  const title = textOf(el.querySelector('a.title'));
  const body = firstText(el, ['.usertext-body .md', '.md']);
  return { el, id: el.id || title, title, body };
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
