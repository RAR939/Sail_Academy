import tempfile
import unittest
from pathlib import Path
from sail_ai.engine import Engine

class TestOllamaIntegration(unittest.TestCase):
    def test_model_called_for_known_fact(self):
        with tempfile.TemporaryDirectory() as d:
            calls=[]
            def fake(npc,question,fact,repeated,profile,context):
                calls.append(fact['id'])
                return 'Бейдевинд — курс относительно ветра.'
            e=Engine(Path(d)/'a.sqlite3',llm=fake)
            r=e.dialog('morozov','u','Что такое бейдевинд?')
            self.assertTrue(calls)
            self.assertIn('Бейдевинд',r['text'])
            self.assertTrue(r['source'])
    def test_fallback_on_failure(self):
        with tempfile.TemporaryDirectory() as d:
            def broken(*args): raise TimeoutError()
            e=Engine(Path(d)/'a.sqlite3',llm=broken)
            r=e.dialog('morozov','u','Что такое бейдевинд?')
            self.assertTrue(r['facts'])
            self.assertIn('курс',r['text'].lower())
    def test_unknown_never_sent_to_llm(self):
        with tempfile.TemporaryDirectory() as d:
            def broken(*args): raise AssertionError('LLM should not be called')
            e=Engine(Path(d)/'a.sqlite3',llm=broken)
            self.assertFalse(e.dialog('anna','u','квантовый компьютер')['facts'])

class TestGrounding(unittest.TestCase):
    def test_wrong_llm_definition_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            e = Engine(Path(d)/'bad.sqlite3', llm=lambda *args: 'Бейдевинд - курс на противоположную сторону от ветра.')
            result = e.dialog('morozov', 'user', 'Что такое бейдевинд?')
            self.assertIn('курс под острым углом', result['text'])
            self.assertNotIn('противоположную сторону', result['text'])
    def test_verbatim_grounded_answer_allowed(self):
        with tempfile.TemporaryDirectory() as d:
            source = 'Бейдевинд — курс под острым углом к направлению, откуда дует ветер. Прямо против ветра парусная лодка идти не может.'
            e = Engine(Path(d)/'ok.sqlite3', llm=lambda *args: 'Курсант! ' + source)
            self.assertIn('Курсант!', e.dialog('morozov', 'user', 'Что такое бейдевинд?')['text'])
