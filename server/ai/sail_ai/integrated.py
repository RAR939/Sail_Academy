"""Integration facade: persistent FSM, safe Groq explanations, and race reviews."""
from __future__ import annotations
import json
import re
from .engine import FACTS, NPCS
from .adaptive import RACE_EVENT_TOPICS

class IntegratedTutor:
    def __init__(self, engine, guided):
        self.engine = engine
        self.guided = guided

    def dialog(self, npc_id, player_id, text):
        """FSM controls state. Groq may decorate a verified explanation, never change its fact."""
        result = self.guided.dialog(npc_id, player_id, text)
        result['generated'] = False
        result['source'] = None
        fact_ids = result.get('facts') or []
        if result['state'] != 'check' or not fact_ids:
            return result
        fact = next((f for f in FACTS if f['id'] == fact_ids[0]), None)
        if fact is None:
            return result
        result['source'] = fact['text']
        if self.engine.llm is None:
            return result
        # Never ask the LLM to handle commands such as "repeat" as new topics.
        try:
            profile = self.engine.profile(player_id).get(fact['topic'], {})
            generated = self.engine.llm(NPCS[npc_id], text, fact, False, profile, {'phase':'check'})
            if isinstance(generated, str) and fact['text'].strip() in generated and len(generated) <= 2000:
                result['text'] = generated
                result['generated'] = True
        except Exception:
            # Offline/network fallback. Do not expose secrets or third-party errors to players.
            pass
        return result

    def race_report(self, player_id, limit=100):
        """Summarize *recorded* events; the authoritative game server detects them."""
        limit = max(1, min(int(limit), 500))
        with self.engine._db() as db:
            rows = db.execute(
                "SELECT topic,kind,details,created FROM ai_events WHERE player=? "
                "AND kind IN ('race_error','race_success') ORDER BY id DESC LIMIT ?",
                (str(player_id), limit),
            ).fetchall()
        counts = {}
        examples = []
        for row in rows:
            topic = row['topic']
            item = counts.setdefault(topic, {'success':0, 'errors':0})
            item['success' if row['kind'] == 'race_success' else 'errors'] += 1
            if len(examples) < 10:
                try:
                    detail = json.loads(row['details'] or '{}')
                except (ValueError, TypeError):
                    detail = {'details':row['details']}
                examples.append({'topic':topic,'successful':row['kind']=='race_success',
                                 'event':detail.get('event'), 'details':detail.get('details','')})
        profile = self.engine.profile(player_id)
        topics = [{'topic':topic, **values, 'mastery':profile.get(topic,{}).get('mastery',0.2)}
                  for topic,values in sorted(counts.items())]
        weak = sorted(topics,key=lambda x:(x['mastery'],-x['errors']))
        recommendations = [f"Повторить тему «{x['topic']}» и выполнить практическое упражнение." for x in weak[:3]]
        return {'player_id':str(player_id),'events_count':len(rows),'topics':topics,
                'recent_events':examples,'recommendations':recommendations,
                'note':'Оценки BKT приблизительные. Отчёт учитывает только записанные события, не всю гонку.'}
