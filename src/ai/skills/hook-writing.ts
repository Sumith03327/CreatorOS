import type { Skill } from './types';

export const hookWriting: Skill = {
  name: 'hook-writing',
  title: 'Hook Writing',
  description: 'How to write the first 5–15 seconds of a video so viewers stay.',
  whenToUse: 'Whenever writing, rewriting, or critiquing a video opening, cold open, or first line.',
  content: `# Hook Writing

The hook is the first 5–15 seconds. Its only job is to make leaving feel like a loss.
Most videos die here: if the first 30s retention is under ~70%, nothing later matters.

## The one rule
**Open on the most interesting moment, not the beginning of the story.**
Chronology is the enemy. Start where the tension is.

## Hook patterns that work

1. **Cold open / in medias res** — drop the viewer mid-action, explain later.
   > "This is the third time it's caught fire today."

2. **Stakes declaration** — name what's at risk, immediately.
   > "If this fails, I lose $40,000 and the channel."

3. **Curiosity gap** — pose a question the viewer can't answer but wants to.
   > "Everyone builds this wrong. I did too, for six years."

4. **Contradiction / pattern interrupt** — violate an expectation they hold.
   > "Practising more made me worse at this."

5. **Proof-first** — show the result, then promise the method.
   > "That's the finished shot. Here's the $12 setup that made it."

6. **Direct callout** — name the exact viewer.
   > "If your videos get 200 views and you don't know why, this is why."

## Structure of a strong hook
- **0–3s — Impact.** Visual or claim. No logo, no "hey guys", no throat-clearing.
- **3–8s — Context.** The minimum needed to understand the stakes.
- **8–15s — Promise + escalation.** What they'll get, and a reason it gets better.

Then **re-hook** roughly every 30–60s: a new question, a turn, or a raised stake.

## Rules
- Cut every word before the first interesting one. The best edit is usually deleting your first sentence.
- Concrete beats abstract: "$40,000" > "a lot of money". "Three days" > "a while".
- Never promise what the video doesn't deliver. Retention punishes a broken promise harder than a weak hook.
- Say the title's promise out loud in the first 15s — it confirms the viewer clicked correctly.
- No preamble, no channel intro, no "before we start". Earn the intro; never open with it.

## Diagnosing a weak hook
Ask, in order:
1. Is there tension in the first sentence? If no → rewrite.
2. Could this opening belong to any other video? If yes → it's generic.
3. Does it start at the interesting moment, or at the setup? If setup → cut forward.
4. Is there a reason to watch second 16? If no → add escalation.

## Scoring (0–10)
- 9–10: tension in sentence one, specific stakes, cannot skip.
- 7–8: clear promise, some tension, slightly slow.
- 5–6: understandable but generic; could open any video.
- ≤4: preamble, throat-clearing, or no stakes.

Score below 8 → rewrite rather than tweak.
`,
};
