"""Ollama embedding client. Calls run outside the FastAPI event loop."""
import asyncio
import json
import math
import urllib.request

from app.config import settings


def _embed(texts: list[str]) -> list[list[float]]:
    request = urllib.request.Request(
        f"{settings.OLLAMA_URL.rstrip('/')}/api/embed",
        data=json.dumps({"model": settings.OLLAMA_EMBED_MODEL, "input": texts}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=settings.OLLAMA_TIMEOUT_SECONDS) as response:
        result = json.loads(response.read())
    vectors = result.get("embeddings")
    if not isinstance(vectors, list) or len(vectors) != len(texts):
        raise ValueError("Invalid embedding response")
    for vector in vectors:
        if (not isinstance(vector, list) or not vector or
            any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in vector) or
            not any(vector)):
            raise ValueError("Invalid embedding vector")
    return vectors


async def embed(texts: list[str]) -> list[list[float]]:
    return await asyncio.to_thread(_embed, texts)
