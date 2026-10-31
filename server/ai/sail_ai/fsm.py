"""Persistent guided NPC conversations; no external dependencies or network."""
from __future__ import annotations
import json
from .engine import NPCS, FACTS

TOPIC_ALIASES = {
 "курсы": ("курс", "бейдевинд", "галфвинд", "бакштаг", "фордевинд"),
 "оснастка": ("оснаст", "парус", "шкот", "мачт", "румпел"),
 "манёвры": ("манев", "манёв", "оверштаг", "поворот"),
 "правила": ("правил", "галс", "уступ", "право пути"),
 "старт": ("старт", "сигнал"),
 "ветер": ("ветер", "ветр", "шквал"),
 "безопасность": ("безопас", "жилет", "опрокид"),
 "термины": ("термин", "команд", "руля"),
}

class GuidedDialog:
 def __init__(self, engine, retriever=None):
  self.engine=engine
  self.retriever=retriever
  with engine._db() as db:
   db.execute("CREATE TABLE IF NOT EXISTS ai_fsm(player TEXT NOT NULL, npc TEXT NOT NULL, phase TEXT NOT NULL, topic TEXT, fact_id TEXT, PRIMARY KEY(player,npc))")

 def state(self, npc_id, player_id):
  with self.engine._db() as db:
   row=db.execute('SELECT phase,topic,fact_id FROM ai_fsm WHERE player=? AND npc=?',(str(player_id),npc_id)).fetchone()
  return dict(row) if row else {'phase':'greeting','topic':None,'fact_id':None}

 def _save(self, npc, player, phase, topic=None, fact_id=None):
  with self.engine._db() as db:
   db.execute('INSERT INTO ai_fsm(player,npc,phase,topic,fact_id) VALUES(?,?,?,?,?) ON CONFLICT(player,npc) DO UPDATE SET phase=excluded.phase,topic=excluded.topic,fact_id=excluded.fact_id',(str(player),npc,phase,topic,fact_id))

 def _reply(self,npc,text,phase,topic=None,fact_id=None,events=None):
  return {'npcId':npc,'text':text,'state':phase,'topic':topic,'facts':[fact_id] if fact_id else [],'events':events or [],'quiz':None}

 def dialog(self,npc_id,player_id,text):
  if npc_id not in NPCS: raise ValueError('Unknown NPC')
  if not str(player_id).strip(): raise ValueError('Missing player')
  npc=NPCS[npc_id]; text=str(text).strip()[:1000]; low=text.casefold(); player=str(player_id)
  with self.engine.lock:
   s=self.state(npc_id,player); phase=s['phase']; topic=s['topic']; fact_id=s['fact_id']
   if any(x in low for x in ('пока','до свидания','завершить')):
    self._save(npc_id,player,'bye')
    return self._reply(npc_id,npc['bye'],'bye')
   if phase in ('greeting','bye'):
    self._save(npc_id,player,'choose')
    return self._reply(npc_id,npc['greeting']+' Темы: '+', '.join(npc['topics'])+'.','choose')
   repeat = any(x in low for x in ('повтори','повторить','ещё раз','напомни'))
   # Repetition takes precedence over topic matching and preserves exact fact ID.
   if repeat and fact_id and phase in ('check','feedback'):
    fact=next((f for f in FACTS if f['id']==fact_id),None)
    if fact:
     with self.engine._db() as db:
      db.execute('INSERT INTO ai_memory(player,npc,fact,seen) VALUES(?,?,?,1) ON CONFLICT(player,npc,fact) DO UPDATE SET seen=seen+1',(player,npc_id,fact_id))
     self._save(npc_id,player,'check',topic,fact_id)
     return self._reply(npc_id,npc['prefix']+' Напомню эту же тему: '+fact['text']+' Всё понятно? Ответь «понятно» или «непонятно».','check',topic,fact_id)
   chosen=next((t for t in npc['topics'] if any(a in low for a in TOPIC_ALIASES[t])),None)
   if chosen and (phase in ('choose','check','feedback') or chosen != topic):
    topic=chosen; phase='explain'
   if phase=='choose' and not chosen:
    hits=(self.retriever.search(text,npc['topics'],k=1) if self.retriever else self.engine.search_hybrid(text,npc['topics'],k=1))
    if hits:
     chosen=hits[0]['topic'];topic=chosen;phase='explain'
   if phase=='choose' and not chosen:
    return self._reply(npc_id,'Выбери тему: '+', '.join(npc['topics'])+'.','choose')
   if phase=='explain':
    facts=(self.retriever.search(text,npc['topics'],k=4) if self.retriever else self.engine.search_hybrid(text,npc['topics'],k=4))
    selected=next((f for f in facts if f['topic']==topic),None) or next((f for f in FACTS if f['topic']==topic),None)
    if selected is None:
     self._save(npc_id,player,'choose')
     return self._reply(npc_id,'По этой теме пока нет проверенных материалов. Выбери другую.','choose')
    # Reuse verified canonical fact, not unverified LLM paraphrase.
    with self.engine._db() as db:
     row=db.execute('SELECT seen FROM ai_memory WHERE player=? AND npc=? AND fact=?',(player,npc_id,selected['id'])).fetchone()
     db.execute('INSERT INTO ai_memory(player,npc,fact,seen) VALUES(?,?,?,1) ON CONFLICT(player,npc,fact) DO UPDATE SET seen=seen+1',(player,npc_id,selected['id']))
    mastery=self.engine.profile(player).get(topic,{}).get('mastery',0.25)
    pre='Мы уже разбирали эту тему. Напомню проверенное определение: ' if row else ''
    errors=self.engine.recent_errors(player,topic,1)
    suffix=' У тебя была ошибка по этой теме на воде — уделим ей внимание.' if errors and mastery<0.7 else ''
    answer=npc['prefix']+' '+pre+selected['text']+suffix+' Всё понятно? Ответь «понятно» или «непонятно». '
    self._save(npc_id,player,'check',topic,selected['id'])
    return self._reply(npc_id,answer,'check',topic,selected['id'],[{'t':'topic_hint','topic':topic}])
   if phase=='check':
    if any(x in low for x in ('непонят','не понял','не поняла','сложно','нет')):
     self._save(npc_id,player,'feedback',topic,fact_id)
     fact=next((f for f in FACTS if f['id']==fact_id),None)
     return self._reply(npc_id,npc['prefix']+' Давай ещё раз: '+(fact['text'] if fact else 'Выберем тему заново.')+' Можем повторить тему или выбрать другую.','feedback',topic,fact_id)
    if any(x in low for x in ('понят','ясно','да','усвоил','усвоила')):
     # Self-report does not prove mastery; no BKT success recorded.
     self._save(npc_id,player,'feedback',topic,fact_id)
     return self._reply(npc_id,'Хорошо! Для закрепления попробуй применить это на воде. Можем повторить или выбрать другую тему.','feedback',topic,fact_id)
    return self._reply(npc_id,'Скажи «понятно» или «непонятно», либо назови другую тему.','check',topic,fact_id)
   if phase=='feedback':
    if any(x in low for x in ('повтори','повторить','ещё раз')):
     self._save(npc_id,player,'check',topic,fact_id)
     return self._reply(npc_id,'Напомню текущую тему: '+next((f['text'] for f in FACTS if f['id']==fact_id),'Выбери тему заново.'),'check',topic,fact_id)
    self._save(npc_id,player,'choose')
    return self._reply(npc_id,'Выбери следующую тему: '+', '.join(npc['topics'])+'.','choose')
   self._save(npc_id,player,'choose')
   return self._reply(npc_id,npc['greeting'],'choose')
