"""Cosine search over the local, precomputed document embeddings."""
import asyncio
import json
import math
import sqlite3
import time

from app.ai.embeddings import embed
from app.config import settings

SPECIALTIES = {'captain': 'sailing_basics', 'weather': 'weather_safety',
               'judge': 'racing_rules', 'sailor': 'maritime_terms'}


def _search(vector, npc_id, path, top_k, threshold):
    try:
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
            rows = db.execute('SELECT c.id, c.source, c.category, c.text, c.embedding FROM chunks c JOIN documents d ON c.source = d.source WHERE d.model = ?', (settings.OLLAMA_EMBED_MODEL,)).fetchall()
    except sqlite3.OperationalError as exc:
        if 'unable to open database file' in str(exc) or 'no such table' in str(exc):
            return []
        raise
    norm = math.sqrt(sum(x*x for x in vector))
    found = []
    for ident, source, category, text, raw in rows:
        other = json.loads(raw)
        if len(other) != len(vector):
            continue
        magnitude = math.sqrt(sum(x*x for x in other))
        if not magnitude:
            continue
        score = sum(a*b for a, b in zip(vector, other)) / (norm * magnitude)
        if score >= threshold:
            found.append({'id': ident, 'source': source, 'category': category, 'text': text, 'score': score})
    # Relevance dominates, with a small preference for the NPC's specialty and general material.
    found.sort(key=lambda x: x['score'] + (0.03 if x['category'] in (SPECIALTIES[npc_id], 'general') else 0), reverse=True)
    unique, seen = [], set()
    for item in found:
        key = ' '.join(item['text'].casefold().split())
        if key not in seen:
            unique.append(item)
            seen.add(key)
        if len(unique) == top_k:
            break
    return unique


async def retrieve(question: str, npc_id: str, history: list[dict] | None = None) -> tuple[list[dict], dict]:
    # Previous user turn helps resolve short follow-up questions.
    previous = next((m['content'] for m in reversed(history or []) if m.get('role') == 'user'), '')
    query = f'{previous}\n{question}' if previous and len(question.split()) <= 4 else question
    start = time.perf_counter()
    vector = (await embed([query]))[0]
    embedded = time.perf_counter()
    results = await asyncio.to_thread(_search, vector, npc_id, settings.RAG_INDEX_PATH, settings.RAG_TOP_K, settings.RAG_MIN_SIMILARITY)
    return results, {'embedding_ms': round((embedded-start)*1000), 'search_ms': round((time.perf_counter()-embedded)*1000)}
