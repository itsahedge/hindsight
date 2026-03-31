---
title: "Shared Memory for a Swarm of OpenClaw Agents"
authors: [benfrank241]
date: 2026-03-06T12:00
tags: [openclaw, memory, agents, persistent-memory, knowledge-graph]
image: /img/blog/adding-memory-to-openclaw-with-hindsight.png
hide_table_of_contents: true
---

OpenClaw makes it easy to run an AI assistant across every channel your team uses — Slack, Discord, Telegram, WhatsApp, and more. But by default, each agent instance is an island: what one learns, none of the others know. [Hindsight](https://github.com/vectorize-io/hindsight) gives your entire swarm a shared memory bank. One agent has a conversation on Slack; another picks up that context in Discord minutes later — automatically.

<!-- truncate -->

## TL;DR

- OpenClaw makes it easy to deploy a swarm of agents across many platforms, but each instance starts with an empty memory. There's no built-in way to share learned context across agents.
- Hindsight gives your swarm a shared memory bank. Every agent retains to the same store and recalls from it before every response — automatically, with no tool calls required.
- One plugin install per instance. Point all instances at the same Hindsight endpoint and bank. That's the entire setup.
- For single-instance use, Hindsight also runs locally: the `hindsight-embed` daemon bundles the full memory engine (API + PostgreSQL) into one process, no Docker needed.
- Within a single instance, you can collapse all channels into one shared bank — a useful alternative to the default per-channel isolation.

## The Problem

OpenClaw is designed to run everywhere your team communicates. A single team might run OpenClaw instances on Slack, Discord, Telegram, and a dedicated webhook endpoint — each connected to the same underlying LLM, each doing similar work.

But those instances share nothing. If a user tells one agent their deployment pipeline runs on Fridays, the Slack instance knows — but the Discord instance doesn't. If someone shares a useful fact in Telegram, it doesn't propagate to the other agents. Each instance starts fresh every session.

OpenClaw does have built-in memory. It's a thoughtful design: daily notes in `memory/YYYY-MM-DD.md`, a curated `MEMORY.md` for long-term knowledge, and a SQLite-backed vector index for semantic search. But there's a fundamental constraint: **the agent has to decide what to remember**. The docs say it directly — "If you want something to stick, ask the bot to write it."

In a swarm, this creates two compounding problems:

1. **No cross-agent propagation.** Facts learned by one instance never reach the others. There's no shared store, no sync, no way for one agent's conversations to teach the rest.
2. **Unreliable capture.** Even within a single instance, memory depends on the model choosing to save things. Important context slips through when the model doesn't think to write it down.

## The Approach

[Hindsight](https://github.com/vectorize-io/hindsight) is an open-source memory engine that gives your OpenClaw swarm a single shared knowledge store. Install the plugin on each instance, point them all at the same Hindsight API endpoint, and configure a shared bank ID. Every agent in the swarm reads from and writes to the same memory.

```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  OpenClaw    │   │  OpenClaw    │   │  OpenClaw    │
│  Agent A     │   │  Agent B     │   │  Agent C     │
│  (Slack)     │   │  (Discord)   │   │  (Telegram)  │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
              ┌───────────▼───────────┐
              │   Hindsight Memory    │
              │   (shared bank)       │
              │   api.hindsight...    │
              └───────────────────────┘
```

What this gives you:

**Automatic capture, not manual.** Every conversation is captured after each turn without the agent needing to decide what's worth remembering. Hindsight extracts facts, entities, and relationships in the background — the model doesn't need to be prompted to "save this."

**Auto-recall, not tool-based retrieval.** Hindsight injects relevant memory into context *before* every agent response. Agents don't call a `memory_search` tool — they just have the right context.

**Cross-agent learning.** When Agent A learns something on Slack, Agent B has it available on Discord. The shared bank makes the swarm behave like a single agent with a unified memory.

**Feedback loop prevention.** Injected memories would normally get re-stored and re-extracted, causing exponential growth and duplicates. The plugin automatically strips its own `<hindsight_memories>` tags before retention, preventing this loop.

## Implementation

### Step 1: Set Up a Shared Hindsight Endpoint

The swarm scenario requires all instances to connect to the same Hindsight API. The fastest way is [Hindsight Cloud](https://ui.hindsight.vectorize.io/signup) — sign up, create a bank, and get an API URL and token. You can also self-host Hindsight on your own infrastructure.

For testing a single agent locally, you can skip this step and use the local daemon (see below).

### Step 2: Configure an LLM Provider

Each Hindsight instance needs an LLM for memory extraction. This is separate from your agent's primary model — it runs in the background and handles fact/entity/relationship extraction.

```bash
# Option A: OpenAI (uses gpt-4o-mini)
export OPENAI_API_KEY="YOUR_API_KEY"

# Option B: Anthropic (uses claude-3-5-haiku)
export ANTHROPIC_API_KEY="YOUR_API_KEY"

# Option C: Gemini (uses gemini-2.5-flash)
export GEMINI_API_KEY="YOUR_API_KEY"

# Option D: Groq (uses openai/gpt-oss-20b)
export GROQ_API_KEY="YOUR_API_KEY"

# Option E: Claude Code (no API key needed)
export HINDSIGHT_API_LLM_PROVIDER=claude-code

# Option F: OpenAI Codex (no API key needed)
export HINDSIGHT_API_LLM_PROVIDER=openai-codex
```

You can also point it at any OpenAI-compatible endpoint, including OpenRouter:

```bash
export HINDSIGHT_API_LLM_PROVIDER=openai
export HINDSIGHT_API_LLM_MODEL=xiaomi/mimo-v2-flash
export HINDSIGHT_API_LLM_API_KEY=YOUR_API_KEY
export HINDSIGHT_API_LLM_BASE_URL=https://openrouter.ai/api/v1
```

A smaller, cheaper model is the right call here. Memory extraction doesn't need your most capable model.

### Step 3: Install the Plugin

Run this on every instance in the swarm:

```bash
openclaw plugins install @vectorize-io/hindsight-openclaw
```

You should see output confirming the install and that Hindsight takes over the memory slot:

```
Exclusive slot "memory" switched from "memory-core" to "hindsight-openclaw".
Installed plugin: hindsight-openclaw
```

### Step 4: Point Every Instance at the Shared Bank

Configure each agent to use the same Hindsight endpoint and bank ID. The simplest way is environment variables:

```bash
export HINDSIGHT_EMBED_API_URL=https://api.hindsight.vectorize.io
export HINDSIGHT_EMBED_API_TOKEN=YOUR_API_TOKEN
openclaw gateway
```

Or in `~/.openclaw/openclaw.json` on each machine:

```json
{
  "plugins": {
    "entries": {
      "hindsight-openclaw": {
        "enabled": true,
        "config": {
          "hindsightApiUrl": "https://api.hindsight.vectorize.io",
          "hindsightApiToken": "YOUR_API_TOKEN",
          "dynamicBankId": false
        }
      }
    }
  }
}
```

Setting `dynamicBankId: false` disables the default per-channel/per-agent bank derivation and routes all memory through a single shared bank. This is the key config change for the swarm scenario.

> **Note:** Environment variables take precedence over plugin config. If you have both set, the env var wins.

### Verifying the Swarm Is Working

After a few conversations across instances, check the logs on each:

```bash
tail -f /tmp/openclaw/openclaw-*.log | grep Hindsight
```

You should see consistent bank IDs and memory operations across instances:

```
[Hindsight] External API mode enabled: https://api.hindsight.vectorize.io
[Hindsight] External API health check passed
[Hindsight] Retained X messages for session ...
[Hindsight] Auto-recall: Injecting X memories
```

To browse the shared memory store, use the web UI — but point it at your external endpoint:

```bash
HINDSIGHT_EMBED_API_URL=https://api.hindsight.vectorize.io \
HINDSIGHT_EMBED_API_TOKEN=YOUR_API_TOKEN \
uvx hindsight-embed@latest -p openclaw ui
```

## Memory Isolation: Tuning the Shared Bank

By default, the plugin creates separate memory banks based on agent, channel, and user context — `["agent", "channel", "user"]`. For the swarm scenario, you want to override this so all instances share one store.

**Single shared bank for the entire swarm** — everything one agent learns is available to all others:

```json
{
  "dynamicBankId": false
}
```

**Per-user shared bank** — all agents share a memory store per user, across all channels and instances. A user's context follows them wherever they interact with the swarm:

```json
{
  "dynamicBankGranularity": ["user"]
}
```

**Single instance: collapse all channels into one bank** — if you're running a single OpenClaw instance across many channels (WhatsApp, Telegram, Slack) and want them to share a unified memory rather than keeping per-channel silos, set granularity to just `["user"]` or use `dynamicBankId: false`. This is useful for personal assistants where you want a consistent memory regardless of which channel you're using.

Available isolation fields:
- `agent` — the bot identity
- `channel` — the conversation or group ID
- `user` — the person interacting with the bot
- `provider` — the messaging platform (Slack, Telegram, etc.)

Use `bankIdPrefix` to namespace banks across environments (e.g. `"prod"`, `"staging"`).

## Local Mode (Single Instance)

For testing or personal use with a single OpenClaw instance, you don't need a remote Hindsight server. The `hindsight-embed` daemon bundles the full memory engine and a PostgreSQL instance into a single local process:

```
┌─────────────────┐       ┌────────────────────────────────┐
│    OpenClaw      │       │    hindsight-embed daemon      │
│    Gateway       │──────▶│    ┌──────────┐ ┌───────────┐ │
│                  │◀──────│    │ Memory   │ │PostgreSQL │ │
│ WhatsApp/Slack/  │       │    │ API      │─│(embedded) │ │
│ Telegram/...     │       │    └──────────┘ └───────────┘ │
└─────────────────┘       └────────────────────────────────┘
                            runs locally · port 9077
```

Just install the plugin and launch — no external endpoint configured:

```bash
openclaw gateway
```

The daemon starts automatically on port 9077. You should see:

```
[Hindsight] ✓ Using provider: openai, model: gpt-4o-mini
```

To browse what your local agent has learned:

```bash
uvx hindsight-embed@latest -p openclaw ui
```

## Retention and Recall Controls

The plugin ships with sensible defaults, but most behaviors are configurable.

**Retention** controls what gets stored:

| Option | Default | Description |
|--------|---------|-------------|
| `autoRetain` | `true` | Auto-retain conversations after each turn. Set `false` to disable. |
| `retainRoles` | `["user", "assistant"]` | Which message roles to include in retained transcript. |
| `retainEveryNTurns` | `1` | Retain every Nth turn. Values > 1 enable chunked retention with a sliding window. |
| `retainOverlapTurns` | `0` | Extra prior turns included when chunked retention fires. |

**Recall** controls what gets injected:

| Option | Default | Description |
|--------|---------|-------------|
| `autoRecall` | `true` | Auto-inject memories before each turn. Set `false` when the agent has its own recall tool. |
| `recallBudget` | `"mid"` | Recall effort: `low`, `mid`, or `high`. Higher budgets use more retrieval strategies. |
| `recallMaxTokens` | `1024` | Max tokens for recall response — controls how much memory context is injected per turn. |
| `recallTypes` | `["world", "experience"]` | Memory types to recall. Excludes verbose `observation` entries by default. |
| `recallTopK` | unlimited | Hard cap on number of memories injected per turn. |
| `recallContextTurns` | `1` | Number of prior user turns to include when composing the recall query. |
| `recallPromptPreamble` | built-in string | Custom text placed above recalled memories in the injected context. |

Example: high-fidelity recall with multi-turn context:

```json
{
  "plugins": {
    "entries": {
      "hindsight-openclaw": {
        "enabled": true,
        "config": {
          "recallBudget": "high",
          "recallMaxTokens": 2048,
          "recallContextTurns": 3,
          "recallTopK": 10
        }
      }
    }
  }
}
```

## Pitfalls & Edge Cases

**Memory extraction is asynchronous.** Facts are extracted after each turn in the background. If one agent in the swarm learns something and another agent is asked about it immediately, the most recent facts may still be processing. In practice this is a second or two.

**Extraction quality depends on your model choice.** A very small or low-quality extraction model will miss nuanced technical details. `gpt-4o-mini` and `claude-3-5-haiku` are solid defaults.

**The recall window is bounded.** The default `recallMaxTokens` of 1024 means not every relevant memory appears in every response. Retrieval is relevance-ranked, so the most pertinent facts surface first, but be aware of the ceiling. Increase to 2048 or higher in config for a dense shared bank.

**In a swarm, high-traffic banks grow fast.** If many agents are retaining to the same bank simultaneously, the memory store will accumulate facts quickly. This is generally fine — Hindsight deduplicates and entity-resolves — but monitor your bank size if you're running many high-volume instances.

**The embedded PostgreSQL needs system libraries.** `hindsight-embed` bundles PostgreSQL via [pg0](https://github.com/vectorize-io/pg0). On minimal Docker images (e.g. `ubuntu:latest`), you'll need to install `libxml2` and `libreadline` before the daemon can start:

```bash
apt-get install -y libxml2 libreadline8t64
```

Check the pg0 README for your platform if you hit other missing library errors.

**PostgreSQL cannot run as root.** If you're running inside Docker, make sure you're using a non-root user. Create a user and switch to it:

```dockerfile
RUN useradd -m -s /bin/bash myuser
USER myuser
```

**First run downloads ~3GB of dependencies.** On the very first `openclaw gateway` launch, `hindsight-embed` downloads Python packages including PyTorch and sentence-transformers. This can take several minutes. Subsequent launches use cached packages — one-time cost.

**Debug logging.** If something isn't working as expected, enable `debug: true` in the plugin config for verbose logging of recall queries, retention transcripts, bank ID derivation, and more.

## Tradeoffs & Alternatives

**Swarm with shared bank** — the scenario this post covers. All instances retain and recall from the same store. One agent's conversations teach the whole swarm. Requires an external Hindsight endpoint (Cloud or self-hosted).

**Single instance, per-channel isolation** — the default. Each channel gets its own memory store. Simpler, and appropriate when you want strict separation between contexts (e.g. different teams in different Slack channels). No external endpoint needed — runs fully locally.

**Single instance, unified bank** — collapse all channels on one OpenClaw instance into a single shared memory. Good for personal assistants where you want the same context regardless of which app you're using. Set `dynamicBankGranularity: ["user"]` or `dynamicBankId: false` against a local or remote endpoint.

**When to stick with OpenClaw's built-in memory:**
- You prefer plain Markdown files you can read, edit, and version control.
- Your use case is lightweight and session-scoped.
- You're running a single instance and don't need cross-session or cross-agent memory.

## Recap

OpenClaw makes it easy to deploy AI agents everywhere your team communicates. Hindsight makes those agents smarter together — every conversation one agent has teaches the rest, through a shared memory bank that auto-captures facts and auto-injects relevant context before every response.

The swarm setup is: install the plugin on each instance, point them all at the same Hindsight endpoint, set `dynamicBankId: false`. That's it.

For single-instance use, the local daemon gives you the same structured memory without the external dependency.

## Next Steps

- Deploy the plugin on two OpenClaw instances and have conversations on each. Verify that context from one appears in the other's recall output.
- Experiment with `dynamicBankGranularity` to find the right isolation model for your team.
- Tune recall with `recallBudget`, `recallMaxTokens`, and `recallContextTurns` to find the right balance for your bank size.
- Browse the [Hindsight source on GitHub](https://github.com/vectorize-io/hindsight) to understand the extraction pipeline.
- Read the [full integration docs](https://hindsight.vectorize.io/sdks/integrations/openclaw) for the complete configuration reference.
