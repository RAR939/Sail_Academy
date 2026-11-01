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
        await retriever.retrieve('Как пройти гонку?', 'judge', [{'role': 'user', 'content': 'Что такое правило 10?'}])
        assert requests[-1] == 'search_query: Как пройти гонку?'
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


def test_pdf_indexing_page_numbers_updates_and_failures(tmp_path, monkeypatch):
    import pymupdf
    root = tmp_path / 'knowledge'
    root.mkdir()
    pdf_path = tmp_path / 'rules.pdf'
    db = str(tmp_path / 'rag.sqlite3')
    calls = []

    def write_pdf(text):
        pdf = pymupdf.open()
        pdf.new_page().insert_text((72, 72), text)
        pdf.new_page().insert_text((72, 72), 'Second page. Boats on different tacks must keep clear.')
        pdf.save(pdf_path)
        pdf.close()

    async def embed(texts):
        calls.extend(texts)
        return [[1., 0.] for _ in texts]

    async def run():
        write_pdf('Rule ten. A port tack boat keeps clear of starboard.')
        monkeypatch.setattr(indexer, 'embed', embed)
        assert (await indexer.update_index(root, db, pdf_path=pdf_path))['changed'] == 1
        previous_calls = len(calls)
        assert (await indexer.update_index(root, db, pdf_path=pdf_path))['changed'] == 0
        assert len(calls) == previous_calls
        results = retriever._search([1., 0.], 'judge', db, 10, .73)
        assert {r['page'] for r in results} == {1, 2}
        assert all(r['source'] == indexer.PDF_SOURCE for r in results)
        assert all('#page=' in r['id'] for r in results)
        pdf_path.unlink()
        write_pdf('A modified rule text replaces the old document.')
        async def fail(_): raise OSError('Ollama unavailable')
        monkeypatch.setattr(indexer, 'embed', fail)
        with pytest.raises(OSError):
            await indexer.update_index(root, db, pdf_path=pdf_path)
        assert any('port tack' in r['text'] for r in retriever._search([1., 0.], 'judge', db, 10, .73))
        monkeypatch.setattr(indexer, 'embed', embed)
        await indexer.update_index(root, db, pdf_path=pdf_path)
        assert any('modified' in r['text'] for r in retriever._search([1., 0.], 'judge', db, 10, .73))
        pdf_path.unlink()
        assert (await indexer.update_index(root, db, pdf_path=pdf_path))['deleted'] == 1
        assert not retriever._search([1., 0.], 'judge', db, 10, .73)
    asyncio.run(run())


def test_pdf_sources_remain_diagnostic_and_not_added_to_npc_reply(monkeypatch):
    async def retrieve(*args):
        return [{'id': 'ai/sail_ai/resources/PPG_2025_2028.pdf#page=18&chunk=6',
                 'source': 'ai/sail_ai/resources/PPG_2025_2028.pdf', 'category': 'racing_rules',
                 'text': 'Сведения из правил.', 'score': .9, 'page': 18}], {}
    async def run_sync(fn, *args): return fn(*args)
    monkeypatch.setattr(service, 'retrieve', retrieve)
    monkeypatch.setattr(service, 'generate_local', lambda _: 'Объяснение судьи.')
    monkeypatch.setattr(service.asyncio, 'to_thread', run_sync)
    text, backend, rag = asyncio.run(service.answer('judge', 'Что говорит правило 10?', [], '', False))
    assert backend == 'ollama'
    assert text == 'Объяснение судьи.'
    assert 'ППГ' not in text and 'страниц' not in text
    assert rag['sources'][0]['page'] == 18


def test_pdf_relevance_rejects_unrelated_and_finds_rules():
    assert retriever.pdf_relevance('Как приготовить пиццу?', 'Пригласите свидетелей на рассмотрение.') is None
    rule = '10 НА ПРОТИВОПОЛОЖНЫХ ГАЛСАХ Яхта левого галса сторонится яхты правого галса.'
    assert retriever.pdf_relevance('Что говорит правило 10?', rule) >= .2
    assert retriever.pdf_relevance('Кто уступает на правом галсе?', rule) > .1
    assert not retriever.is_rules_question('Что такое оверштаг?')


@pytest.mark.skipif(os.environ.get('RUN_OLLAMA_INTEGRATION') != '1', reason='requires local Ollama models and indexed PDF')
def test_real_rules_pdf_used_without_citations_in_reply():
    async def run():
        text, backend, rag = await service.answer('judge', 'Что говорит правило 10 о противоположных галсах?', [], '', False)
        assert backend == 'ollama' and text.strip()
        assert 'ППГ' not in text and 'PDF' not in text.upper()
        assert any(source.get('page') == 18 and source['source'] == indexer.PDF_SOURCE for source in rag['sources'])
        hits, _ = await retriever.retrieve('Как приготовить пиццу?', 'judge')
        assert not hits
    asyncio.run(run())


def test_gameplay_questions_do_not_mask_explicit_rules_questions():
    assert retriever.is_gameplay_question('Как пройти дистанцию в игровой гонке?')
    assert retriever.is_gameplay_question('Как пройти гонку?')
    assert retriever.is_gameplay_question('Как управлять лодкой во время гонки?')
    assert not retriever.is_gameplay_question('Какое правило 10 действует в игре?')
    assert not retriever.is_gameplay_question('Кто должен уступить на правом галсе?')
    assert not retriever.has_topic_overlap('Как приготовить пиццу?', 'Как пройти дистанцию в игровой гонке')
    assert retriever.has_topic_overlap('Как работает шверт?', 'Шверт уменьшает боковой снос.')


@pytest.mark.skipif(os.environ.get('RUN_OLLAMA_INTEGRATION') != '1', reason='requires local Ollama models and indexed knowledge')
def test_real_gameplay_and_boat_material_retrieval():
    async def run():
        for npc, question, words in [
            ('captain', 'Из каких частей состоит учебная лодка?', ('мачта', 'шверт')),
            ('captain', 'Что такое шверт и зачем он нужен?', ('шверт',)),
            ('judge', 'Как пройти дистанцию в игровой гонке?', ('четыре', 'финиш')),
            ('judge', 'Как управлять лодкой во время гонки?', ('клавиш', 'шкот')),
        ]:
            hits, _ = await retriever.retrieve(question, npc)
            found = [hit for hit in hits if hit['source'] == 'general/boat_and_race.txt']
            assert found, (question, hits)
            text = ' '.join(hit['text'].lower() for hit in found)
            assert all(word in text for word in words), (question, text)
            assert not any(hit['source'].endswith('.pdf') for hit in hits)
        rules, _ = await retriever.retrieve('Что говорит правило 10 о противоположных галсах?', 'judge')
        assert any(hit['source'].endswith('PPG_2025_2028.pdf') for hit in rules)
    asyncio.run(run())
