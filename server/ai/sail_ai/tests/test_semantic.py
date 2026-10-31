import tempfile
import unittest
from pathlib import Path
from sail_ai.engine import Engine, FACTS
from sail_ai.semantic import SemanticRetriever, HybridRetriever, cosine
from sail_ai.fsm import GuidedDialog


class FakeEncoder:
    """Controlled embeddings, NOT a claim about model accuracy."""
    def encode(self, texts, **kwargs):
        output = []
        for text in texts:
            low = text.lower()
            if 'острым углом' in low or 'спереди по диагонали' in low:
                output.append([1., 0., 0.])
            elif 'оверштаг' in low or 'разворот через нос' in low:
                output.append([0., 1., 0.])
            else:
                output.append([0., 0., 1.])
        return output


class TestSemantic(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.engine = Engine(Path(self.temp.name) / 'db.sqlite3')
        self.semantic = SemanticRetriever(encoder=FakeEncoder(), threshold=.6)
        self.hybrid = HybridRetriever(self.engine, self.semantic)

    def tearDown(self):
        self.temp.cleanup()

    def test_cosine(self):
        self.assertAlmostEqual(cosine([1, 0], [1, 0]), 1.)
        self.assertEqual(cosine([1, 0], [0, 1]), 0.)
        self.assertEqual(cosine([0, 0], [1, 0]), 0.)

    def test_semantic_paraphrase(self):
        result = self.semantic.ranked('Спереди по диагонали', k=1)
        self.assertEqual(result[0][1]['id'], 'course_close')

    def test_topic_filter(self):
        result = self.semantic.ranked('Спереди по диагонали', topics=['безопасность'])
        self.assertEqual(result, [])

    def test_hybrid_uses_embeddings(self):
        self.assertEqual(self.hybrid.search('Спереди по диагонали', k=1)[0]['id'], 'course_close')

    def test_no_embedding_fallback(self):
        self.assertEqual(HybridRetriever(self.engine).search('Бейдевинд', k=1)[0]['id'], 'course_close')

    def test_fsm_uses_retriever(self):
        chat = GuidedDialog(self.engine, retriever=self.hybrid)
        chat.dialog('morozov', 'p', 'привет')
        response = chat.dialog('morozov', 'p', 'Спереди по диагонали')
        self.assertEqual(response['facts'], ['course_close'])
        self.assertEqual(response['state'], 'check')
        self.assertEqual(chat.dialog('morozov', 'p', 'повтори')['facts'], ['course_close'])

    def test_requires_local_model(self):
        with self.assertRaises(FileNotFoundError):
            SemanticRetriever(model_path='/path/does/not/exist')


if __name__ == '__main__':
    unittest.main()
