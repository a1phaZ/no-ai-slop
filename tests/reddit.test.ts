import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';

import { collectPosts } from '../src/content/reddit.ts';

function doc(html: string): ParentNode {
  const window = new Window();
  window.document.body.innerHTML = html;
  return window.document as unknown as ParentNode;
}

test('находит shreddit-post: заголовок из атрибута, тело из слота', () => {
  const document = doc(`
    <shreddit-post id="t3_a" post-title="Hello world">
      <div slot="text-body">This is the body text.</div>
    </shreddit-post>`);

  const posts = collectPosts(document, false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].id, 't3_a');
  assert.equal(posts[0].title, 'Hello world');
  assert.equal(posts[0].body, 'This is the body text.');
});

test('тело берётся из div[id$="-post-rtjson-content"] как фолбэк', () => {
  const document = doc(`
    <shreddit-post id="t3_b" post-title="Title B">
      <div id="t3_b-post-rtjson-content">Body B</div>
    </shreddit-post>`);

  const posts = collectPosts(document, false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body, 'Body B');
});

test('заголовок берётся из [slot="title"] как фолбэк', () => {
  const document = doc(`
    <shreddit-post id="t3_c">
      <h1 slot="title">Fallback title</h1>
      <div slot="text-body">Body C</div>
    </shreddit-post>`);

  const posts = collectPosts(document, false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Fallback title');
});

test('фолбэк-контейнер используется, когда shreddit-post нет', () => {
  const document = doc(`
    <div data-testid="post-container" id="t3_d">
      <div slot="title">Legacy title</div>
      <div slot="text-body">Legacy body</div>
    </div>`);

  const posts = collectPosts(document, false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Legacy title');
  assert.equal(posts[0].body, 'Legacy body');
});

test('old.reddit .thing.link собирается только при includeOld', () => {
  const document = doc(`
    <div class="thing link" id="thing_t3_e">
      <a class="title">Old title</a>
      <div class="usertext-body"><div class="md">Old body</div></div>
    </div>`);

  assert.equal(collectPosts(document, false).length, 0);

  const posts = collectPosts(document, true);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Old title');
  assert.equal(posts[0].body, 'Old body');
});

test('посты без текста отфильтровываются', () => {
  const document = doc(`
    <shreddit-post id="t3_f" post-title="Only title"></shreddit-post>
    <shreddit-post id="t3_g"></shreddit-post>`);

  const posts = collectPosts(document, false);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].title, 'Only title');
});
