import unittest
from sail_ai.rules import RulesIndex

class FakeLLM:
    def __init__(self): self.called=False
    def explain_rules(self,npc,question,references,player_context=None):
        self.called=True
        assert references and 'excerpt' in references[0]
        return 'Левый галс уступает правому. Следи за безопасным расхождением.'

class RulesGenerationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.index=RulesIndex()
    def test_generated_from_context(self):
        llm=FakeLLM()
        response=self.index.answer('Кто уступает на противоположных галсах?',llm=llm)
        self.assertTrue(llm.called)
        self.assertTrue(response['generated'])
        self.assertIn('Левый галс',response['text'])
        self.assertTrue(response['references'])
    def test_offline_fallback(self):
        response=self.index.answer('Кто уступает на противоположных галсах?')
        self.assertFalse(response['generated'])
        self.assertTrue(response['text'])
    def test_llm_failure_fallback(self):
        class Broken:
            def explain_rules(self,*args,**kwargs):raise TimeoutError()
        response=self.index.answer('правило 10',llm=Broken())
        self.assertFalse(response['generated'])
