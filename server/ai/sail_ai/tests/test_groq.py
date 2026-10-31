import json
import unittest
from unittest.mock import patch
from sail_ai.groq_client import Groq
from sail_ai.engine import NPCS, FACTS

class FakeResponse:
 def __enter__(self):return self
 def __exit__(self,*args):pass
 def read(self):return b''

class TestGroq(unittest.TestCase):
 def test_no_key(self):
  with self.assertRaises(RuntimeError):Groq(api_key='')(NPCS['morozov'],'Вопрос',FACTS[0])
 def test_grounded(self):
  fact=FACTS[0]
  class Response(FakeResponse):
   def read(self):return json.dumps({'choices':[{'message':{'content':fact['text']}}]}).encode()
  with patch('sail_ai.groq_client.urlopen',return_value=Response()):
   result=Groq(api_key='test') (NPCS['morozov'],'Вопрос',fact)
  self.assertEqual(result,fact['text'])
 def test_rejects_unverified(self):
  class Response(FakeResponse):
   def read(self):return b'{"choices":[{"message":{"content":"Incorrect."}}]}'
  with patch('sail_ai.groq_client.urlopen',return_value=Response()):
   with self.assertRaises(ValueError):Groq(api_key='test')(NPCS['morozov'],'Вопрос',FACTS[0])
