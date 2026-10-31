import unittest
from sail_ai.rules import RulesIndex
class RulesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.idx=RulesIndex()
    def test_pdf_loaded(self):self.assertGreater(len(self.idx.pages),100)
    def test_rule_search(self):
        refs=self.idx.search('правило 10 противоположные галсы')
        self.assertTrue(refs)
        self.assertTrue(all('pdf_page' in r for r in refs))
    def test_answer_citations(self):
        out=self.idx.answer('правило 10')
        self.assertTrue(out['references'])
        self.assertFalse(out['generated'])
    def test_empty(self):self.assertEqual(self.idx.search('и что это'),[])
