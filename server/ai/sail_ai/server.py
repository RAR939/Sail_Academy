"""Standalone LAN-ready demo server. Replace demo token issuing with team auth in production."""
from __future__ import annotations
import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Header, Depends
from pydantic import BaseModel, Field
from .engine import Engine, FACTS, NPCS
from .fsm import GuidedDialog
from .semantic import HybridRetriever
from .groq_client import Groq
from .integrated import IntegratedTutor
from .rules import RulesIndex

SECRET=os.getenv('SAIL_AUTH_SECRET','')
if len(SECRET)<32:
    raise RuntimeError('Set SAIL_AUTH_SECRET to a random value of at least 32 characters')
SECRET=SECRET.encode()
ADMIN=os.getenv('SAIL_SERVER_EVENT_KEY','')
engine=Engine(os.getenv('SAIL_AI_DB','sail_ai.sqlite3'),llm=Groq() if os.getenv('GROQ_API_KEY') else None)
chat=GuidedDialog(engine,retriever=HybridRetriever(engine))
tutor=IntegratedTutor(engine,chat)
app=FastAPI(title='Sail Academy AI',version='1.1')
rules=RulesIndex()

def rules_reply(question, npc=None, player=None):
    context = {'recent_errors':engine.recent_errors(player,limit=3)} if player else None
    return rules.answer(question, npc=npc, llm=engine.llm, player_context=context)


def sign_token(player,ttl=3600):
    body=json.dumps({'sub':player,'exp':int(time.time())+ttl},separators=(',',':')).encode()
    import base64
    payload=base64.urlsafe_b64encode(body).decode().rstrip('=')
    signature=hmac.new(SECRET,payload.encode(),hashlib.sha256).hexdigest()
    return payload+'.'+signature

def verify_token(token):
    try:
        import base64
        payload,signature=token.split('.',1)
        expected=hmac.new(SECRET,payload.encode(),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature,expected):raise ValueError()
        data=json.loads(base64.urlsafe_b64decode(payload+'='*(-len(payload)%4)))
        if int(data['exp'])<time.time() or not str(data['sub']).strip():raise ValueError()
        return str(data['sub'])
    except Exception:raise HTTPException(401,'Invalid or expired token')

def user(authorization:str|None=Header(default=None)):
    if not authorization or not authorization.startswith('Bearer '):raise HTTPException(401,'Bearer token required')
    return verify_token(authorization[7:])

class Login(BaseModel):
    player_id:str=Field(min_length=1,max_length=64,pattern=r'^[a-zA-Z0-9_-]+$')
    password:str

@app.post('/auth/demo-login')
def login(payload:Login):
    # Demo-only shared password. For production, use the team's existing auth service.
    password=os.getenv('SAIL_DEMO_PASSWORD','')
    if not password or not secrets.compare_digest(payload.password,password):raise HTTPException(401,'Bad credentials')
    return {'access_token':sign_token(payload.player_id),'token_type':'bearer','expires_in':3600}

def is_rules_question(text):
    import re
    return bool(re.search(
        r'(?i)(?:\bппг\b|\bправил[оауеы]?\b|\bрегат\w*\b|\bгонк\w*\b|'
        r'\bгалс\w*\b.{0,65}\b(?:уступ\w*|сторон\w*|прав\w*|встреч\w*)\b|'
        r'\b(?:уступ\w*|сторон\w*|встреч\w*)\b.{0,65}\bгалс\w*\b|'
        r'\b(?:кто\s+уступает|право\s+дороги|столкновен\w*)\b)', text))

class Dialog(BaseModel):
    npcId:str
    text:str=Field(min_length=1,max_length=1000)

@app.post('/ai/dialog')
def dialog(payload:Dialog,player:str=Depends(user)):
    if is_rules_question(payload.text):
        if payload.npcId not in NPCS:raise HTTPException(400,'Unknown NPC')
        return {'npcId':payload.npcId,**rules_reply(payload.text,NPCS[payload.npcId],player),'state':'rules','facts':[],'events':[],'quiz':None}
    try:return tutor.dialog(payload.npcId,player,payload.text)
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc

