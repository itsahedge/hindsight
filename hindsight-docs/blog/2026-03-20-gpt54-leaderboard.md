---
title: "GPT-5.4-nano and GPT-5.4-mini on the Hindsight Retain Leaderboard"
description: We've added GPT-5.4-nano and GPT-5.4-mini to the Hindsight retain benchmark. Both land in the top 5 with perfect schema conformance and strong quality scores.
authors: [benfrank241]
date: 2026-03-20
tags: [leaderboard, openai, benchmarks]
image: /img/blog/gpt54-leaderboard.png
hide_table_of_contents: true
---

We've added OpenAI's GPT-5.4-nano and GPT-5.4-mini to the [Hindsight retain leaderboard](https://benchmarks.hindsight.vectorize.io/leaderboard/retain). Both land in the top 5 and both pass all 50 schema conformance tests — a bar that a number of larger models don't clear.

<!-- truncate -->

The leaderboard benchmarks models on the `retain()` function: fact extraction accuracy on the LoComo benchmark, latency, throughput, cost, and JSON schema reliability. The weighted score is 40% quality, 25% speed, 20% cost, and 15% reliability.

## Results

| Model | Rank | Score | Quality | Speed | Cost (in/out per 1M) | Reliability |
|---|---|---|---|---|---|---|
| gpt-5.4-nano | 4 | 83.9 | 84% | 6.4s · 686 tok/s | $0.10 / $0.40 | 50/50 |
| gpt-5.4-mini | 5 | 86.4 | 86% | 5.4s · 705 tok/s | $0.40 / $1.60 | 50/50 |

A few things stand out:

**Mini scores higher on quality and speed than nano**, but ranks lower overall because of cost. At $0.40/$1.60 per million tokens versus nano's $0.10/$0.40, the cost component pulls the overall score down even though it wins on every other dimension.

**Both pass all 50 schema conformance tests.** Reliability is a genuine differentiator for the retain use case — a model that produces malformed JSON even occasionally means lost memories. Several models that otherwise look competitive fail here.

**Both are competitive with the current top 3** (Groq's gpt-oss-20b/120b and gpt-4.1-nano), especially mini on pure quality.

## Which one to use

- **gpt-5.4-nano** if cost matters: best quality-per-dollar of the two, and still 84% accurate on a challenging long-term conversation benchmark.
- **gpt-5.4-mini** if you want better accuracy and can absorb the higher token cost — it outperforms nano on both quality and throughput.

See the full leaderboard at [benchmarks.hindsight.vectorize.io/leaderboard/retain](https://benchmarks.hindsight.vectorize.io/leaderboard/retain).
