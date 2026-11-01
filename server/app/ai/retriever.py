"""Cosine search over the local, precomputed document embeddings."""
import asyncio
import json
import math
import re
import sqlite3
import time

from app.ai.embeddings import embed, index_model
from app.config import settings

SPECIALTIES = {'captain': 'sailing_basics', 'weather': 'weather_safety',
               'judge': 'racing_rules', 'sailor': 'maritime_terms'}


STOP_WORDS = {'какой', 'какая', 'какие', 'какое', 'каком', 'каких', 'какую',
              'чего', 'когда', 'который', 'которое', 'расскажи', 'объясни',
              'пожалуйста', 'говорит', 'сказать', 'должен', 'должна', 'должны',
              'правило', 'правила', 'правилу', 'правилах', 'яхта', 'яхты',
              'лодка', 'лодки', 'яхтой', 'лодкой', 'парусных', 'гонках', 'гонки'}


def is_rules_question(question):
    text = question.casefold().replace('ё', 'е')
    return any(stem in text for stem in (
        'правил', 'уступ', 'сторон', 'право дорог', 'право пут', 'преимуще',
        'гонк', 'расхож', 'пересеч', 'обгон', 'старт', 'финиш', 'знак',
        'протест', 'дисквалиф', 'штраф', 'дистанц',
    ))


def pdf_relevance(question, text):
    """Require topical evidence in PDF text; embeddings still rank matches."""
    words = re.findall(r'[а-яёa-z]{4,}', question.casefold().replace('ё', 'е'))
    terms = {word[:min(6, max(4, len(word) - 2))] for word in words if word not in STOP_WORDS}
    if any(word.startswith('уступ') for word in words):
        terms.add('сторон')
    normalized = text.casefold().replace('ё', 'е')
    overlap = sum(bool(re.search(r'\b' + re.escape(term), normalized)) for term in terms)
    numbers = re.findall(r'правил[а-яё]*\s*(\d{1,2}(?:\.\d+)?)', question.casefold())
    exact_rule = any(re.search(r'(?<![\d.])' + re.escape(n) + r'\s+[А-ЯЁ]', text) for n in numbers)
    if not overlap and not exact_rule:
        return None
    # A question about giving way on opposite tacks needs the main rule,
    # not only special-case modifications in appendices.
    tack_question = 'галс' in question.casefold() and any(w.startswith(('уступ', 'сторон')) for w in words)
    main_rule_10 = bool(re.search(r'(?<![\d.])10\s+НА\s+ПРОТИВОПОЛОЖНЫХ\s+ГАЛСАХ', text))
    return (min(0.18, 0.06 * overlap) + (0.20 if exact_rule else 0.0)
            + (0.10 if tack_question and main_rule_10 else 0.0))


def _search(vector, npc_id, path, top_k, threshold, question=None):
    try:
        with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
            rows = db.execute('SELECT c.id, c.source, c.category, c.text, c.embedding FROM chunks c JOIN documents d ON c.source = d.source WHERE d.model = ?', (index_model(),)).fetchall()
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
        if question and source.lower().endswith('.pdf') and not is_rules_question(question):
            continue
        lexical_bonus = pdf_relevance(question, text) if question and source.lower().endswith('.pdf') else 0.0
        if lexical_bonus is None:
            continue
        rank = score + lexical_bonus
        if rank >= threshold:
            item = {'id': ident, 'source': source, 'category': category, 'text': text, 'score': score}
            page = re.search(r'\.pdf#page=(\d+)&chunk=\d+$', ident, re.I)
            if page:
                item['page'] = int(page.group(1))
                if 18 <= item['page'] <= 38:
                    rank += 0.02
            item['_rank'] = rank
            found.append(item)
    # Relevance dominates, with a small preference for the NPC's specialty and general material.
    found.sort(key=lambda x: x['_rank'] + (0.03 if x['category'] in (SPECIALTIES[npc_id], 'general') else 0), reverse=True)
    unique, seen = [], set()
    # Drop tangential hits well below the strongest semantic match.
    best_score = max((item['_rank'] for item in found), default=0)
    for item in found:
        if item['_rank'] < best_score - 0.03:
            continue
        key = ' '.join(item['text'].casefold().split())
        if key not in seen:
            item.pop('_rank')
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
    vector = (await embed(['search_query: ' + query]))[0]
    embedded = time.perf_counter()
    results = await asyncio.to_thread(_search, vector, npc_id, settings.RAG_INDEX_PATH, settings.RAG_TOP_K, settings.RAG_MIN_SIMILARITY, question)
    return results, {'embedding_ms': round((embedded-start)*1000), 'search_ms': round((time.perf_counter()-embedded)*1000)}
