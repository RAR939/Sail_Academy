"""Offline multilingual embedding retrieval, optional and fail-closed.

The model must already exist on disk. No remote download is attempted.
"""
from __future__ import annotations
import math
import os
from pathlib import Path
from .engine import FACTS


def cosine(a, b):
    if len(a) != len(b) or not a:
        return 0.0
    numerator = sum(float(x) * float(y) for x, y in zip(a, b))
    norm_a = math.sqrt(sum(float(x) ** 2 for x in a))
    norm_b = math.sqrt(sum(float(y) ** 2 for y in b))
    return numerator / (norm_a * norm_b) if norm_a and norm_b else 0.0


class SemanticRetriever:
    """Precomputes fact vectors once; no network access in inference.

    `encoder` can be supplied for deterministic tests. With no encoder, a
    SentenceTransformer is loaded strictly from a pre-downloaded local path.
    """
    def __init__(self, model_path=None, encoder=None, facts=None, threshold=0.38):
        self.facts = list(FACTS if facts is None else facts)
        self.threshold = float(threshold)
        if encoder is None:
            path = model_path or os.environ.get('SAIL_EMBEDDING_MODEL')
            if not path or not Path(path).is_dir():
                raise FileNotFoundError('Set SAIL_EMBEDDING_MODEL to a downloaded local model directory')
            try:
                from sentence_transformers import SentenceTransformer
            except ImportError as exc:
                raise RuntimeError('Install sentence-transformers for embedding search') from exc
            try:
                encoder = SentenceTransformer(str(path), local_files_only=True)
            except TypeError as exc:
                raise RuntimeError('Update sentence-transformers: local_files_only=True is required') from exc
        self.encoder = encoder
        self.vectors = self._encode([self._document(f) for f in self.facts])
        if len(self.vectors) != len(self.facts):
            raise ValueError('Encoder returned an unexpected number of vectors')

    @staticmethod
    def _document(f):
        return ' '.join((f['title'], f['text'], f['detail'], ' '.join(f['keywords'])))

    def _encode(self, texts):
        values = self.encoder.encode(texts, convert_to_numpy=False, show_progress_bar=False)
        return [list(map(float, row)) for row in values]

    def ranked(self, query, topics=None, k=4):
        if not str(query).strip():
            return []
        query_vec = self._encode([query])[0]
        results = [(cosine(query_vec, vec), f) for f, vec in zip(self.facts, self.vectors)
                   if topics is None or f['topic'] in topics]
        results.sort(key=lambda pair: pair[0], reverse=True)
        return [(score, f) for score, f in results if score >= self.threshold][:k]


class HybridRetriever:
    """Reciprocal rank fusion of lexical/concept and semantic results.

    Semantic candidates below threshold are excluded. If embeddings are not
    configured, the old lexical search remains fully functional.
    """
    def __init__(self, engine, semantic=None):
        self.engine = engine
        self.semantic = semantic

    def search(self, query, topics=None, k=4):
        lexical = self.engine.search_hybrid(query, topics, k=len(FACTS))
        if self.semantic is None:
            return lexical[:k]
        semantic = [fact for _, fact in self.semantic.ranked(query, topics, k=len(FACTS))]
        scores = {}
        for rank, fact in enumerate(lexical):
            scores[fact['id']] = scores.get(fact['id'], 0) + 1.0 / (20 + rank)
        for rank, fact in enumerate(semantic):
            scores[fact['id']] = scores.get(fact['id'], 0) + 1.2 / (20 + rank)
        by_id = {f['id']: f for f in FACTS}
        return [by_id[fid] for fid in sorted(scores, key=lambda fid: -scores[fid])[:k]]
