# Сбор датасета

Всё локально: скрипты ходят в сеть только за данными, обучение и хранение — на машине.
Результаты пишутся в `data/` (в git не попадает — там реальный контент Reddit).

## Быстрый старт (публичные данные)

Основной путь — публичные датасеты: они собираются за минуты и не требуют
Ollama, GPU или чужих меток. Reddit-посты добавляют доменное совпадение, но
arctic-shift медленный и нестабильный, поэтому это опциональный шаг.

```bash
# 1. EN: реальные вопросы Reddit + ответы ChatGPT (HC3)
node training/import-public.mjs --hc3 --max=1500

# 2. RU: CoAT/RuATD, human vs machine
node training/import-public.mjs --coat --coat-split=train --max=2000

# 3. Опционально: SemEval-2024 Task 8 (мультиязычный human vs machine)
#    В train строки сгруппированы по генератору, поэтому для human нужен offset.
node training/import-public.mjs --semeval --semeval-split=train --semeval-offset=2000 --max=3000

# 4. Опционально: человеческие посты Reddit до 11.2022.
#    Идём часовыми окнами; для «тяжёлых» сабреддитов limit=3 и delay=5000.
node training/fetch-human.mjs \
  --subreddits=rust,AskReddit,Pikabu,AskARussian \
  --window-minutes=60 --max-windows=48 --limit=3 --delay=5000 --max-per-sub=300

# 5. Дедуп, баланс, групповые сплиты
node training/dedup.mjs
node training/build-dataset.mjs

# 6. Внешняя оценка на отложенных публичных наборах
node training/import-public.mjs --coat --coat-split=validation --out=data/eval/coat-val.jsonl
node training/import-public.mjs --semeval --semeval-split=test --max=600 --out=data/eval/semeval-test.jsonl
node training/evaluate.mjs --input=data/eval/coat-val.jsonl --all --modes=model,linear

# 7. Обучение: линейная модель и MLP
node training/train.mjs
node training/train-nn.mjs
```

Ollama нужен только если после внешней оценки видно доменный разрыв и хочется
добавить AI-посты, сгенерированные из реальных человеческих промптов:

```bash
ollama pull qwen2.5:3b
node training/generate-ai.mjs --model=qwen2.5:3b --count=300 --lang=ru,en
```

## Что делает каждый скрипт

| скрипт | назначение |
|---|---|
| `fetch-human.mjs` | arctic-shift (зеркало Pushshift). Только посты **до 11.2022**, чтобы в «человеческих» данных не было ChatGPT. Часовые окна, `--limit`, `--max-windows`, `--out`; фильтрует ботов, удалённые, короткие и link-only посты. |
| `import-public.mjs` | HF datasets-server без ключей: HC3 (`--hc3`), CoAT/RuATD (`--coat`), SemEval-2024 Task 8 (`--semeval`). Плюс `--file=` для ручного импорта. Поддерживает `--out`, `--offset` и retry на 429. |
| `generate-ai.mjs` | Ollama, опционально. Матрица: язык × тема × длина × регистр + прогон «сделай человечнее». |
| `dedup.mjs` | Точный дедуп + SimHash (почти-дубликаты), даёт `near_dup` кластеры. |
| `build-dataset.mjs` | Балансировка по языкам и классам, дедуп, групповые сплиты train/val/test. Подхватывает `data/raw/user.jsonl`; `prompt_id` держит вопрос HC3 и ответы в одной группе. |
| `import-labels.mjs` | Экспорт меток из расширения → `data/eval/user.jsonl` (eval) или `data/raw/user.jsonl` (train). |
| `evaluate.mjs` | Метрики текущего детектора на test и eval-метках: confusion matrix, Brier/ECE, срезы, sweep порога, топ ошибок. `--all` — оценить весь внешний набор. |
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
целую группу (`prompt_id` → `author_hash` → `near_dup` → текст) в один сплит.
Для HC3 `prompt_id` — это хэш вопроса, поэтому вопрос и ответы на него не
разъезжаются по разным сплитам.

## Ловушки, которые уже проверены

- **HC3 в одиночку бесполезен для обучения.** Вопросы там короткие, ответы ChatGPT —
  длинные, модель учится на длине и выдаёт идеальные метрики. Поэтому по умолчанию
  импортируются и человеческие ответы (`--no-answers` отключает), а HC3 лучше
  смешивать с CoAT/SemEval и Reddit-постами.
- **CoAT и SemEval — другой домен.** Это news/wiki/HowTo, а не Reddit. Они быстро
  дают EN+RU и хороши для bootstrap, но внешняя оценка на CoAT validation /
  SemEval test обязательна: пилот показал заметный domain gap.
- **SemEval train отсортирован по генератору.** Первые ~2000 строк — AI. Чтобы
  получить human, используйте `--semeval-offset=2000` или импортируйте больше
  строк; `--max` считает уже добавленные строки, а не прочитанные.
- **HF datasets-server отдаёт 429.** `import-public.mjs` повторяет запросы с
  экспоненциальной паузой; при обрыве можно запустить снова — дедуп пропустит
  уже скачанное.
- **Зеркало arctic-shift медленное и с rate-limit.** Часовые окна работают лучше
  дневных, но высоконагруженные сабреддиты всё равно могут отваливаться. Если
  сыпет `Timeout` — уменьшите `--limit` (например, до 3) и увеличьте `--delay`.
  Link-only посты отбрасываются: у них нет текста для детектора.
- **8B на CPU без GPU — это ночь.** 3B терпимо. Разные модели важнее размера.

## Метки пользователей (опционально)

Метки больше не критический путь: базовый датасет собирается из публичных
источников. Свои метки полезны для локальной проверки и персонализации.

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
