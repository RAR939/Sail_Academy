"""Incremental, transactional local knowledge index: python -m app.ai.indexer."""
import asyncio
import hashlib
import json
import re
import sqlite3
from pathlib import Path

from app.ai.embeddings import embed, index_model
from app.config import settings

KNOWLEDGE = Path(__file__).resolve().parents[2] / 'knowledge'
CATEGORIES = {'sailing_basics', 'weather_safety', 'racing_rules', 'maritime_terms', 'general'}
PDF_PATH = KNOWLEDGE.parent / 'ai' / 'sail_ai' / 'resources' / 'PPG_2025_2028.pdf'
PDF_SOURCE = 'ai/sail_ai/resources/PPG_2025_2028.pdf'
EMBED_BATCH_SIZE = 16


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


def pdf_chunks(path: Path, source: str) -> list[tuple[str, str]]:
    """Extract bounded fragments with physical PDF page numbers, without OCR."""
    try:
        import pymupdf
    except ImportError as exc:
        raise RuntimeError('Для индексации PDF установите PyMuPDF: pip install pymupdf') from exc
    parts = []
    with pymupdf.open(path) as pdf:
        for page_number, page in enumerate(pdf, 1):
            # Text blocks preserve local reading order better than a single page string.
            blocks = [' '.join(block[4].split()) for block in page.get_text('blocks') if len(block) > 4 and isinstance(block[4], str)]
            # Numbered rules can share a single PDF text block.
            rule_break = r'(?<!\S)(?=\d{1,2}\s+[А-ЯЁ]+(?:[\s,;–-]+[А-ЯЁ]+)*\s+[А-ЯЁ][а-яё])'
            page_parts = chunks('\n\n'.join(re.sub(rule_break, '\n\n', block) for block in blocks))
            for number, text in enumerate(page_parts, 1):
                if len(text) >= 30:
                    parts.append((f'{source}#page={page_number}&chunk={number}', text))
    if not parts:
        raise ValueError(f'В PDF не найден текст: {path}')
    return parts


async def update_index(root: Path = KNOWLEDGE, db_path: str | None = None, *, pdf_path: Path | None = None) -> dict:
    path = db_path or settings.RAG_INDEX_PATH
    if not root.is_dir():
        raise FileNotFoundError(f'Knowledge directory not found: {root}')
    # Snapshot all sources before any mutation; an embedding failure leaves the index untouched.
    documents = {}
    for file in sorted(root.rglob('*')):
        if file.is_file() and file.suffix.lower() in {'.txt', '.md'}:
            source = file.relative_to(root).as_posix()
            category = source.split('/')[0]
            if category not in CATEGORIES:
                continue
            content = file.read_text(encoding='utf-8')
            documents[source] = (category, hashlib.sha256(content.encode()).hexdigest(), [(f'{source}#{i}', part) for i, part in enumerate(chunks(content), 1)])
    if pdf_path is None and root.resolve() == KNOWLEDGE.resolve():
        pdf_path = PDF_PATH
    if pdf_path is not None and pdf_path.exists():
        digest = hashlib.sha256(pdf_path.read_bytes() + b'pdf-chunk-v2').hexdigest()
        documents[PDF_SOURCE] = ('racing_rules', digest, None)
    with connect(path) as db:
        old = {row[0]: (row[1], row[2]) for row in db.execute('SELECT source, digest, model FROM documents')}
    changed = [s for s, (_, digest, _) in documents.items() if old.get(s) != (digest, index_model())]
    prepared = {}
    for source in changed:
        category, digest, parts = documents[source]
        if parts is None:
            parts = pdf_chunks(pdf_path, source)
        vectors = []
        for start in range(0, len(parts), EMBED_BATCH_SIZE):
            vectors.extend(await embed(['search_document: ' + text for _, text in parts[start:start + EMBED_BATCH_SIZE]]))
        prepared[source] = (category, digest, parts, vectors)
    deleted = set(old) - set(documents)
    with connect(path) as db:
        for source in set(changed) | deleted:
            db.execute('DELETE FROM chunks WHERE source = ?', (source,))
            db.execute('DELETE FROM documents WHERE source = ?', (source,))
        for source, (category, digest, parts, vectors) in prepared.items():
            db.execute('INSERT INTO documents VALUES (?, ?, ?)', (source, digest, index_model()))
            db.executemany('INSERT INTO chunks VALUES (?, ?, ?, ?, ?)', [
                (ident, source, category, part, json.dumps(vector))
                for (ident, part), vector in zip(parts, vectors, strict=True)])
    return {'changed': len(changed), 'deleted': len(deleted), 'documents': len(documents)}


if __name__ == '__main__':
    print(json.dumps(asyncio.run(update_index()), ensure_ascii=False))
