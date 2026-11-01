import tempfile, unittest
from pathlib import Path
from sail_ai.engine import Engine
class TestAI(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.e=Engine(Path(self.tmp.name)/'test.db')
 def tearDown(self):self.tmp.cleanup()
 def test_all_npcs(self):
  for npc,q in [('morozov','что такое бейдевинд'),('anna','право пути левый галс'),('li','что такое вымпельный ветер'),('mikhalych','что значит лево руля')]:
   self.assertTrue(self.e.dialog(npc,'u',q)['facts'])
 def test_memory(self):
  a=self.e.dialog('morozov','u','бейдевинд');b=self.e.dialog('morozov','u','бейдевинд')
  self.assertNotEqual(a['text'],b['text']);self.assertEqual(a['facts'],b['facts'])
 def test_persistence(self):
  self.e.record_event('u','правила','race_error','уступил поздно')
  other=Engine(self.e.db_path)
  self.assertEqual(other.profile('u')['правила']['errors'],1)
 def test_player_isolation(self):
  self.e.dialog('morozov','u','бейдевинд')
  self.assertNotIn('уже обсуждали',self.e.dialog('morozov','v','бейдевинд')['text'])
 def test_stream(self):
  msgs=list(self.e.stream('li','u','спасательный жилет'))
  self.assertTrue(msgs[-1]['done'])
 def test_unknown(self):
  with self.assertRaises(ValueError):self.e.dialog('bad','u','привет')
 def test_no_hallucination(self):
  r=self.e.dialog('anna','u','квантовый компьютер')
  self.assertFalse(r['facts'])
 def test_recommend(self):
  self.assertTrue(self.e.recommend('u'))
 def test_greeting(self):
  self.assertEqual(self.e.dialog('li','u','')['state'],'choose')
 def test_bye(self):
  self.assertEqual(self.e.dialog('li','u','пока')['state'],'bye')
if __name__=='__main__':unittest.main()
