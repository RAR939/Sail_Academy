import tempfile
import unittest
from pathlib import Path
from sail_ai.engine import Engine, FACTS
from sail_ai.fsm import GuidedDialog
from sail_ai.integrated import IntegratedTutor

class TestIntegrated(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.engine=Engine(str(Path(self.tmp.name)/'db.sqlite'))
        self.tutor=IntegratedTutor(self.engine,GuidedDialog(self.engine))
    def tearDown(self):
        self.tmp.cleanup()
    def test_fsm_repeat_and_source(self):
        self.tutor.dialog('morozov','p1','Привет')
        first=self.tutor.dialog('morozov','p1','Бейдевинд')
        self.assertEqual(first['facts'],['course_close'])
        self.assertEqual(first['source'],next(f['text'] for f in FACTS if f['id']=='course_close'))
        self.tutor.dialog('morozov','p1','Непонятно')
        again=self.tutor.dialog('morozov','p1','Повтори')
        self.assertEqual(again['facts'],['course_close'])
        self.assertFalse(again['generated'])
    def test_groq_valid_answer(self):
        self.tutor.dialog('morozov','p','Привет')
        self.engine.llm=lambda npc,question,fact,*args: 'Курсант! '+fact['text']+' Всё понятно?'
        result=self.tutor.dialog('morozov','p','Бейдевинд')
        self.assertTrue(result['generated'])
        self.assertIn('Бейдевинд',result['text'])
    def test_groq_wrong_answer_falls_back(self):
        self.tutor.dialog('morozov','p','Привет')
        self.engine.llm=lambda *args: 'Бейдевинд — лодка, идущая прямо против ветра.'
        result=self.tutor.dialog('morozov','p','Бейдевинд')
        self.assertFalse(result['generated'])
        self.assertIn('Прямо против ветра',result['text'])
    def test_race_report_player_isolation(self):
        self.engine.record_race_event('p1','no_go_zone','Пошёл против ветра')
        self.engine.record_race_event('p2','failed_tack','Срыв поворота')
        report=self.tutor.race_report('p1')
        self.assertEqual(report['events_count'],1)
        self.assertEqual(report['topics'][0]['topic'],'курсы')
        self.assertEqual(report['topics'][0]['errors'],1)
        self.assertNotIn('Срыв поворота',str(report))
    def test_report_empty(self):
        report=self.tutor.race_report('new')
        self.assertEqual(report['events_count'],0)
        self.assertEqual(report['recommendations'],[])

if __name__=='__main__':unittest.main()
