"""Incremental, transactional local knowledge index: python -m app.ai.indexer."""
import asyncio
import hashlib
import json
import re
import sqlite3
from pathlib import Path

from app.ai.embeddings import embed
from app.config import settings

KNOWLEDGE = Path(__file__).resolve().parents[2] / 'knowledge'
CATEGORIES = {'sailing_basics', 'weather_safety', 'racing_rules', 'maritime_terms', 'general'}


def connect(path: str) -> sqlite3.Connection:
    db = sqlite3.connect(path)
    db.execute('CREATE TABLE IF NOT EXISTS documents (source TEXT PRIMARY KEY, digest TEXT NOT NULL, model TEXT NOT NULL)')
    db.execute('CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, source TEXT NOT NULL, category TEXT NOT NULL, text TEXT NOT NULL, embedding TEXT NOT NULL)')
    return db


def chunks(text: str) -> list[str]:
    # Paragraphs are independent; split very long paragraphs at sentence boundaries.
    parts = []
    for paragraph in re.split(r'\n\s*\n', text.strip()):
        current = ''
        for sentence in re.split(r'(?<=[.!?])\s+', paragraph.strip()):
            while len(sentence) > 1000:
                if current:
                    parts.append(current)
                    current = ''
                parts.append(sentence[:1000])
                sentence = sentence[1000:]
            if len(current) + len(sentence) + 1 > 1000:
                parts.append(current)
                current = ''
            current = (current + ' ' + sentence).strip()
        if current:
            parts.append(current)
    return parts


async def update_index(root: Path = KNOWLEDGE, db_path: str | None = None) -> dict:
    path = db_path or settings.RAG_INDEX_PATH
    # Snapshot all sources before any mutation; an embedding failure leaves the index untouched.
    documents = {}
    for file in sorted(root.rglob('*')):
        if file.is_file() and file.suffix.lower() in {'.txt', '.md'}:
            source = file.relative_to(root).as_posix()
            category = source.split('/')[0]
            if category not in CATEGORIES:
                continue
            content = file.read_text(encoding='utf-8')
            documents[source] = (category, hashlib.sha256(content.encode()).hexdigest(), chunks(content))
    with connect(path) as db:
        old = {row[0]: (row[1], row[2]) for row in db.execute('SELECT source, digest, model FROM documents')}
    changed = [s for s, (_, digest, _) in documents.items() if old.get(s) != (digest, settings.OLLAMA_EMBED_MODEL)]
    prepared = {}
    for source in changed:
        category, digest, parts = documents[source]
        vectors = await embed(parts) if parts else []
        prepared[source] = (category, digest, parts, vectors)
    deleted = set(old) - set(documents)
    with connect(path) as db:
        for source in set(changed) | deleted:
            db.execute('DELETE FROM chunks WHERE source = ?', (source,))
            db.execute('DELETE FROM documents WHERE source = ?', (source,))
        for source, (category, digest, parts, vectors) in prepared.items():
            db.execute('INSERT INTO documents VALUES (?, ?, ?)', (source, digest, settings.OLLAMA_EMBED_MODEL))
            db.executemany('INSERT INTO chunks VALUES (?, ?, ?, ?, ?)', [
                (f'{source}#{i+1}', source, category, part, json.dumps(vector))
                for i, (part, vector) in enumerate(zip(parts, vectors, strict=True))])
    return {'changed': len(changed), 'deleted': len(deleted), 'documents': len(documents)}


if __name__ == '__main__':
    print(json.dumps(asyncio.run(update_index()), ensure_ascii=False))
