# CreatorOS

**Agents that read, decide, and act on a YouTube creator's real work.**

Built for the [Mesh API Hackathon 2026](https://hack.meshapi.ai). Ten agents share one engine — tool-calling, expert skills, a grounding validator, durable memory, streaming — and they act on your *actual* accounts (Gmail, Docs, Sheets) through Composio's 1,000+ connectors.

---

## Every AI call routes through Mesh

This is the hackathon's hard requirement, so here is how to verify it in ten seconds.

**Every model call goes through [`src/services/mesh.ts`](src/services/mesh.ts) or [`src/services/mesh-image.ts`](src/services/mesh-image.ts).** No provider SDK is imported anywhere in `src/`, and the only AI host contacted is `api.meshapi.ai`.

```bash
# Every Mesh entry point. All AI traffic funnels through these:
grep -nE "^export (async )?function\*? " src/services/mesh.ts
#   callMesh          — single-turn JSON
#   callMeshText      — single-turn text
#   callMeshChat      — multi-turn chat
#   callMeshVision    — multimodal (reads a channel's thumbnails)
#   callMeshWithTools — one step of the tool-calling loop
#   callMeshJson      — typed deliverables
#   streamMeshChat    — SSE token streaming

# The only AI hosts contacted anywhere in src/:
grep -rhoE "https://api\.meshapi\.ai[a-z/0-9.]*" src/services/*.ts | sort -u
#   https://api.meshapi.ai/v1/chat/completions
#   https://api.meshapi.ai/v1          → /images/generations, /images/edits

# Direct provider calls (prints nothing):
grep -rlE "api\.openai\.com|generativelanguage|anthropic\.com|api\.deepseek" src/

# Provider SDKs imported in our source (prints nothing):
grep -rnE "from ['\"](openai|@anthropic-ai/|@google/generative-ai)['\"]" src/
```

> **One honest footnote.** `openai` does appear in `node_modules` — it is a *peer dependency of `@composio/core`*, the connector SDK. We never import it, and no model call touches it. The two greps above prove it.

## Multi-model: the right model for the job

One gateway, four models, chosen per task — the reason a unified LLM gateway earns its keep.

| Task | Model | Where |
|---|---|---|
| Reasoning, agent loop, typed deliverables | `deepseek-ai/deepseek-v3` | `mesh.ts` (default) |
| Vision — reading a channel's thumbnails | `openai/gpt-4o-mini` | `callMeshVision` |
| Text → image thumbnails | `openai/gpt-image-1` | `mesh-image.ts` · `GEN_MODEL` |
| **Identity-preserving** image edits | `google/gemini-2.5-flash-image` | `mesh-image.ts` · `EDIT_MODEL` |

The image path has a real fallback chain — Nano Banana → `gpt-image-1` → text-to-image — so it never hard-fails.

---

## What makes it different

### 1. Thumbnails with *your* face, from just a channel link

Paste a channel URL. The agent reads that channel's recent thumbnails with vision, extracts the style **and** the recurring creator, then generates new thumbnails featuring the **actual creator's face** — with no photo upload.

`gpt-image-1` invents a random stranger when given no reference. Switching the reference engine to `gemini-2.5-flash-image` and feeding it the channel's own thumbnails as references fixed it. Verified live against a real creator's channel.

### 2. Agents that act on real accounts

Connect Gmail — or any of Composio's **1,047** apps — once, and every agent can use it as a tool. Composio returns tools already in OpenAI function-calling shape, so they drop straight into the Mesh tool loop.

The **Sponsorship Manager** searches your real inbox, triages each brand deal, and flags the scope terms the brand quietly left out.

Agents only load tools for apps that are actually connected; for the rest they tell you to connect them rather than failing in a loop.

### 3. Agents that cannot cite what they never saw

Models invent evidence, and asking them not to is not enough — ours fabricated an outlier video (*"CodeWithMe — 150K views / 5K subs"*) that never existed.

So deliverables are **grounded server-side** ([`deliverables.ts`](src/ai/agents/deliverables.ts)):

- A Trend Scout idea whose evidence video never appeared in a tool result gets its evidence **stripped**.
- An SEO chapter stays `verified` only if its words appear in the **real transcript**.

### 4. Skills — expert playbooks, loaded on demand

Nine playbooks in [`src/ai/skills/`](src/ai/skills/): hook writing, CTR title patterns, retention structure, YouTube SEO, repurposing, channel strategy, sponsorship negotiation, opportunity scoring, analytics interpretation.

Only the **index** (one line per skill) lives in the system prompt. The agent calls `load_skill` to pull a full playbook *when the task actually needs it* — progressive disclosure, so prompts stay lean and output stays expert. You watch it happen: `📚 Loading skill: CTR Title Patterns…`

### 5. The Winning Formula — agents ground on *your* proven data

Creators already know what works for them. Now the agents do too.

The Winning Formula is a library of proven material the creator curates, with three ingest paths: **paste** a list they already keep, pull a **channel's** real videos sorted by views, or run an **outlier search** for videos that beat their own channel's normal performance.

Like skills, the library is a **tool, not a prompt dump**. `get_winning_formula` appears in the activity trail, and — because its output lands in the same `toolOutputs` the grounding validator reads — a citation from the creator's own data counts as *real evidence*. Before this, an agent with no search tools had every citation stripped.

The same lesson applied twice: told only in prose to cite videos, the model presented a pasted *hook* as a video with an invented channel. The validator now rejects it.

---

## Architecture

An agent is **data, not code**:

```ts
{
  instructions: "You are the Title & Hook Doctor…",
  tools:       ['analyze_title_patterns', 'get_video_transcript'], // 6 local tools
  skills:      ['ctr-title-patterns', 'hook-writing'],             // loaded on demand
  connectors:  ['gmail', 'googlesheets'],                          // Composio · 1,047 apps
  deliverable: 'title-doctor',                                     // typed JSON → dedicated UI
}
```

The loop ([`run-custom-agent-flow.ts`](src/ai/flows/run-custom-agent-flow.ts)) resolves tools, skills and connectors, runs a bounded tool-calling loop, then either streams prose (chat mode) or composes a **typed deliverable** that a dedicated interface renders — a score dial, an opportunity board, a YouTube upload simulator, a deal inbox.

```
src/
  services/mesh.ts         ← every AI call goes through here
  services/mesh-image.ts   ← image gen + identity-preserving edits
  services/composio.ts     ← 1,047 connector apps as agent tools
  ai/agents/               ← agent registry + deliverable schemas
  ai/skills/               ← 9 expert playbooks
  ai/tools/agent-tools.ts  ← YouTube + analysis tools
  ai/flows/                ← the agent loop and analysis flows
  components/agents/workspace/  ← the dedicated interfaces
```

## The agents

| Agent | Acts on | Interface |
|---|---|---|
| Thumbnail Studio | — | Studio (3-step) |
| Title & Hook Doctor | — | Score dial + rewrites |
| Trend Scout | — | Opportunity board |
| SEO Optimizer | — | Upload simulator |
| Video Repurposer | — | Native platform previews |
| Content Calendar | — | Month grid |
| Sponsorship Manager | **Gmail · Sheets** | Deal inbox + rate calculator |
| Video Performance · Compare Channels | — | Full-page analysis tools |

Every workspace can **Send to** Gmail, Google Docs, Sheets or Notion — the deliverable lands in the creator's real accounts. Gmail gets a *draft*, never a send.

---

## Setup

```bash
npm install
npm run dev          # http://localhost:9002 → /agents
```

Create `.env.local`:

```bash
MESH_API_KEY_ALL=…   # Mesh key — must be unrestricted (reaches every model below)
COMPOSIO_API_KEY=…   # Composio *Developer Platform* key (ak_…), not the MCP consumer key
YOUTUBE_API_KEY=…    # YouTube Data API v3
```

Three keys, no fallbacks. A Mesh key scoped to a single model will 404 on every
image and vision call, so the app fails loudly rather than degrading silently.

Then open `/agents`, hit **Connect** on Gmail in the Connections panel, and ask the Sponsorship Manager to check your inbox.

## Verify

```bash
npm run typecheck      # types
npm run check:metrics  # pins the Research scoring maths against known regressions
```

---

## Honest limits

- **Persistence is client-side today.** The storage layer sits behind one interface (`agent-store.ts`), so swapping in a real backend is a single-file change.
- **Identity preservation is very good, not a forensic face swap.** A clean headshot still beats channel thumbnails.
- **Some Composio apps need custom OAuth credentials.** The Connections browser only offers **Connect** where Composio manages the auth, and says so where it doesn't.
- **Agents run on request, not on a schedule.** Delivery to Gmail/Slack is on demand; there is no cron yet.
