# no-ai-slop

Chrome-расширение, которое скрывает посты, сгенерированные ИИ, в ленте Reddit.

Проверка и результат держатся **локально**: текст не покидает браузер.

## Возможности

- Локальная оценка «AI-вероятность» (0..1) по тексту поста (EN + RU).
- Порог уверенности задаёт пользователь (по умолчанию 0.55).
- Два режима: **заблюрить** (с кнопкой «Показать») или **скрыть**.
- Оценка `AI ~NN%` и кнопка **«Возможно AI»** — на каждом посте.
- Счётчик скрытых постов на иконке; точка — есть ручные метки.
- Кэш проверок, чтобы один и тот же текст не проверялся повторно.

## Установка

Готовый `.zip` — в [Releases](https://github.com/a1phaZ/no-ai-slop/releases).
Локально: собрать (`npm run build`) и загрузить папку `dist/` через
`chrome://extensions` → «Загрузить распакованное».

## Разработка

Требуется Node.js ≥ 22.

```bash
npm install
npm run build      # собрать расширение в dist/
npm run watch      # пересборка на изменениях
npm test           # юнит- и DOM-тесты
npm run typecheck  # проверка типов
npm run package    # no-ai-slop-<version>.zip для Chrome Web Store
npm run icons      # перегенерировать иконки (src/icons/*.png)
```

## Структура

- `src/detector/` — эвристики и кэш (чистые функции, без `chrome`).
- `src/content/` — извлечение постов и применение решения.
- `src/background.ts` — счётчики и badge.
- `src/popup/`, `src/options/` — интерфейс.
- `src/icons/` — иконки (генерируются `scripts/gen-icons.mjs`).
- `scripts/` — сборка (`build.mjs`), упаковка (`package.mjs`), иконки, ZIP-писатель.
- `SPEC.md` — спецификация; `CHANGELOG.md` — история версий.

## CI/CD

- `ci.yml` — на push/PR в `main`: typecheck, тесты, сборка, артефакт `dist/`.
- `release.yml` — по тегу `v*`: сборка `.zip` и публикация в GitHub Release.

## Приватность

Никаких сетевых запросов. Настройки — в `storage.sync`, кэш и счётчики — в
`storage.local`. Подробнее — в [PRIVACY.md](PRIVACY.md).

## Лицензия

[MIT](LICENSE).
