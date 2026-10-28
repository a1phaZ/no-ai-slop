# Сбор датасета

Всё локально: скрипты ходят в сеть только за данными, обучение и хранение — на машине.
Результаты пишутся в `data/` (в git не попадает — там реальный контент Reddit).

## Быстрый старт (MVP)

```bash
# 1. Человеческие посты Reddit до эпохи ChatGPT (без ключей)
node training/fetch-human.mjs --subreddits=rust,AskReddit --max-per-sub=300

# 2. Публичный датасет: реальные вопросы Reddit + ответы ChatGPT
node training/import-public.mjs --hc3 --max=1500

# 3. AI-посты локально через Ollama (поставьте модели заранее)
ollama pull qwen2.5:3b
node training/generate-ai.mjs --model=qwen2.5:3b --count=300 --lang=ru,en

# 4. Дедуп, баланс, групповые сплиты
node training/dedup.mjs
node training/build-dataset.mjs

# 5. Оценка текущего детектора на test и метках пользователей
node training/evaluate.mjs

# 6. Обучение: линейная модель и MLP
node training/train.mjs
node training/train-nn.mjs
```

## Что делает каждый скрипт

| скрипт | назначение |
|---|---|
| `fetch-human.mjs` | arctic-shift (зеркало Pushshift). Только посты **до 11.2022**, чтобы в «человеческих» данных не было ChatGPT. Фильтрует ботов, удалённые и слишком короткие посты. |
| `import-public.mjs` | HC3 `reddit_eli5` через HF datasets-server (без ключей). Плюс `--file=` для вручную скачанных RuATD / SemEval M4. |
| `generate-ai.mjs` | Ollama. Матрица: язык × тема × длина × регистр + прогон «сделай человечнее». |
| `dedup.mjs` | Точный дедуп + SimHash (почти-дубликаты), даёт `near_dup` кластеры. |
| `build-dataset.mjs` | Балансировка по языкам и классам, дедуп, групповые сплиты train/val/test. Подхватывает `data/raw/user.jsonl`. |
| `import-labels.mjs` | Экспорт меток из расширения → `data/eval/user.jsonl` (eval) или `data/raw/user.jsonl` (train). |
| `evaluate.mjs` | Метрики текущего детектора на test и eval-метках: confusion matrix, Brier/ECE, срезы, sweep порога, топ ошибок. |
| `train.mjs` | Линейная модель: L2, temperature scaling, precision-first порог, метрики по срезам. |
| `train-nn.mjs` | MLP 20 → hidden → 1: early stopping, temperature scaling, precision-first порог. |

## Схема строки

```json
{"title":"...","text":"...","label":0,"lang":"ru","source":"reddit",
 "generator":null,"prompt_id":null,"subreddit":"rust","created_utc":1641000000,
 "author_hash":"a1b2c3d4","near_dup":"c42","split":"train"}
```

## Почему сплиты групповые

Если резать случайно, почти-дубликаты и посты одного автора попадут и в train,
и в test — метрики станут красивыми и бесполезными. `build-dataset.mjs` кладёт
целую группу (`author_hash` → `near_dup` → текст) в один сплит.

## Ловушки, которые уже проверены

- **HC3 в одиночку бесполезен для обучения.** Вопросы там короткие, ответы ChatGPT —
  длинные, модель учится на длине и выдаёт идеальные метрики. Поэтому по умолчанию
  импортируются и человеческие ответы (`--no-answers` отключает), а основной
  источник human — реальные посты Reddit.
- **Зеркало arctic-shift медленное и с rate-limit.** Скрипт идёт окнами по дню,
  делает паузы и ретраи. Если сыпет `Timeout` — увеличьте `--delay`.
- **8B на CPU без GPU — это ночь.** 3B терпимо. Разные модели важнее размера.

## Метки пользователей

Экспорт из настроек расширения:

```bash
# только оценка на реальных данных, в обучение не попадает
node training/import-labels.mjs --file=~/Downloads/no-ai-slop-labels-20261019.jsonl

# после ~200 меток — можно добавить в обучение
node training/import-labels.mjs --file=... --mode=train --user-weight=2
```

- По умолчанию (`--mode=eval`) метки идут в `data/eval/user.jsonl`: это честная
  проверка на «настоящей жизни», а не подмешивание в обучение.
- `--mode=train` пишет `data/raw/user.jsonl`. Пока меток меньше 200, скрипт
  всё равно оставляет их в eval; `--force` снимает предохранитель.
- `build-dataset.mjs` подхватывает `data/raw/user.jsonl` автоматически, дедупит
  по тексту и назначает групповые сплиты. Пользовательские строки получают
  `source=user` и `sample_weight` (по умолчанию 1, задаётся `--user-weight`).
- Метки не отправляются автоматически: только ручной экспорт JSONL.

## Калибровка и порог

- Вероятности калибруются temperature scaling на validation (`temperature` в весах).
- Порог выбирается **precision-first**: максимум recall при precision ≥ 0.9
  (`--min-precision`). Если такого порога нет — откат на максимум F1.
- `evaluate.mjs` печатает Brier/ECE, sweep порога и срезы по языку, источнику
  и длине текста. Отчёт — `data/eval/report.json` без текстов постов.
- Рекомендуемый порог виден в настройках расширения в карточке модели.

## Ограничения

- Данные Reddit не публикуются и не коммитятся. `data/` в `.gitignore`.
- `author` хранится только как хэш.
- Сгенерированные тексты принадлежат вам; фиксируйте модель и дату.
