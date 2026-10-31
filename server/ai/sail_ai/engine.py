"""Offline, dependency-light Sail Academy NPC engine. Python 3.11+."""
from __future__ import annotations
import json, math, re, sqlite3, threading, time
from pathlib import Path
from collections import Counter
from .adaptive import INITIAL, bkt_update, apply_race_event

ROOT=Path(__file__).parent
FACTS=json.loads((ROOT/'facts.json').read_text(encoding='utf-8'))
NPCS=json.loads((ROOT/'npcs.json').read_text(encoding='utf-8'))
STOP={'как','что','это','для','или','при','его','она','мне','про','так','если','чем','надо','можно','когда','тебя','есть','быть','такое'}
def tokens(s): return [x for x in re.findall(r'[а-яёa-z0-9]+',s.lower()) if len(x)>2 and x not in STOP]
class _ClosingConnection(sqlite3.Connection):
 def __exit__(self, exc_type, exc_value, traceback):
  try:
   return super().__exit__(exc_type, exc_value, traceback)
  finally:
   self.close()

class Engine:
 def __init__(self, db_path='sail_ai.sqlite3', llm=None):
  self.db_path=str(db_path); self.llm=llm; self.lock=threading.RLock()
  with self._db() as db:
   db.execute('CREATE TABLE IF NOT EXISTS ai_memory(player TEXT NOT NULL,npc TEXT NOT NULL,fact TEXT NOT NULL,seen INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(player,npc,fact))')
   db.execute('CREATE TABLE IF NOT EXISTS ai_topic(player TEXT NOT NULL,topic TEXT NOT NULL,success INTEGER DEFAULT 0,errors INTEGER DEFAULT 0,PRIMARY KEY(player,topic))')
   db.execute('CREATE TABLE IF NOT EXISTS ai_events(id INTEGER PRIMARY KEY,player TEXT NOT NULL,topic TEXT NOT NULL,kind TEXT NOT NULL,details TEXT,created REAL NOT NULL)')
   db.execute('CREATE TABLE IF NOT EXISTS ai_bkt(player TEXT NOT NULL,topic TEXT NOT NULL,mastery REAL NOT NULL,PRIMARY KEY(player,topic))')
   db.execute('CREATE TABLE IF NOT EXISTS ai_dialog(player TEXT NOT NULL,npc TEXT NOT NULL,state TEXT NOT NULL,PRIMARY KEY(player,npc))')
 def _db(self):
  db=sqlite3.connect(self.db_path,timeout=10,factory=_ClosingConnection);db.row_factory=sqlite3.Row;return db
 def search(self,text,topics=None,k=4):
  q=Counter(tokens(text)); docs=[Counter(tokens(f['title']+' '+f['text']+' '+ ' '.join(f['keywords']))) for f in FACTS]; n=len(docs); avg=sum(map(lambda d:sum(d.values()),docs))/max(n,1)
  scores=[]
  for f,d in zip(FACTS,docs):
   if topics and f['topic'] not in topics:continue
   score=0
   for w,qf in q.items():
    df=sum(w in dd for dd in docs);idf=math.log(1+(n-df+0.5)/(df+0.5));tf=d[w];score+=idf*tf*2.2/(tf+1.2*(.25+.75*sum(d.values())/max(avg,1)))*qf
   scores.append((score,f))
  return [f for score,f in sorted(scores,key=lambda x:x[0],reverse=True) if score>0][:k]
 def search_hybrid(self,text,topics=None,k=4):
  """Offline lexical + concept expansion retrieval; no embedding model required."""
  concepts={
   'course_close':('спереди сбоку','спереди и сбоку','острый угол','острым углом','наискосок к ветру','лавиров','встречному ветру'),
   'course_reach':('ветер сбоку','ветер с кормы','ветер сзади','попутный ветер'),
   'rig':('чем управлять парусом','как натянуть парус','управление парусом','как рулить','из чего состоит яхта'),
   'tack':('сменить галс','нос через ветер','поворот против ветра'),
   'right_of_way':('кто должен уступить','кто уступает','у кого преимущество','кто имеет право пути'),
   'start':('когда пересекать линию','начало гонки'),
   'wind':('ветер ощущает лодка','ветер на ходу','относительный ветер'),
   'safety':('перевернулась лодка','упал в воду','как не утонуть'),
   'terms':('морские команды','что кричат моряки'),
  }
  low=text.casefold().replace('ё','е')
  lexical=self.search(text,topics,k=len(FACTS))
  scores={f['id']:max(0.01,1.0/(i+1)) for i,f in enumerate(lexical)}
  for f in FACTS:
   if topics and f['topic'] not in topics:continue
   if any(phrase in low for phrase in concepts.get(f['id'],())):
    scores[f['id']]=scores.get(f['id'],0)+3.0
  return sorted((f for f in FACTS if f['id'] in scores and (not topics or f['topic'] in topics)),key=lambda f:-scores[f['id']])[:k]
 def profile(self,player):
  with self._db() as db:
   rows=db.execute('SELECT * FROM ai_topic WHERE player=?',(str(player),)).fetchall()
  with self._db() as db:
   mastery={r['topic']:r['mastery'] for r in db.execute('SELECT topic,mastery FROM ai_bkt WHERE player=?',(str(player),))}
  return {r['topic']:{'success':r['success'],'errors':r['errors'],'mastery':round(mastery.get(r['topic'],INITIAL),3)} for r in rows}
 def record_event(self,player,topic,kind,details=''):
  if topic not in {f['topic'] for f in FACTS}:raise ValueError('Unknown topic')
  if kind not in ('success','error','race_error','race_success'):raise ValueError('Unknown event')
  success=int(kind in ('success','race_success'));errors=1-success
  with self.lock,self._db() as db:
   db.execute('INSERT INTO ai_events(player,topic,kind,details,created) VALUES(?,?,?,?,?)',(str(player),topic,kind,str(details)[:500],time.time()))
   db.execute('INSERT INTO ai_topic(player,topic,success,errors) VALUES(?,?,?,?) ON CONFLICT(player,topic) DO UPDATE SET success=success+excluded.success,errors=errors+excluded.errors',(str(player),topic,success,errors))
   row=db.execute('SELECT mastery FROM ai_bkt WHERE player=? AND topic=?',(str(player),topic)).fetchone()
   new=bkt_update(row['mastery'] if row else INITIAL,bool(success))
   db.execute('INSERT INTO ai_bkt(player,topic,mastery) VALUES(?,?,?) ON CONFLICT(player,topic) DO UPDATE SET mastery=excluded.mastery',(str(player),topic,new))
 def record_race_event(self,player,event_type,details="",successful=False):
  return apply_race_event(self,player,event_type,details,successful)
 def recent_errors(self,player,topic=None,limit=5):
  with self._db() as db:
   if topic is None:rows=db.execute("SELECT topic,kind,details,created FROM ai_events WHERE player=? AND kind IN ('error','race_error') ORDER BY id DESC LIMIT ?",(str(player),limit)).fetchall()
   else:rows=db.execute("SELECT topic,kind,details,created FROM ai_events WHERE player=? AND topic=? AND kind IN ('error','race_error') ORDER BY id DESC LIMIT ?",(str(player),topic,limit)).fetchall()
  return [dict(r) for r in rows]
 def recommend(self,player):
  profile=self.profile(player); topics=sorted({f['topic'] for f in FACTS});return min(topics,key=lambda t:(profile.get(t,{}).get('mastery',INITIAL),-profile.get(t,{}).get('errors',0),t))
 def dialog(self,npc_id,player_id,text,context=None):
  if npc_id not in NPCS:raise ValueError('Unknown NPC')
  if not str(player_id).strip():raise ValueError('Missing player')
  text=str(text).strip()[:1000]; npc=NPCS[npc_id]; player=str(player_id)
  with self.lock,self._db() as db:
   state=db.execute('SELECT state FROM ai_dialog WHERE player=? AND npc=?',(player,npc_id)).fetchone()
   if not text or tokens(text)==[] and not state:
    db.execute('INSERT INTO ai_dialog VALUES(?,?,?) ON CONFLICT(player,npc) DO UPDATE SET state=excluded.state',(player,npc_id,'choose'))
    return {'npcId':npc_id,'text':npc['greeting'],'state':'choose','facts':[],'events':[],'quiz':None}
   if any(w in text.lower() for w in ('пока','до свидания')):
    db.execute('INSERT INTO ai_dialog VALUES(?,?,?) ON CONFLICT(player,npc) DO UPDATE SET state=excluded.state',(player,npc_id,'bye'))
    return {'npcId':npc_id,'text':npc['bye'],'state':'bye','facts':[],'events':[],'quiz':None}
   matches=self.search_hybrid(text,npc['topics']); seen={r['fact']:r['seen'] for r in db.execute('SELECT fact,seen FROM ai_memory WHERE player=? AND npc=?',(player,npc_id))}
   unseen=next((f for f in matches if f['id'] not in seen),None)
   selected=unseen or (matches[0] if matches else None)
   if selected is None:
    topic=self.recommend(player)
    answer=f"{npc['prefix']} Могу помочь с темами: {', '.join(npc['topics'])}. Попробуй спросить конкретнее. Рекомендую повторить: {topic}."
    ids=[]; state='choose'
   else:
    repeated=selected['id'] in seen
    mastery=self.profile(player).get(selected['topic'],{}).get('mastery',.5)
    detail=selected['detail'] if mastery>=.7 and not repeated else selected['text']
    if repeated:answer=f"{npc['prefix']} Мы это уже обсуждали. Напомню иначе: {selected['short']}"
    else:answer=f"{npc['prefix']} {detail}"
    mistakes=self.recent_errors(player,selected['topic'],1)
    if mistakes and mastery < .7:
     answer += ' На практике у тебя возникали трудности с этой темой. Давай повторим её перед следующей гонкой.'
    accepted_generation=False
    # A remote LLM is optional. Preserve the verified source answer as fallback.
    if self.llm is not None:
     try:
      generated=self.llm(npc,text,selected,repeated,self.profile(player).get(selected['topic'],{}),context)
      if isinstance(generated,str) and generated.strip():
       # The small model is not a fact verifier. For safety the UI also gets source text.
       # Never trust an LLM paraphrase as a verified sailing rule.
       # Accept only responses containing the full canonical fact verbatim.
       canonical = selected['text'].strip()
       if canonical in generated:
        answer=generated.strip()
        accepted_generation=True
     except Exception:
      pass
    ids=[selected['id']];state='explain'
    db.execute('INSERT INTO ai_memory(player,npc,fact,seen) VALUES(?,?,?,1) ON CONFLICT(player,npc,fact) DO UPDATE SET seen=seen+1',(player,npc_id,selected['id']))
   db.execute('INSERT INTO ai_dialog VALUES(?,?,?) ON CONFLICT(player,npc) DO UPDATE SET state=excluded.state',(player,npc_id,state))
  return {'npcId':npc_id,'text':answer,'state':state,'facts':ids,'events':[{'t':'topic_hint','topic':selected['topic']}] if selected else [],'quiz':None,'source':selected['text'] if selected else None,'generated':accepted_generation if selected else False}
 def stream(self,npc_id,player_id,text,context=None):
  result=self.dialog(npc_id,player_id,text,context)
  for token in re.findall(r'\S+\s*',result['text']):yield {'t':'npc_reply','npcId':npc_id,'token':token,'done':False}
  yield {'t':'npc_reply','npcId':npc_id,'done':True,'facts':result['facts'],'events':result['events'],'quiz':None}
