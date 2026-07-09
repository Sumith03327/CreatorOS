import type { Skill } from './types';

export const analyticsInterpretation: Skill = {
  name: 'analytics-interpretation',
  title: 'Analytics Interpretation',
  description: 'Reading channel numbers honestly: which metrics matter, and what each one actually tells you.',
  whenToUse: 'When compiling a performance report, explaining a change in views, or recommending action from data.',
  content: `# Analytics Interpretation

The goal is a **decision**, not a dashboard. Every number you report should imply an action.

## The metrics that matter, in order

1. **Click-through rate (CTR)** — did the packaging earn the click?
   Typical range 2–10%. Compare against *your own* median, never a global benchmark.
2. **Average view duration / percentage viewed** — did the video honour the promise?
3. **Retention curve shape** — *where* they left. Far more useful than the average.
4. **Impressions** — how much YouTube chose to show it. Falling impressions = a satisfaction problem upstream.
5. **Returning vs new viewers** — is the channel compounding or churning?

Subscribers are a **lagging vanity metric**. They follow from the above; they never cause it.

## Reading the pair
CTR and retention must be read **together**:

| CTR | Retention | Diagnosis |
|---|---|---|
| High | High | Winner. Make more of this exact shape. |
| High | Low | Packaging over-promised. The title/thumbnail wrote a cheque the video didn't cash. |
| Low | High | The video is good; nobody clicked. Fix title/thumbnail and consider re-packaging. |
| Low | Low | Wrong topic for this audience. Don't iterate — move on. |

## Reading the retention curve
- **Cliff in first 30s** → the hook. Nothing else matters until this is fixed.
- **Steady gentle decline** → normal and healthy.
- **Sharp mid-video drop** → find the timestamp. Usually a long beat with no open loop.
- **A bump** → people rewatched. That's your best moment; make a Short of it.
- **Drop at a chapter marker** → the chapter promised something the section didn't deliver.

## Honest reporting rules
- **Always compare to the channel's own median**, not to its best video and not to other channels.
- **Never judge before 14 days.** Early numbers are dominated by the subscriber notification wave.
- **n=1 is not a trend.** Two data points aren't either. Look for the third before changing strategy.
- Report **absolute numbers alongside percentages**. "+300%" on 4 views is noise.
- If a change has no clear cause, say so. Inventing a narrative is worse than "we don't know yet".

## Structure of a good report
1. **Headline** — one sentence: what happened and whether it matters.
2. **The numbers** — subs, views, and momentum vs the channel's own median.
3. **Standouts** — the best and worst video, and the *shape* that explains each.
4. **Diagnosis** — the CTR/retention read from the table above.
5. **2–3 recommendations** — each concrete, each tied to a number above.

Never end a report without an action. A report that changes nothing was not worth writing.
`,
};
