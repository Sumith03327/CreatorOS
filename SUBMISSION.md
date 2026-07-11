# CreatorOS — Submission Copy

Paste-ready for **hack.meshapi.ai/submit**.

---

## Project title

```
CreatorOS
```

---

## Track

**Agents & Automation** ✅ *(already selected — keep it)*

> Multi-model is the tempting alternative, but the brief for this track is *"long-running agents that read, decide, and act on real work"* — that is literally what this does. The multi-model story still lands in the pitch and the video.

---

## One-paragraph pitch

```
CreatorOS is a team of ten AI agents for YouTube creators — and unlike every
other creator tool, they don't hand you a chat box. Each agent has a purpose-built
interface (a title scorecard, an opportunity board, a YouTube upload simulator, a
brand-deal inbox), loads expert playbooks on demand, and grounds itself in a
"Winning Formula" of proven data you curate from real outlier videos. Then it acts
on your actual accounts: the Sponsorship Manager reads your real Gmail, triages
brand deals, and flags the contract terms the brand quietly left out. The part I'm
proudest of is what it *refuses* to do — our agents kept fabricating evidence
("a video with 150K views on a 5K-sub channel") and telling them not to didn't
work, so we stopped asking: the server now checks every citation against what the
agent actually saw and strips anything it can't prove. An agent here cannot cite
a video it never found. Every AI call routes through Mesh — one gateway, four
models, each picked for the job it's best at.
```

---

## Registered Mesh email

```
(the email on your Mesh account)
```

---

## GitHub repo URL

```
https://github.com/Sumith03327/CreatorOS
```

✅ Verified public — no extra access needed.

---

## Demo video URL

Upload the recording (unlisted YouTube or Loom) and paste the link.
Script: `DEMO_SCRIPT.md`. **2–3 min, screen recording + you on webcam.**

---

## Pitch deck URL — *optional, skip it*

Leave blank. The video does this job. Don't burn deadline hours on slides.

---

## Live demo URL — *optional, LEAVE BLANK*

⚠️ **Do not deploy this publicly.**

`COMPOSIO_USER_ID` is a hardcoded constant and there is no real auth, so every
visitor to a public deploy would share *your* Composio identity — meaning a
stranger could open Sponsorship Manager and read **your real Gmail inbox**, and
burn your Mesh credits and YouTube quota.

The field is optional and judging is on the video + repo. Leave it blank.

---

## Where is Mesh used in the code?

*Not asterisked, but this is the disqualification rule — fill it carefully.*

```
Every AI call routes through src/services/mesh.ts (text/chat/tools/JSON/vision)
or src/services/mesh-image.ts (image generation + identity-preserving edits).
No provider SDK is imported anywhere in src/, and api.meshapi.ai is the only AI
host contacted.

Entry points in src/services/mesh.ts:
  callMesh          — single-turn JSON
  callMeshText      — single-turn text
  callMeshChat      — multi-turn chat
  callMeshVision    — multimodal; reads a channel's thumbnails (openai/gpt-4o-mini)
  callMeshWithTools — one step of the agent tool-calling loop
  callMeshJson      — typed deliverables that drive the dedicated UIs
  streamMeshChat    — SSE token streaming

The agent loop that consumes these: src/ai/flows/run-custom-agent-flow.ts

MULTI-MODEL — one gateway, the right model per job:
  deepseek-ai/deepseek-v3         reasoning, agent loop, JSON deliverables
  openai/gpt-4o-mini              vision (reading a channel's thumbnails)
  openai/gpt-image-1              text-to-image thumbnails
  google/gemini-2.5-flash-image   identity-preserving edits — this is what puts
                                  the creator's REAL face on a thumbnail from a
                                  channel link alone; gpt-image-1 invented a
                                  stranger every time, so we route identity edits
                                  to Gemini instead. Same gateway, different model.

Verify in ten seconds (from the README):
  grep -nE "^export (async )?function\*? " src/services/mesh.ts
  grep -rhoE "https://api\.meshapi\.ai[a-z/0-9.]*" src/services/*.ts | sort -u
  grep -rlE "api\.openai\.com|generativelanguage|anthropic\.com|api\.deepseek" src/   # prints nothing
```

---

## Pre-submit checklist

- [ ] Video recorded (2–3 min, screen **+ webcam** — both are required)
- [ ] Video uploaded, link is **public/unlisted** (not private — test in incognito)
- [ ] Repo pushed and **public** ✅ already verified
- [ ] Mesh email = the one on your Mesh account
- [ ] Track = **Agents & Automation**
- [ ] Live demo URL = **blank** (see the security note above)
- [ ] Submitted before **12 Jul 2026, 12:00 AM**

## Honest commit history — you're clean

The rules say *"a few giant end-of-week commits = disqualified."* You have
**20 commits across 4 separate days** (7th, 9th, 10th, 11th), each with a real
message describing real work. Nothing to fix, and nothing to fake.
