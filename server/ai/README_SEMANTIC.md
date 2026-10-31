# Sail Academy AI — offline semantic RAG (stage 5)

This release extends the previous FSM + adaptive BKT build with **optional true
neural embedding retrieval** using a multilingual SentenceTransformer model.
Existing NPC personalities, verified facts, SQLite persistence, and Ollama
integration are preserved. No model weights are included in this ZIP.

## Quick tests (no downloads needed)

```bash
python3 -m unittest discover -s sail_ai/tests -v
```

The tests use a deterministic **fake encoder** to verify the wiring, ranking,
filtering and FSM. They do **not** validate real model quality. The system
continues to use lexical BM25 + concept matching until you configure a model.

## Download model ONCE, while online

Use a virtual environment (Python 3.11+):

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -U pip
python3 -m pip install sentence-transformers
python3 - <<'PY'
from sentence_transformers import SentenceTransformer
m = SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
m.save('models/multilingual-minilm')
print('Saved local model')
PY
```

The directory `models/multilingual-minilm` contains the weights for use
without Internet. Do not commit the model weights to Git unless team policy
allows it. Before the offline demonstration, test with Wi-Fi disconnected.

## Run local hybrid semantic search

```bash
export SAIL_EMBEDDING_MODEL="$PWD/models/multilingual-minilm"
python3 - <<'PY'
from sail_ai.engine import Engine
from sail_ai.semantic import SemanticRetriever, HybridRetriever
from sail_ai.fsm import GuidedDialog

engine = Engine('semantic_demo.sqlite3')
semantic = SemanticRetriever()  # Loads ONLY from the local directory
retriever = HybridRetriever(engine, semantic)

for query in [
    'Как называется движение яхты под углом навстречу ветру?',
    'Как выполнить разворот носом через ветер?',
    'Что делать, если яхта перевернулась?',
]:
    print('\nВопрос:', query)
    print('Найдено:', [(f['id'], f['title']) for f in retriever.search(query, k=3)])

chat = GuidedDialog(engine, retriever=retriever)
print(chat.dialog('morozov', 'student', 'Привет'))
print(chat.dialog('morozov', 'student', 'Бейдевинд'))
print(chat.dialog('morozov', 'student', 'Повтори'))
PY
```

`SemanticRetriever` requires a pre-downloaded model directory and requests
`local_files_only=True` when loading it. No online fallback. If a model isn't
configured, use `HybridRetriever(engine)` to retain the old working search.

## Architecture and limitations

1. `SemanticRetriever` embeds verified facts once at process startup.
2. User question is embedded and compared using cosine similarity.
3. Candidates below `threshold` (default 0.38, **needs empirical calibration**)
   are excluded; optional topic filtering is applied.
4. `HybridRetriever` combines ranked semantic and existing lexical results by
   reciprocal-rank fusion. Returned facts are canonical records from facts.json.
5. `GuidedDialog(engine, retriever=...)` uses the retriever to choose material
   without changing the existing repetition behavior.

The factual text is still sourced from `facts.json`, not invented by the model.
A real multilingual model may rank some ambiguous questions incorrectly. The
current KB has only nine facts; collect and evaluate real player queries before
claiming semantic search quality. Semantic model loading and embedding inference
may increase cold-start and first-answer latency. This is retrieval, not yet a
complete unified FSM + LLM generation pipeline or true token streaming.

## Integration with the team server

Create one shared `SemanticRetriever` and `HybridRetriever` at server startup;
create `GuidedDialog(engine, retriever=hybrid)` once. Authenticate players at
server level, then pass the authenticated player ID to `dialog`. Do not accept
an arbitrary player ID from an untrusted client. Validate race events on the
authoritative game server before calling `record_race_event`.
