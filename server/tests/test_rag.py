import asyncio
import json
import os
import sqlite3

import pytest

os.environ.setdefault('JWT_SECRET', 'rag-test-secret-only-000000000000000000')
from app.ai import indexer, retriever, service


def test_index_incremental_transaction_and_search(tmp_path, monkeypatch):
    async def run():
        root = tmp_path / 'knowledge'
        folder = root / 'sailing_basics'
        folder.mkdir(parents=True)
        doc = folder / 'turn.txt'
        doc.write_text('Поворот носом через ветер называется оверштаг.', encoding='utf8')
        db = str(tmp_path / 'index.db')
        calls = []
        async def embed(texts):
            calls.extend(texts)
            return [[1.0, 0.0] for _ in texts]
        monkeypatch.setattr(indexer, 'embed', embed)
        assert (await indexer.update_index(root, db))['changed'] == 1
        assert (await indexer.update_index(root, db))['changed'] == 0
        assert len(calls) == 1
        assert retriever._search([1, 0], 'captain', db, 4, .4)[0]['source'] == 'sailing_basics/turn.txt'
        assert retriever._search([0, 1], 'captain', db, 4, .4) == []
        doc.write_text('Изменённый документ.', encoding='utf8')
        async def fail(texts):
            raise OSError('offline')
        monkeypatch.setattr(indexer, 'embed', fail)
        with pytest.raises(OSError):
            await indexer.update_index(root, db)
        assert 'оверштаг' in retriever._search([1, 0], 'captain', db, 4, .4)[0]['text']
        monkeypatch.setattr(indexer, 'embed', embed)
        await indexer.update_index(root, db)
        assert retriever._search([1, 0], 'captain', db, 4, .4)[0]['text'] == 'Изменённый документ.'
        doc.unlink()
        assert (await indexer.update_index(root, db))['deleted'] == 1
        assert retriever._search([1, 0], 'captain', db, 4, .4) == []


    asyncio.run(run())

def test_roles_and_sources(monkeypatch):
    async def run():
        captured = []
        async def retrieve(*args):
            return [{'id':'x#1', 'source':'x', 'category':'general', 'text':'Факт.', 'score':.8}], {}
        def generate(messages):
            captured.append(messages)
            return 'Ответ.'
        async def run_sync(fn, *args):
            return fn(*args)
        monkeypatch.setattr(service.asyncio, 'to_thread', run_sync)
        monkeypatch.setattr(service, 'retrieve', retrieve)
        monkeypatch.setattr(service, 'generate_local', generate)
        for npc in service.NPCS:
            result = await service.answer(npc, 'Вопрос', [], '', False)
            assert result[2]['sources'][0]['id'] == 'x#1'
            assert service.NPCS[npc]['style'] in captured[-1][0]['content']
            assert '[x#1] Факт.' in captured[-1][0]['content']


    asyncio.run(run())

def test_strip_thinking(monkeypatch):
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self, size): return json.dumps({'message': {'content': '<think>секрет</think> Ответ'}}).encode()
    monkeypatch.setattr(service.urllib.request, 'urlopen', lambda *args, **kwargs: Response())
    assert service.generate_local([]) == 'Ответ'


@pytest.mark.skipif(os.environ.get('RUN_OLLAMA_INTEGRATION') != '1', reason='requires local Ollama models and indexed corpus')
def test_real_semantic_search():
    async def run():
        for question, expected in [('Что такое оверштаг?', 'оверштаг'), ('Как поворачивать против ветра?', 'оверштаг'),
                                   ('спасательный жилет', 'жилет'), ('правый галс', 'прав')]:
            results, _ = await retriever.retrieve(question, 'captain')
            assert any(expected in item['text'].lower() for item in results), (question, results)
    asyncio.run(run())

