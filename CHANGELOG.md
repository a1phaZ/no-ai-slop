# Changelog

Все заметные изменения проекта. Формат — по [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/),
версии — по [SemVer](https://semver.org/lang/ru/).

## [0.2.1] - 2026-10-19

### Добавлено
- Иконки расширения 16/32/48/128 и `scripts/gen-icons.mjs` (генерация PNG без зависимостей).
- CI (`.github/workflows/ci.yml`): typecheck, тесты, сборка, артефакт `dist/`.
- Release-workflow (`.github/workflows/release.yml`): сборка `.zip` по тегу `v*`.
- `scripts/package.mjs` + `npm run package` — сборка `.zip` для Chrome Web Store.
- DOM-тесты content-слоя (`happy-dom`): `tests/reddit.test.ts`, `tests/ui.test.ts`.
- Документы: `LICENSE` (MIT), `CHANGELOG.md`, `PRIVACY.md`.

## [0.2.0] - 2026-10-19

### Добавлено
- Контрол с оценкой **AI ~NN%** и кнопкой **«Возможно AI»** на каждом посте.
- Счётчик «проверено» в popup; лог `[no-ai-slop]` при включённом debug.
- Фолбэки селекторов для нового и старого интерфейса Reddit.
- Обработка ошибок инициализации (фолбэк на настройки по умолчанию).

### Изменено
- Перекалиброван детектор: признаки применяются к короткому тексту, порог по умолчанию 0.6 → 0.55.
- `DETECTOR_VERSION` 1 → 2 (старый кэш инвалидируется автоматически).

## [0.1.0] - 2026-10-19

### Добавлено
- Chrome MV3 расширение: локальная детекция AI-постов на Reddit (EN + RU).
- Эвристики: шаблонные фразы, ритм предложений, пунктуация, сокращения, длинное тире, списки.
- Локальный кэш проверок, счётчики и badge, popup и страница настроек.

[0.2.1]: https://github.com/a1phaZ/no-ai-slop/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/a1phaZ/no-ai-slop/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/a1phaZ/no-ai-slop/releases/tag/v0.1.0
