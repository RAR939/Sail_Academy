# Sail Academy AI — готовый модуль для интеграции в репозиторий

## Изменения
- NPC объясняют правила гонок естественным языком с помощью Groq, используя найденные выдержки из ППГ-25 как контекст.
- В ответах не требуется показывать страницы или номера правил (метаданные `references` остаются доступны для диагностики).
- В случае отсутствия Groq/сбоя сети используется текстовый фрагмент из источника; `generated: false` в таком случае ожидаем.
- `/ai/dialog`, `/ai/ask`, `/ai/rules/ask` и WebSocket используют общий механизм ответов на вопросы о гоночных правилах.
- В запросе `/ai/rules/ask` используется поле `text`, не `question`.

## Запуск (Python 3.11+)
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-api.txt
cp .env.example .env
# Внести GROQ_API_KEY, GROQ_MODEL и серверные секреты в .env; НЕ коммитить .env
set -a; source .env; set +a
uvicorn sail_ai.server:app --host 127.0.0.1 --port 8000
```
Если уже есть настроенный `.env`, перенесите его вручную в корень проекта.

## Проверка
```bash
python -m unittest discover -s sail_ai/tests -v
```
Получите токен через `/auth/demo-login`, затем:
```bash
curl -X POST http://127.0.0.1:8000/ai/rules/ask \
 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
 -d '{"text":"Кто должен уступить при встрече яхт на разных галсах?","npcId":"morozov"}'
```
При доступном Groq ожидается `generated: true`. При недоступном API будет безопасный резервный ответ (`generated: false`).

## Git
```bash
git status --short
git add sail_ai README*.md requirements-api.txt .env.example .gitignore
git status --short # убедитесь, что .env и *.sqlite3 не попали в индекс
git commit -m "Add contextual sailing rules NPC tutor with Groq"
git push origin YOUR_BRANCH
```

## Ограничения
- Ответ Groq опирается на найденные выдержки, но не проходит автоматическую фактологическую верификацию; не используйте как решение гоночного протеста.
- PDF содержит редакторские исправления; окончательная редакция правил имеет приоритет.
- `/auth/demo-login` — демонстрационная авторизация, не предназначена для публичного продакшена.
- Текущая маршрутизация вопросов к ППГ использует эвристики: нестандартные формулировки могут попасть в обычный обучающий диалог.
- Для работы в команде интегрируйте модуль в отдельной ветке, не перезаписывая чужие файлы без сравнения.
