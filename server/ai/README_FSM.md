# Sail Academy: FSM upgrade

Additive module: `sail_ai.fsm.GuidedDialog`. Existing `Engine.dialog`, API and 22 tests remain unchanged. This is an opt-in guided conversation flow, not yet wired to the team WebSocket gateway.

Run from directory containing `sail_ai`:

```bash
python3 -m unittest discover -s sail_ai/tests -v
```

Example:

```python
from sail_ai.engine import Engine
from sail_ai.fsm import GuidedDialog
engine = Engine('sail_ai.sqlite3')
chat = GuidedDialog(engine)
for msg in ('привет', 'бейдевинд', 'непонятно', 'повтори', 'понятно', 'пока'):
    print(msg, '=>', chat.dialog('morozov', 'player1', msg)['text'])
```

States: greeting -> choose -> check (after explanation) -> feedback -> choose; bye. Explanation is an action that immediately enters check. All state persisted in `ai_fsm` SQLite table per (player, npc). Teaching facts are verbatim from `facts.json`. `понятно` is self-report, not counted as a verified success in BKT. Existing race event methods remain available.

Limitations: keyword-based topic recognition, no graded quiz, no actual model token streaming, no embedding search, and no server integration. The original API still uses `Engine.dialog`. Integrators can call `GuidedDialog(engine).dialog(...)` from their authenticated server handler.
