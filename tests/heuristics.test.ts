import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractFeatures, scoreText } from '../src/detector/heuristics.ts';

const AI_EN = [
  "In today's fast-paced world, building a scalable product is more important than ever.",
  "It's important to note that successful teams don't just ship features — they build systems.",
  'Furthermore, a robust architecture allows you to navigate the complexities of growth.',
  'Moreover, you should leverage cutting-edge tools to unlock the potential of your team.',
  'In conclusion, embrace a holistic approach and elevate your workflow today.',
].join(' ');

const AI_RU = [
  'В современном мире технологии играют важную роль.',
  'Важно отметить, что эффективное решение требует комплексного подхода.',
  'Более того, стоит подчеркнуть необходимость непрерывного развития.',
  'Таким образом, только системный подход открывает новые возможности.',
].join(' ');

const HUMAN_CASUAL =
  "lol i tried this last night tbh, it kinda worked but the setup was a pain. " +
  "gonna mess with it more tomorrow. idk if it's worth the price though";

const HUMAN_INFO =
  "I've been running this on my home server for a month. Setup took about two hours, " +
  'mostly fighting DNS. Once it worked it was rock solid. Would I recommend it? ' +
  'Probably — if you like tinkering.';

const HUMAN_TYPICAL =
  "I bought this keyboard about three months ago and I'm honestly impressed. " +
  "The switches feel great, though it's a bit loud for an office. " +
  'Battery life is solid, I charge it maybe once a week. Would I buy it again? Yeah, probably.';

const AI_UNIFORM =
  'Building a reliable software system requires careful long term planning and consistent disciplined execution from the team. ' +
  'Teams that consistently document their important architectural decisions tend to move noticeably faster over time. ' +
  'Clear ownership of every component reduces confusion during high pressure incidents and public releases. ' +
  'Regular and honest retrospectives help identify emerging problems long before they have a chance to grow. ' +
  'A genuine culture of continuous learning ultimately determines the long term success of a project.';

test('AI-текст (EN) оценивается выше порога', () => {
  const { score } = scoreText(AI_EN);
  assert.ok(score >= 0.6, `expected >= 0.6, got ${score}`);
});

test('AI-текст (RU) оценивается выше порога', () => {
  const { score } = scoreText(AI_RU);
  assert.ok(score >= 0.6, `expected >= 0.6, got ${score}`);
});

test('разговорный человеческий текст — ниже порога', () => {
  const { score } = scoreText(HUMAN_CASUAL);
  assert.ok(score < 0.5, `expected < 0.5, got ${score}`);
});

test('информационный человеческий текст — ниже порога', () => {
  const { score } = scoreText(HUMAN_INFO);
  assert.ok(score < 0.6, `expected < 0.6, got ${score}`);
});

test('типичный человеческий пост — ниже порога', () => {
  const { score } = scoreText(HUMAN_TYPICAL);
  assert.ok(score < 0.45, `expected < 0.45, got ${score}`);
});

test('стилистически ровный текст без маркеров получает заметную оценку', () => {
  const { score } = scoreText(AI_UNIFORM);
  assert.ok(score >= 0.5, `expected >= 0.5, got ${score}`);
});

test('короткий текст с фразой-маркером выше нейтрального короткого', () => {
  const marker = scoreText("It's important to note that this changes everything.");
  const neutral = scoreText('I fixed the bug this morning.');
  assert.ok(marker.score > neutral.score, `${marker.score} <= ${neutral.score}`);
});

test('прямое упоминание ИИ даёт высокую оценку', () => {
  const { score } = scoreText('As an AI language model, I can help you with that.');
  assert.ok(score > 0.85, `expected > 0.85, got ${score}`);
});

test('пустой/короткий текст не помечается', () => {
  const { score } = scoreText('ok');
  assert.ok(score < 0.4, `expected < 0.4, got ${score}`);
});

test('признаки: разговорные маркеры фиксируются', () => {
  const features = extractFeatures(HUMAN_CASUAL);
  assert.ok(features.informalHits >= 3, `informalHits=${features.informalHits}`);
});

test('признаки: шаблонные фразы фиксируются', () => {
  const features = extractFeatures(AI_EN);
  assert.ok(features.markerHits >= 3, `markerHits=${features.markerHits}`);
});
