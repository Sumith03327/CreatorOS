/**
 * Compiles a thumbnail project's style rules into the prompt block that reaches
 * the art-director model.
 *
 * Lives here rather than in the route handler so it can be tested directly —
 * Next.js route modules may only export HTTP handlers and route config.
 */

/** A project style, as posted by the Studio. Mirrors ThumbnailStyle in agent-store. */
export interface StyleBrief {
  label: string;
  rule: string;
  checklist?: string[];
  generationPrompt?: string;
  niche?: string;
}

/**
 * Order is priority: the first rule leads and wins conflicts.
 *
 * We pass the *rules*, not the styles' source thumbnails. The reference slots
 * are reserved for the creator's identity; filling them with style samples is
 * what let the model drift off the creator's own face.
 *
 * Each rule is restated as an imperative and its checklist inlined, because a
 * bare description ("bold thumbnails") gets paraphrased away during expansion
 * while a constraint ("three words maximum") survives.
 */
export function compileStyleBrief(styles: StyleBrief[]): string {
  if (!styles.length) return '';

  const lines = styles.map((s, i) => {
    const parts = [`${i + 1}. [${s.label}${s.niche ? ` · ${s.niche}` : ''}] ${s.rule}`];
    if (s.checklist?.length) {
      parts.push(`   Non-negotiable: ${s.checklist.join('; ')}`);
    }
    return parts.join('\n');
  });

  return [
    `PROJECT STYLE RULES — ${styles.length} rule${styles.length === 1 ? '' : 's'}, highest authority.`,
    'Every rule must be visibly satisfied in the image you describe.',
    'On conflict, the lower-numbered rule wins.',
    '',
    ...lines,
  ].join('\n');
}
