# OpenCode Backfill for Hindsight

Import historical [OpenCode](https://opencode.ai) coding sessions into [Hindsight](https://hindsight.vectorize.io) for long-term agent memory.

Also supports JSONL transcript files from Claude Code or other tools.

## Prerequisites

- Python 3.10+
- A running Hindsight server (Docker, embedded, or cloud)
- `pip install hindsight-client>=0.4.0`

## Usage

### OpenCode Sessions

```bash
python backfill/backfill.py opencode \
  --hindsight-url http://localhost:8888 \
  --bank-id opencode

python backfill/backfill.py opencode \
  --hindsight-url http://localhost:8888 \
  --bank-id opencode \
  --since 2026-03-01 \
  --project my-project \
  --verbose

python backfill/backfill.py opencode \
  --hindsight-url http://localhost:8888 \
  --bank-id opencode \
  --dry-run
```

Reads from `~/.local/share/opencode/opencode.db`. Override with `--db /path/to/db`.

Each session is retained with `document_id=opencode-session-{id}`, making the script idempotent. Re-running it will not create duplicates.

### JSONL Transcripts

```bash
python backfill/backfill.py jsonl \
  --hindsight-url http://localhost:8888 \
  --bank-id my-agent \
  --input "./transcripts/*.jsonl"
```

The `--input` flag accepts quoted glob patterns or explicit file paths. Both forms work:
- Quoted (Python expands the glob): `--input "./transcripts/*.jsonl"`
- Unquoted (shell expands the glob): `--input ./transcripts/*.jsonl`

Accepts two JSONL formats per line:
- Flat: `{"role": "user", "content": "..."}`
- Claude Code nested: `{"type": "user", "message": {"role": "user", "content": "..."}}`

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--hindsight-url` | required | Hindsight API URL |
| `--bank-id` | required | Target memory bank ID |
| `--token` | none | Hindsight API token |
| `--since DATE` | all | Only sessions after this ISO date |
| `--project NAME` | all | Only sessions in this project directory |
| `--skip-subagent` / `--no-skip-subagent` | true | Skip subagent sessions (see below) |
| `--include-tools` | false | Include tool call markers in transcripts |
| `--min-chars N` | 200 | Minimum transcript length |
| `--dry-run` | false | Preview without ingesting |
| `--verbose` | false | Print per-session details |

## How It Works

OpenCode stores all session data in a SQLite database:

```text
~/.local/share/opencode/opencode.db

Tables:
  session  (id, title, directory, time_created)
  message  (id, session_id, data JSON with role/modelID)
  part     (id, message_id, data JSON with type/text/tool)
```

The script queries these tables, reconstructs conversation transcripts from text parts, and calls Hindsight's retain API per session.

### Subagent detection

Sessions are classified as "subagent" if their title contains the word "subagent" (case-insensitive). This targets sessions spawned by the Task tool in OpenCode/Claude Code, which delegate work to a child agent. The parent session already captures the subagent's outcome, so ingesting both would create duplicate memories.

If your sessions use a different naming convention, use `--no-skip-subagent` to include all sessions, or filter by `--project` instead.

### Timestamps

OpenCode stores `time_created` as milliseconds since epoch. The script converts these to UTC `datetime` objects before passing them to Hindsight's retain API.
