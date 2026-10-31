# Sail Academy — локальный ИИ (роль 2)

Готовый автономный базовый модуль: 4 NPC, персональные стили, поиск BM25 по небольшому авторскому корпусу, память фактов, простая оценка освоения по успехам/ошибкам, события гонки, рекомендации и потоковая выдача фрагментов ответа. Не требует интернета, GPU или сторонних Python-пакетов для `Engine`.

## Быстрая проверка
Из каталога **над** `sail_ai`:

```bash
python -m unittest discover -s sail_ai/tests -v
python -c "from sail_ai import Engine; e=Engine('demo_ai.sqlite3'); print(e.dialog('morozov','demo','что такое бейдевинд'))"
```

Примечание: SQLite `:memory:` открывается заново для каждого соединения, поэтому для постоянной памяти используйте путь к файлу (по умолчанию `sail_ai.sqlite3`). Для демонстрации без сохранения можно использовать временный файл.

## Интеграция с сервером команды

```python
from sail_ai.api import router, engine
app.include_router(router)
# Сервер обязан предоставить функцию, проверяющую токен текущего HTTP-запроса:
app.state.authenticated_user = your_existing_auth_dependency
```

`POST /ai/dialog` принимает `{"npcId":"morozov","text":"что такое бейдевинд","context":{}}`. `player_id` **всегда** определяется сервером по проверенному токену, а не доверяется клиенту. Ответ: `{npcId,text,state,facts,events,quiz}`. `POST /ai/event` принимает `{topic,kind,details}`; вызывать из авторитетной серверной логики гонки, не доверять событиям от браузера. `GET /ai/profile` возвращает прогресс и рекомендацию.

Для WebSocket после успешной авторизации: на `npc_say {npcId,text}` получить player_id из авторизованной сессии и выполнить `for msg in engine.stream(npcId,player_id,text): await websocket.send_json(msg)`. Сериализовать генерации через серверную очередь (`asyncio.Queue`/worker); для блокирующих вычислений использовать thread pool. Текущий `stream` выдаёт слова шаблонного ответа, а не токены LLM. Не создавать отдельный неавторизованный WS.

## Ограничения и развитие

- Это **рабочий offline fallback**, а не полноценная LLM: формулировки варьируются по памяти, но не генерируются нейросетью. Поле `llm` зарезервировано, не подключено. Для настоящего Qwen потребуется отдельный локальный адаптер Ollama/llama.cpp и офлайн-веса.
- Корпус — 9 кратких учебных фактов, написанных для прототипа; это не полный официальный текст ППГ 2025–2028. Перед оценкой сложных ситуаций дополнять проверенными лицензированными источниками.
- Оценка освоения — сглаженная доля успехов, **не** Bayesian Knowledge Tracing; коллаборативная фильтрация не реализована, рекомендации по правилам.
- Состояния диалога `choose`, `explain`, `bye` — сокращённый FSM; квизы сознательно отложены согласно P3 ТЗ.
- Лимит 3 секунды до первого токена, 60 FPS, 3–4 клиента и расход памяти **не проверены** в составе игры.
- ТЗ называет Babylon.js, а описание задания — three.js. Это относится к клиентской роли; ИИ-модуль не зависит от 3D-движка.

## Ollama integration (update)

The original engine remains the default and works with no model. To enable local Qwen
in the FastAPI router, set `SAIL_AI_LLM=1` before launching the server. Optional:
`SAIL_AI_MODEL=qwen2.5:3b`. Ollama must be running locally on 127.0.0.1:11434.
No remote endpoints are used. On connection failure or timeout the engine returns
its deterministic fact-based answer. The Ollama request is synchronous: run it in
a worker thread/queue in the game server, not on the WebSocket event loop.
The existing `stream()` yields chunks *after* generation, not true live Ollama tokens.
LLM responses are not formally fact-verified; for high-stakes rule accuracy use
fallback mode and show the `source` field alongside generated explanations.

Quick local test from the parent directory:

```bash
python3 -m unittest discover -s sail_ai/tests -v
python3 - <<'PY'
from sail_ai.engine import Engine
from sail_ai.ollama import Ollama
ai=Engine('/tmp/sail_ai_demo.sqlite3', llm=Ollama())
print(ai.dialog('morozov','demo-user','Что такое бейдевинд?'))
PY
```

## Adaptive learning extension

`Engine.record_event(player, topic, kind, details)` updates an illustrative BKT estimate in `ai_bkt` (initial 0.2, slip 0.1, guess 0.2, learning 0.12). These parameters are **not calibrated** against real students. A success increases mastery; an error generally lowers it, though the learning transition can soften the decrease. Existing SQLite files are extended automatically; old aggregate event counters are not retroactively converted to BKT estimates.

`Engine.record_race_event(player, event_type, details, successful=False)` accepts:
`no_go_zone`, `wrong_sail_trim`, `failed_tack`, `port_starboard_violation`, `early_start`, `gust_misjudgment`, `capsize_safety`.
This is an **event consumer**, not a detector: the authoritative game server must detect and validate the event and supply the authenticated player ID. Do not expose an unrestricted client-facing success/error endpoint as a trusted assessment source. `Engine.recent_errors(player, topic)` returns recent mistakes. `Engine.profile(player)` returns `mastery` per observed topic. `Engine.recommend(player)` picks the weakest topic by rules, not collaborative filtering.

Example:
```python
from sail_ai.engine import Engine
ai = Engine('demo.sqlite3')
ai.record_race_event('player-1','no_go_zone','attempted to sail into wind')
print(ai.profile('player-1'))
print(ai.dialog('morozov','player-1','Что такое бейдевинд?')['text'])
```

For an authenticated backend, call `record_race_event` only after server-side race-event validation. `api.py`'s existing `/ai/event` is a preliminary integration hook and should be restricted to trusted game logic before production. LLM output remains conservatively grounded, and the current `stream()` splits a completed answer rather than streaming inference tokens.
