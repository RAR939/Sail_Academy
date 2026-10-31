# Sail Academy — FSM fix + hybrid retrieval

## Изменения
- `повтори`, `повторить`, `ещё раз`, `напомни` повторяют **тот же факт**, включая после перезапуска.
- Добавлен `Engine.search_hybrid`: BM25 + словарь смысловых фраз, без сетевых запросов и дополнительных зависимостей. Это **не эмбеддинги**; полноценный semantic RAG ещё предстоит реализовать.
- В FSM поиск вопроса использует `search_hybrid`; режим LLM через `Engine.dialog` остаётся отдельным.
- Добавлены регрессионные тесты.

## Запуск
Из каталога с папкой `sail_ai`:

```bash
python3 -m unittest discover -s sail_ai/tests -v
```

## Пример
```python
from sail_ai.engine import Engine
from sail_ai.fsm import GuidedDialog
chat=GuidedDialog(Engine('demo.sqlite3'))
for msg in ['Привет','Бейдевинд','Непонятно','Повтори']:
    print(msg, chat.dialog('morozov','demo_player',msg))
```

## Ограничения
Это промежуточный этап: полноценные multilingual-эмбеддинги, проверка смысловой достоверности генерации, стриминг LLM и интеграция с сервером игры пока не реализованы.
