import tempfile,unittest
from pathlib import Path
from sail_ai.engine import Engine
from sail_ai.adaptive import bkt_update

class TestAdaptive(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.e=Engine(Path(self.tmp.name)/'data.sqlite')
 def tearDown(self):self.tmp.cleanup()
 def test_success_improves_mastery(self):
  self.e.record_event('p','курсы','success')
  a=self.e.profile('p')['курсы']['mastery']
  self.e.record_event('p','курсы','success')
  self.assertGreater(self.e.profile('p')['курсы']['mastery'],a)
 def test_error_reduces_mastery(self):
  self.e.record_event('p','курсы','success')
  a=self.e.profile('p')['курсы']['mastery']
  self.e.record_event('p','курсы','race_error')
  self.assertLess(self.e.profile('p')['курсы']['mastery'],a)
 def test_race_mapping(self):
  result=self.e.record_race_event('p','no_go_zone','пытался идти прямо против ветра')
  self.assertEqual(result['topic'],'курсы')
  self.assertEqual(self.e.profile('p')['курсы']['errors'],1)
 def test_unknown_event(self):
  with self.assertRaises(ValueError):self.e.record_race_event('p','teleport')
 def test_isolation_and_persistence(self):
  self.e.record_event('p','правила','error')
  self.assertNotIn('правила',self.e.profile('q'))
  self.assertEqual(Engine(self.e.db_path).profile('p'),self.e.profile('p'))
 def test_error_in_dialog(self):
  self.e.record_race_event('p','no_go_zone')
  answer=self.e.dialog('morozov','p','бейдевинд')['text']
  self.assertIn('На практике',answer)
 def test_bkt_bounds(self):
  self.assertTrue(0 <= bkt_update(0.2,True) <= 1)
  self.assertTrue(0 <= bkt_update(0.2,False) <= 1)
