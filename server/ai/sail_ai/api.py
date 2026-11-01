"""Mount router in existing authenticated FastAPI server; never expose standalone public AI auth."""
import os
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from .engine import Engine

router=APIRouter(prefix='/ai',tags=['AI'])
from .ollama import Ollama
engine=Engine(os.getenv('SAIL_AI_DB','sail_ai.sqlite3'),
              llm=Ollama(model=os.getenv('SAIL_AI_MODEL','qwen2.5:3b')) if os.getenv('SAIL_AI_LLM','0')=='1' else None)
class DialogRequest(BaseModel):
 npcId:str
 text:str=Field(max_length=1000)
 context:dict=Field(default_factory=dict)

# Integration contract: app.state.authenticated_user(request) must verify server's token.
async def require_user(request:Request):
 verifier=getattr(request.app.state,'authenticated_user',None)
 if verifier is None:raise HTTPException(503,'AI auth integration not configured')
 user=verifier(request)
 if hasattr(user,'__await__'):user=await user
 if not user:raise HTTPException(401,'Unauthorized')
 return str(user)

@router.post('/dialog')
async def dialog(payload:DialogRequest,player_id:str=Depends(require_user)):
 try:return engine.dialog(payload.npcId,player_id,payload.text,payload.context)
 except ValueError as e:raise HTTPException(400,str(e)) from e

class EventRequest(BaseModel):
 topic:str
 kind:str
 details:str=''
@router.post('/event')
async def event(payload:EventRequest,player_id:str=Depends(require_user)):
 try:engine.record_event(player_id,payload.topic,payload.kind,payload.details)
 except ValueError as e:raise HTTPException(400,str(e)) from e
 return {'ok':True}

@router.get('/profile')
async def profile(player_id:str=Depends(require_user)):
 return {'topics':engine.profile(player_id),'recommendation':engine.recommend(player_id)}
