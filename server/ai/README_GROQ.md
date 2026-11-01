# Sail Academy AI — Groq API + FastAPI + WebSocket

**Important:** Groq is a remote API, so requests need internet. It cannot meet the earlier **fully offline** requirement unless the project requirements change. Groq's free tier has usage limits; check available models in your account. This ZIP contains **no model weights** and does not require Ollama or PyTorch.

## Ubuntu quick start

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-api.txt
cp .env.example .env
# Edit .env and set GROQ_API_KEY and three strong secrets.
set -a; source .env; set +a
python3 -m unittest discover -s sail_ai/tests -v
uvicorn sail_ai.server:app --host 127.0.0.1 --port 8000
```

For LAN use `--host 0.0.0.0` **only on a trusted network**, and firewall port 8000 to the LAN. `/docs` has interactive REST documentation.

## Obtain Groq key

Create an API key in the official Groq console, store it only in `.env` on the server, and do not embed it in the browser or commit it to Git. If the configured model is not available, change `GROQ_MODEL` to one shown in your Groq account.

## Smoke test (second terminal)

```bash
source .venv/bin/activate
set -a; source .env; set +a
curl -s -X POST http://127.0.0.1:8000/auth/demo-login -H 'Content-Type: application/json' \
  -d '{"player_id":"alice","password":"YOUR_DEMO_PASSWORD"}'
# Copy access_token from response, then:
TOKEN='PASTE_TOKEN_HERE'
curl -s http://127.0.0.1:8000/ai/npcs -H "Authorization: Bearer $TOKEN"
curl -s -X POST http://127.0.0.1:8000/ai/dialog -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"npcId":"morozov","text":"Привет"}'
curl -s -X POST http://127.0.0.1:8000/ai/dialog -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"npcId":"morozov","text":"Бейдевинд"}'
curl -s -X POST http://127.0.0.1:8000/ai/ask -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"npcId":"morozov","text":"Что такое бейдевинд?"}'
```

`/ai/dialog` is the persistent **guided FSM** with exact-repeat fix and verified canned explanations. `/ai/ask` is **Groq-assisted grounded Q&A** with fallback to verified fact when API is down or output fails source validation. These paths are separate in this release; Groq does not generate FSM messages yet.

## WebSocket browser example

```js
const socket = new WebSocket('ws://127.0.0.1:8000/ws/ai');
socket.onopen = () => socket.send(JSON.stringify({type:'auth',token:accessToken}));
socket.onmessage = e => console.log(JSON.parse(e.data));
// After auth_ok:
socket.send(JSON.stringify({type:'dialog',npcId:'morozov',text:'Что такое бейдевинд?'}));
```

The WebSocket returns one complete response, **not token-by-token inference streaming**. Authentication is required before messages. The server does not broadcast multiplayer state; that belongs to the game server.

## Server-authoritative race events

The authoritative game server (not the browser) sends `POST /internal/race-event` with `X-Server-Key: $SAIL_SERVER_EVENT_KEY` and JSON:

```json
{"player_id":"alice","event_type":"no_go_zone","details":"Tried to sail directly upwind","successful":false}
```

The AI persists BKT and uses errors for recommendations. The game server must detect and validate events itself. Replace demo shared-password login with the team's real auth; do not expose demo login to the public internet. Keep `SAIL_AUTH_SECRET`, `SAIL_DEMO_PASSWORD`, `SAIL_SERVER_EVENT_KEY`, `GROQ_API_KEY` secret.

## Remaining integration limitations

- Groq is **online-only**; no offline fallback LLM (verified factual fallback is local).
- Retrieval is **BM25 + concept matching**, not neural embeddings unless you separately configure them; Groq chat completions do not automatically provide embedding vectors.
- This standalone server uses a demo token scheme and should be integrated with team authentication before deployment.
- No true token streaming yet; no multiplayer world synchronization (handled by game server).
- Fact grounding uses canonical substring validation, which is conservative but not a formal fact-checker.
