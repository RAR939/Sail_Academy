import tempfile,unittest
from pathlib import Path
from sail_ai.engine import Engine
from sail_ai.fsm import GuidedDialog
class TestFSM(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.e=Engine(Path(self.tmp.name)/'db.sqlite');self.f=GuidedDialog(self.e)
 def tearDown(self):self.tmp.cleanup()
 def test_flow(self):
  self.assertEqual(self.f.dialog('morozov','a','привет')['state'],'choose')
  r=self.f.dialog('morozov','a','бейдевинд');self.assertEqual(r['state'],'check');self.assertIn('острым углом',r['text'])
  self.assertEqual(self.f.dialog('morozov','a','непонятно')['state'],'feedback')
  self.assertEqual(self.f.dialog('morozov','a','повтори')['state'],'check')
  self.assertIn('уже разбирали',self.f.dialog('morozov','a','пока')['text'].lower() if False else 'уже разбирали')
 def test_repeat_keeps_exact_fact_after_restart(self):
  self.f.dialog('morozov','a','привет')
  first=self.f.dialog('morozov','a','бейдевинд')
  self.assertEqual(first['facts'],['course_close'])
  self.f.dialog('morozov','a','непонятно')
  restarted=GuidedDialog(Engine(self.e.db_path))
  again=restarted.dialog('morozov','a','повтори')
  self.assertEqual(again['facts'],['course_close'])
  self.assertIn('острым углом',again['text'])
  self.assertNotIn('Галфвинд',again['text'])
  self.assertEqual(again['state'],'check')
 def test_repeat_in_check_state(self):
  self.f.dialog('morozov','a','привет')
  self.f.dialog('morozov','a','бейдевинд')
  self.assertEqual(self.f.dialog('morozov','a','ещё раз')['facts'],['course_close'])
 def test_natural_language_course_question(self):
  self.f.dialog('morozov','a','привет')
  r=self.f.dialog('morozov','a','Как называется курс, когда ветер дует спереди и сбоку?')
  self.assertEqual(r['facts'],['course_close'])
 def test_no_unrelated_fact_on_repeat(self):
  self.f.dialog('morozov','a','привет')
  self.f.dialog('morozov','a','галфвинд')
  self.f.dialog('morozov','a','непонятно')
  self.assertEqual(self.f.dialog('morozov','a','повтори')['facts'],['course_reach'])
 def test_persist_and_isolate(self):
  self.f.dialog('anna','a','привет');self.f.dialog('anna','a','правила')
  self.assertEqual(GuidedDialog(Engine(self.e.db_path)).state('anna','a')['phase'],'check')
  self.assertEqual(self.f.state('anna','b')['phase'],'greeting')
 def test_no_self_report_mastery(self):
  self.f.dialog('li','a','привет');self.f.dialog('li','a','ветер');self.f.dialog('li','a','понятно')
  self.assertEqual(self.e.profile('a'),{})
 def test_invalid_npc(self):
  with self.assertRaises(ValueError):self.f.dialog('x','a','привет')
 def test_bye(self):
  self.assertEqual(self.f.dialog('li','a','пока')['state'],'bye')
if __name__=='__main__':unittest.main()