@app.post('/ai/ask')
def ask(payload:Dialog,player:str=Depends(user)):
    # Q&A endpoint uses Groq and canonical fact validation, FSM is /ai/dialog.
    if is_rules_question(payload.text):
        if payload.npcId not in NPCS:raise HTTPException(400,'Unknown NPC')
        return {'npcId':payload.npcId,**rules_reply(payload.text,NPCS[payload.npcId],player),'state':'rules','facts':[],'events':[],'quiz':None}
    try:return engine.dialog(payload.npcId,player,payload.text)
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc

class RulesQuestion(BaseModel):
    text:str=Field(min_length=1,max_length=1000)
    npcId:str|None=None

@app.post('/ai/rules/search')
def rules_search(payload:RulesQuestion,player:str=Depends(user)):
    return {'query':payload.text,'references':rules.search(payload.text),'document':'ППГ 2025–2028'}

@app.post('/ai/rules/ask')
def rules_ask(payload:RulesQuestion,player:str=Depends(user)):
    if payload.npcId is not None and payload.npcId not in NPCS:raise HTTPException(400,'Unknown NPC')
    return rules_reply(payload.text,NPCS.get(payload.npcId) if payload.npcId else None,player)

@app.get('/ai/profile')
def profile(player:str=Depends(user)):
    return {'topics':engine.profile(player),'recommendation':engine.recommend(player)}

@app.get('/ai/race-report')
def race_report(player:str=Depends(user),limit:int=100):
    return tutor.race_report(player,limit)

@app.get('/ai/npcs')
def npcs(player:str=Depends(user)):
    return [{'id':key,'name':npc['name'],'topics':npc['topics']} for key,npc in NPCS.items()]

class RaceEvent(BaseModel):
    player_id:str=Field(min_length=1,max_length=64)
    event_type:str
    details:str=Field(default='',max_length=500)
    successful:bool=False

@app.post('/internal/race-event')
def race_event(payload:RaceEvent,x_server_key:str|None=Header(default=None)):
    # Never accept mastery-changing events from arbitrary players.
    if not ADMIN or not x_server_key or not secrets.compare_digest(x_server_key,ADMIN):raise HTTPException(403,'Server key required')
    try:return engine.record_race_event(payload.player_id,payload.event_type,payload.details,payload.successful)
    except ValueError as exc:raise HTTPException(400,str(exc)) from exc

@app.websocket('/ws/ai')
async def ws_ai(ws:WebSocket):
    # Browser WebSocket API cannot set Authorization header; use first auth message.
    await ws.accept()
    try:
        first=await asyncio.wait_for(ws.receive_json(),timeout=10)
        if first.get('type')!='auth':
            await ws.close(code=1008);return
        try:player=verify_token(str(first.get('token','')))
        except HTTPException:
            await ws.close(code=1008);return
        await ws.send_json({'type':'auth_ok','player_id':player})
        while True:
            msg=await ws.receive_json()
            if msg.get('type') not in ('dialog','ask'):
                await ws.send_json({'type':'error','error':'Expected dialog or ask'});continue
            npc=str(msg.get('npcId',''))
            question=str(msg.get('text',''))
            if len(question)>1000 or not question.strip():
                await ws.send_json({'type':'error','error':'Invalid text'});continue
            try:
                # Run synchronous network call in worker to avoid blocking other sockets.
                result=await asyncio.to_thread((lambda: {'npcId':npc,**rules_reply(question,NPCS[npc],player),'state':'rules','facts':[],'events':[],'quiz':None}) if is_rules_question(question) and npc in NPCS else (lambda: (tutor.dialog if msg['type']=='dialog' else engine.dialog)(npc,player,question)))
                await ws.send_json({'type':'reply','data':result})
            except ValueError as exc:await ws.send_json({'type':'error','error':str(exc)})
    except (WebSocketDisconnect,asyncio.TimeoutError):return

@app.get('/health')
def health():return {'ok':True,'groq_configured':bool(os.getenv('GROQ_API_KEY')),'facts':len(FACTS),'rules_pages':len(rules.pages)}
