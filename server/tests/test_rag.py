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
        for question in ('Как приготовить пиццу?', 'Сколько спутников у Юпитера?'):
            results, _ = await retriever.retrieve(question, 'captain')
            assert not results, (question, results)
    asyncio.run(run())



def test_query_embedding_search_and_deduplication(tmp_path, monkeypatch):
    """The search consumes a query vector and returns ranked, distinct sources."""
    root = tmp_path / 'knowledge'
    for category in ('sailing_basics', 'weather_safety'):
        (root / category).mkdir(parents=True)
    (root / 'sailing_basics' / 'turn.txt').write_text(
        'Поворот носом через направление ветра называется оверштаг.\n\n'
        'Поворот носом через направление ветра называется оверштаг.', encoding='utf8')
    (root / 'weather_safety' / 'vest.txt').write_text('Наденьте спасательный жилет.', encoding='utf8')
    path = str(tmp_path / 'index.sqlite3')
    requests = []

    async def fake_embed(texts):
        requests.extend(texts)
        return [[0., 1.] if 'жилет' in t else [1., 0.] for t in texts]

    async def run():
        monkeypatch.setattr(indexer, 'embed', fake_embed)
        monkeypatch.setattr(retriever, 'embed', fake_embed)
        monkeypatch.setattr(retriever.settings, 'RAG_INDEX_PATH', path)
        await indexer.update_index(root, path)
        hits, _ = await retriever.retrieve('Как поворачивать против ветра?', 'captain')
        assert len(hits) == 1 and 'оверштаг' in hits[0]['text']
        assert hits[0]['source'] == 'sailing_basics/turn.txt'
        assert hits[0]['score'] == pytest.approx(1.)
        assert requests[-1].startswith('search_query: ')
        assert all(t.startswith('search_document: ') for t in requests[:-1])
        vest, _ = await retriever.retrieve('спасательный жилет', 'weather')
        assert vest[0]['category'] == 'weather_safety'
        with pytest.raises(FileNotFoundError):
            await indexer.update_index(tmp_path / 'missing', path)
        assert retriever._search([1, 0], 'captain', path, 4, .73)

    asyncio.run(run())


def test_invalid_embedding_response(monkeypatch):
    from app.ai import embeddings
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass
        def read(self): return b'{"embeddings": [[1, 2], [0]]}'
    monkeypatch.setattr(embeddings.urllib.request, 'urlopen', lambda *args, **kwargs: Response())
    with pytest.raises(ValueError):
        embeddings._embed(['a', 'b'])


def test_administrator_personality_and_facts_are_combined_with_rag(monkeypatch):
    captured = []
    async def retrieve(*args):
        return [{'id': 'general/example#1', 'source': 'general/example', 'category': 'general',
                 'text': 'Проверенный факт.', 'score': .9}], {}
    async def run_sync(fn, *args):
        return fn(*args)
    def generate(messages):
        captured.extend(messages)
        return 'Ответ.'
    monkeypatch.setattr(service, 'retrieve', retrieve)
    monkeypatch.setattr(service, 'generate_local', generate)
    monkeypatch.setattr(service.asyncio, 'to_thread', run_sync)
    asyncio.run(service.answer('captain', 'Вопрос', [], '', False,
                               {'name': 'Капитан', 'style': 'Строгий стиль', 'facts': 'Добавленный факт'}))
    prompt = captured[0]['content']
    assert 'Строгий стиль' in prompt
    assert 'Добавленный факт' in prompt
    assert '[general/example#1] Проверенный факт.' in prompt


@pytest.mark.skipif(os.environ.get('RUN_OLLAMA_INTEGRATION') != '1', reason='requires local Ollama models and indexed corpus')
def test_real_generation_uses_retrieved_source():
    async def run():
        text, backend, rag = await service.answer('captain', 'Что такое оверштаг?', [], '', False)
        assert backend == 'ollama' and text.strip()
        assert any('sailing_basics/' in source['id'] for source in rag['sources'])
    asyncio.run(run())
