/**
 * Checks for the Research scoring maths. Run with `npm run check:metrics`.
 *
 * These are the numbers the whole Research feature rests on, and several of the
 * cases below encode bugs that shipped once already: the lifetime-average growth
 * score that ranked dead channels above rising ones, the mean-vs-median lift that
 * made every channel look like it was dying, and the scale-free lift that read a
 * dormant channel's noise as momentum.
 */

import {
  computeOutlierScore,
  computeMomentum,
  buildFormatBreakdown,
  buildUploadHeatmap,
  formatMultiplier,
  outlierTier,
  median,
  computeVph,
  momentumTier,
} from '../src/lib/research-metrics';

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`}`);
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

// --- median ---
check('median odd', median([1, 100, 5]), 5);
check('median even', median([2, 4, 6, 8]), 5);
check('median ignores zeros/negatives', median([0, -5, 10, 20]), 15);
check('median empty', median([]), 0);

// --- outlier score ---
check('outlier 900k over 50k baseline', computeOutlierScore(900_000, 50_000), 18);
check('outlier guards zero baseline', computeOutlierScore(900_000, 0), 0);
check('formatMultiplier big', formatMultiplier(18.4), '18x');
check('formatMultiplier small', formatMultiplier(3.44), '3.4x');
check('formatMultiplier zero', formatMultiplier(0), '—');
check('tier breakout', outlierTier(12).label, 'Breakout');
check('tier outlier', outlierTier(3).label, 'Outlier');
check('tier normal', outlierTier(1.1).label, 'Normal');

// --- vph ---
check('vph ~1000/hr over 48h', Math.round(computeVph(48_000, daysAgo(2)) / 10) * 10, 1000);

// --- momentum ---
// Newest uploads first. `uploads` mirrors what a playlistItems page returns.
const ramp = (newViews: number, oldViews: number) => [
  ...Array.from({ length: 8 }, (_, i) => ({ views: newViews, publishedAt: daysAgo(8 + i * 3) })),
  ...Array.from({ length: 12 }, (_, i) => ({ views: oldViews, publishedAt: daysAgo(40 + i * 5) })),
];

// Channel whose newest uploads badly underperform its own back catalogue.
const cooling = computeMomentum({ uploads: ramp(800, 400_000), channelAgeMonths: 120 });
// Young channel whose newest uploads are 4x its older ones.
const rising = computeMomentum({ uploads: ramp(320_000, 80_000), channelAgeMonths: 9 });
// Flat channel: newest match oldest.
const flat = computeMomentum({ uploads: ramp(50_000, 50_000), channelAgeMonths: 60 });

console.log(`\n  cooling score=${cooling.score} lift=${cooling.lift.toFixed(2)} breakout=${cooling.isBreakout}`);
console.log(`  rising  score=${rising.score} lift=${rising.lift.toFixed(2)} breakout=${rising.isBreakout} uploads/mo=${rising.uploadsPerMonth}`);
console.log(`  flat    score=${flat.score} lift=${flat.lift.toFixed(2)} breakout=${flat.isBreakout}\n`);

check('cooling channel scores low', cooling.score < 20, true);
check('cooling lift below 1', cooling.lift < 1, true);
check('rising channel scores high', rising.score > 60, true);
check('rising lift ~4x', Math.round(rising.lift), 4);
check('flat lift is exactly 1', flat.lift, 1);
check('rising beats cooling', rising.score > cooling.score, true);
check('rising flagged breakout', rising.isBreakout, true);
check('cooling not breakout', cooling.isBreakout, false);
check('old channel never breakout even if hot', computeMomentum({ uploads: ramp(320_000, 80_000), channelAgeMonths: 60 }).isBreakout, false);
check('no uploads -> zero', computeMomentum({ uploads: [], channelAgeMonths: 5 }).score, 0);

