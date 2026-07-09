import type { Skill } from './types';

export const retentionStructure: Skill = {
  name: 'retention-structure',
  title: 'Retention Structure',
  description: 'How to structure a video so viewers keep watching: beats, re-hooks, and drop-off repair.',
  whenToUse: 'When outlining or writing a full script, or diagnosing why viewers drop off.',
  content: `# Retention Structure

Retention is not a property of the topic. It's a property of the **structure**.
Every moment must either raise a question or pay one off. Anything else is a drop-off.

## The spine

1. **HOOK (0–15s)** — tension first. See the hook-writing skill.
2. **SETUP (15–45s)** — the minimum context. State the promise plainly.
3. **VALUE BEATS (the body)** — a sequence of self-contained beats.
4. **PAYOFF** — deliver the promise explicitly. Say it: "So here's the answer."
5. **CTA (last 10–20s)** — one ask, tied to what they just got.

## Beats
A **beat** is one complete idea: *tension → development → resolution*.
Each beat should be 45–120s. If a beat runs longer, split it.

End each beat by **opening the next question** before resolving the current one.
This is the "open loop": never let the viewer reach a natural stopping point.

> Bad: "…and that's how lighting works. Next, let's talk about audio."
> Good: "…and that fixed the lighting. But it made the audio problem impossible to ignore."

## Re-hooks
Every **30–60 seconds**, give a reason to stay:
- A new question ("But there was a catch.")
- A raised stake ("This is where I lost the footage.")
- A pattern break (B-roll, cut, location, tone shift)
- A preview ("The last one is the reason the channel grew.")

## Where viewers actually leave
| Drop-off point | Usual cause | Fix |
|---|---|---|
| 0–15s | No tension; preamble; slow open | Cut to the interesting moment |
| 30–60s | Promise unclear or already fulfilled | Restate promise; escalate |
| Mid-video plateau | A beat ran long / no open loop | Split the beat; add a re-hook |
| Before the payoff | Viewer got the answer early | Withhold the key detail until payoff |
| Outro | Long goodbye | One CTA, then end. Hard cut. |

## Pacing rules
- **No sentence without a job.** Cut anything that doesn't build tension, deliver value, or transition.
- Vary sentence length. Short punches after long explanations.
- Speak in spoken English, not written English. Contractions. Fragments. Rhythm.
- The moment you notice you're explaining background, ask: can this be revealed later, inside a beat?

## Diagnosing a script
Walk the script and mark each 30s block with:
- **Q** — opens a question
- **A** — answers one
- **—** — neither

Any two consecutive **—** blocks is a predicted drop-off. Fix by adding a re-hook or cutting.

## Length
Length should be decided by beats, not by a target minute count.
A tight 6-minute video beats a padded 12-minute one. Padding is the fastest way to kill a channel.
`,
};
