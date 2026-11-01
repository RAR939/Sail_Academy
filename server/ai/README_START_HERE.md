# Sail Academy AI — интеграционная сборка 1.0

Это **Python-сервер ИИ**, а не вся 3D-игра. Браузерный клиент и сервер мультиплеера разрабатывает команда.

## Возможности

- Четыре персонажа с отдельными темами и стилем; сохраняемые FSM-диалоги (`/ai/dialog`).
- Ответы на вопросы (`/ai/ask`) через Groq, с резервным ответом из учебной базы; `generated` означает, что генерация **принята**.
- BM25 + словарь фраз (без скачивания эмбеддингов); это **не нейросетевой semantic RAG**.
- SQLite: память NPC, история событий, BKT. Оценки BKT — приблизительные.
- Отчёт по зарегистрированным игровым событиям (`/ai/race-report`). ИИ **не обнаруживает ошибки в 3D-симуляции**: игровой сервер обязан присылать события.
- Bearer-авторизация, REST и WebSocket `/ws/ai` (ответ приходит **целиком**, не настоящий поток токенов).
- 46 автоматических тестов. Реальный Groq API не вызывается в тестах.

## Установка на Ubuntu

```bash
cd ~/Загрузки
mkdir -p sail_ai_final
unzip sail_ai_role2_final.zip -d sail_ai_final
cd sail_ai_final
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-api.txt
cp .env.example .env
nano .env
```

Настройте `GROQ_API_KEY`, `GROQ_MODEL` (например, `qwen/qwen3.8-27b`, **если доступна аккаунту**), `SAIL_AUTH_SECRET`, `SAIL_DEMO_PASSWORD`, `SAIL_SERVER_EVENT_KEY`. Два секрета сгенерируйте отдельно: `python3 -c 'import secrets; print(secrets.token_hex(32))'`. Никогда не публикуйте `.env`.

```bash
set -a; source .env; set +a
python3 -m unittest discover -s sail_ai/tests -v
uvicorn sail_ai.server:app --host 127.0.0.1 --port 8000
```

Второй терминал (сервер оставьте работающим):

```bash
cd ~/Загрузки/sail_ai_final
source .venv/bin/activate
set -a; source .env; set +a
TOKEN=$(curl -fsS http://127.0.0.1:8000/auth/demo-login \
 -H 'Content-Type: application/json' \
 -d "{\"player_id\":\"alice\",\"password\":\"$SAIL_DEMO_PASSWORD\"}" \
 | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])')

curl -sS http://127.0.0.1:8000/ai/dialog \
 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
 -d '{"npcId":"morozov","text":"Привет"}'

curl -sS http://127.0.0.1:8000/ai/dialog \
 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
 -d '{"npcId":"morozov","text":"Бейдевинд"}'

curl -sS http://127.0.0.1:8000/ai/ask \
 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
 -d '{"npcId":"morozov","text":"Что такое бейдевинд?"}'

curl -sS http://127.0.0.1:8000/ai/race-report -H "Authorization: Bearer $TOKEN"
```

Swagger: http://127.0.0.1:8000/docs

## Событие от игрового сервера

Только сервер игры (не браузер игрока) отправляет подтверждённые события:

```bash
curl -sS http://127.0.0.1:8000/internal/race-event \
 -H "X-Server-Key: $SAIL_SERVER_EVENT_KEY" \
 -H 'Content-Type: application/json' \
 -d '{"player_id":"alice","event_type":"no_go_zone","details":"Попытка идти против ветра","successful":false}'
```

Повторите `/ai/race-report`: появится ошибка по теме «курсы» и рекомендация.

## Контракт API для команды

| Метод | URL | Тело / ответ |
|---|---|---|
| POST | `/auth/demo-login` | `{"player_id":"alice","password":"..."}` → `access_token` |
| POST | `/ai/dialog` | Bearer + `{"npcId":"morozov","text":"Привет"}` → `{text,state,topic,facts,events,generated,source}` |
| POST | `/ai/ask` | Bearer + тот же JSON → `{text,state,facts,generated,source}` |
| GET | `/ai/npcs` | Bearer → NPC и темы |
| GET | `/ai/profile` | Bearer → профиль и рекомендация |
| GET | `/ai/race-report` | Bearer → агрегированный отчёт по сохранённым событиям |
| POST | `/internal/race-event` | `X-Server-Key` + `{"player_id":"...","event_type":"no_go_zone","successful":false}` |
| WS | `/ws/ai` | После соединения `{"type":"auth","token":"..."}` → `auth_ok`; затем `{"type":"dialog","npcId":"morozov","text":"Привет"}` или `type:"ask"` → `{"type":"reply","data":{...}}` |
| GET | `/health` | Статус сервиса (не проверяет доступность Groq) |

NPC IDs: `morozov`, `anna`, `li`, `mikhalych`.

Типы событий: `no_go_zone`, `wrong_sail_trim`, `failed_tack`, `port_starboard_violation`, `early_start`, `gust_misjudgment`, `capsize_safety`.

## Ограничения и безопасность

1. **Groq требует интернет**. Если ТЗ требует строго offline, нужна локальная модель либо разрешение на изменение ТЗ.
2. Демонстрационная авторизация — **не** полноценная регистрация пользователей: общий пароль позволяет запросить токен с произвольным `player_id`. Для сдачи/продакшена заменить на авторизацию команды, использовать HTTPS/WSS вне доверенной LAN и ограничить доступ к `/internal/race-event`.
3. Groq может ошибаться. Наличие исходного определения в сгенерированном тексте — базовая проверка, **не гарантия достоверности всех добавленных фраз**. При критичных учебных ответах показывайте `source`.
4. Ответы WS возвращаются целиком после генерации; настоящий upstream token streaming пока не реализован.
5. Для семантического RAG с эмбеддингами потребуется отдельная модель или API эмбеддингов. В этой сборке используется BM25 + расширение фраз.
6. Не коммитьте `.env`, `.sqlite3`, `.venv` в Git.