// Fresh uploads (<7d) must not drive the score.
const onlyFresh = computeMomentum({
  uploads: Array.from({ length: 6 }, (_, i) => ({ views: 1_000, publishedAt: daysAgo(i) })),
  channelAgeMonths: 3,
});
check('all-fresh channel still returns a sample', onlyFresh.sampleSize > 0, true);
check('all-fresh channel has no lift (no back catalogue)', onlyFresh.lift, 0);

// A channel with too little back catalogue is scored on velocity alone, not dragged to 0.
const noPrior = computeMomentum({
  uploads: Array.from({ length: 4 }, (_, i) => ({ views: 500_000, publishedAt: daysAgo(10 + i * 2) })),
  channelAgeMonths: 6,
});
check('thin back catalogue still scores on velocity', noPrior.score > 40, true);

// The mean-vs-median trap this replaced: one viral video in the back catalogue
// must not make a healthy channel look dead.
const oneViralOldie = computeMomentum({
  uploads: [
    ...Array.from({ length: 8 }, (_, i) => ({ views: 100_000, publishedAt: daysAgo(8 + i * 3) })),
    { views: 40_000_000, publishedAt: daysAgo(300) },
    ...Array.from({ length: 11 }, (_, i) => ({ views: 100_000, publishedAt: daysAgo(40 + i * 5) })),
  ],
  channelAgeMonths: 40,
});
console.log(`  oneViralOldie lift=${oneViralOldie.lift.toFixed(2)} (mean-based would have been ~0.03)\n`);
check('single viral oldie does not crush lift', oneViralOldie.lift, 1);

// Identical 2x lift, wildly different scale. The dormant channel creeping from
// 30 to 60 views must not read as momentum just because the ratio matches a real
// channel going from 100K to 200K.
const dormant = computeMomentum({ uploads: ramp(60, 30), channelAgeMonths: 103 });
const doubling = computeMomentum({ uploads: ramp(200_000, 100_000), channelAgeMonths: 103 });
console.log(`  dormant  score=${dormant.score} lift=${dormant.lift.toFixed(2)}`);
console.log(`  doubling score=${doubling.score} lift=${doubling.lift.toFixed(2)}\n`);
check('identical raw lift on both', [dormant.lift, doubling.lift], [2, 2]);
check('dormant channel stays in the Steady tier', momentumTier(dormant.score).label, 'Steady');
check('doubling channel scores high on the same lift', doubling.score > 70, true);
check('scale separates them by an order of magnitude', doubling.score > dormant.score * 10, true);

// --- format breakdown ---
const formats = buildFormatBreakdown([
  { duration: 'PT45S', outlierScore: 1.2, views: 1000 },
  { duration: 'PT50S', outlierScore: 0.8, views: 900 },
  { duration: 'PT12M30S', outlierScore: 9.0, views: 500_000 },
  { duration: 'PT15M', outlierScore: 7.0, views: 400_000 },
  { duration: 'PT4M', outlierScore: 2.0, views: 20_000 },
  { duration: 'PT35M', outlierScore: 3.5, views: 90_000 },
]);
check('top format is standard 8-20m', formats[0].bucket, 'standard');
check('standard median outlier', formats[0].medianOutlier, 8);
check('shorts ranked last', formats[formats.length - 1].bucket, 'short');
check('empty buckets dropped', formats.length, 4);
check('no videos -> no buckets', buildFormatBreakdown([]).length, 0);

// --- upload heatmap ---
const sat = (hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};
const heat = buildUploadHeatmap([
  { publishedAt: sat(19), outlierScore: 10 },
  { publishedAt: sat(20), outlierScore: 12 },
  { publishedAt: new Date(new Date().setHours(3, 0, 0, 0)).toISOString(), outlierScore: 40 },
]);
check('best slot is Saturday (day 6)', heat.bestSlot?.day, 6);
check('best slot is the 18-21 block', heat.bestSlot?.block, 6);
check('single-video fluke did not win', heat.bestSlot?.count, 2);
check('empty heatmap', buildUploadHeatmap([]).bestSlot, null);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
