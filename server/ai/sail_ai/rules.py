"""Retrieve relevant context from the supplied racing rules PDF."""
from __future__ import annotations
import math
import re
from collections import Counter
from pathlib import Path

PDF_PATH = Path(__file__).resolve().parent / 'resources' / 'PPG_2025_2028.pdf'
STOP = {'что','это','как','для','или','при','если','когда','какое','какая','какие','можно','должна','должен','правило','правила','яхта','яхты','гонки','парусных','меня','про','расскажи','объясни','пожалуйста'}
def tokenize(s):
    return [w for w in re.findall(r'[а-яёa-z0-9]+',s.lower().replace('ё','е')) if len(w)>2 and w not in STOP]

class RulesIndex:
    def __init__(self, path=PDF_PATH):
        self.path=Path(path)
        self.pages=[]
        self.counters=[]
        self.df=Counter()
        self.avg=1
        if not self.path.exists():return
        try:
            import fitz
        except ImportError:
            raise RuntimeError('Install PyMuPDF: pip install pymupdf')
        with fitz.open(self.path) as doc:
            for i,page in enumerate(doc):
                txt=' '.join(page.get_text('text').split())
                # skip index/cover, retain actual printed page number in citation
                if len(txt)<100:continue
                words=Counter(tokenize(txt))
                self.pages.append({'pdf_page':i+1,'text':txt})
                self.counters.append(words)
                self.df.update(words.keys())
        self.avg=sum(sum(c.values()) for c in self.counters)/max(len(self.counters),1)

    def search(self, query, limit=3):
        q=tokenize(query)
        rule_ids=re.findall(r'\bправил[оауе]?\s*(\d{1,2}(?:\.\d+)?)\b',query.lower())
        if not q and not rule_ids:return []
        n=len(self.pages)
        scored=[]
        for page,counts in zip(self.pages,self.counters):
            dl=sum(counts.values())
            score=0.
            for term in set(q):
                tf=counts[term]
                if not tf:continue
                idf=math.log(1+(n-self.df[term]+.5)/(self.df[term]+.5))
                score+=idf*(tf*2.2)/(tf+1.2*(.25+.75*dl/self.avg))
            # rule number search: prioritize pages with exact numbered clause
            for rule in re.findall(r'\b(?:правил[оауе]?\s*)(\d{1,2}(?:\.\d+)?)\b',query.lower()):
                if re.search(r'(?<!\d)'+re.escape(rule)+r'\s+[А-ЯЁ]',page['text']):score+=8
            if score>0:
                # keep short extract around matched terms; page itself is the citation
                txt=page['text']
                matches=[m.start() for w in set(q) for m in list(re.finditer(r'(?i)\b'+re.escape(w)+r'\b',txt))[:8]]
                start=max(0,(min(matches) if matches else 0)-180)
                excerpt=txt[start:start+1050]
                scored.append((score,{'pdf_page':page['pdf_page'],'excerpt':excerpt,'source':'ППГ 2025–2028','score':round(score,3)}))
        return [item for _,item in sorted(scored,key=lambda x:-x[0])[:max(1,min(int(limit),5))]]

    def answer(self, question, npc=None, llm=None, player_context=None):
        """Generate a grounded NPC explanation; keep a useful offline fallback."""
        refs=self.search(question)
        warning='PDF содержит видимые редакторские правки; окончательную редакцию и гоночную инструкцию необходимо учитывать.'
        if not refs:
            return {'text':'В материалах ППГ не нашёл достаточно подходящего контекста. Уточни ситуацию.',
                    'references':[], 'generated':False, 'warning':warning}
        if llm is not None and hasattr(llm, 'explain_rules'):
            try:
                reply=llm.explain_rules(npc, question, refs, player_context)
                if reply and reply.strip():
                    return {'text':reply.strip(), 'references':refs, 'generated':True, 'warning':warning}
            except Exception:
                # Network, quota, missing key: continue with evidence rather than an error.
                pass
        # Fallback is intentionally a source extract, not a fabricated interpretation.
        excerpt=refs[0]['excerpt'].strip()
        prefix=(npc or {}).get('prefix','')
        return {'text':(prefix+' '+excerpt).strip() if prefix else excerpt,
                'references':refs,'generated':False,'warning':warning}
