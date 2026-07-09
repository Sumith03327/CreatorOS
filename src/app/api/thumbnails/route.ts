/**
 * @fileOverview Thumbnail Studio endpoint.
 *
 * Accepts multipart/form-data so an optional face/logo image streams through.
 * Flow: expand the user's title + style into a vivid image prompt (cheap
 * deepseek call), then either generate thumbnails from text or composite the
 * uploaded reference into the scene. Returns { images: string[] }.
 */

import { callMeshText } from '@/services/mesh';
import { generateThumbnails, editWithReference, type ThumbSize, type ReferenceImage } from '@/services/mesh-image';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STYLE_PRESETS: Record<string, string> = {
  mrbeast:
    'MrBeast-style: hyper-saturated colors, extreme excited/shocked facial expression, very high contrast, bold and loud, exaggerated scale',
  minimal: 'clean minimal composition, generous negative space, elegant modern look, restrained palette',
  cinematic: 'dramatic cinematic lighting, moody atmosphere, teal-and-orange grade, shallow depth of field, film-like',
  tech: 'sleek tech/finance aesthetic, dark background, glowing neon accents, subtle charts/graphs, futuristic and premium',
  vlog: 'warm lifestyle vlog aesthetic, natural soft lighting, friendly and authentic, inviting',
};

const VALID_SIZES: ThumbSize[] = ['1536x1024', '1024x1024', '1024x1536'];

interface PromptInput {
  title: string;
  style: string;
  notes: string;
  hasReference: boolean; // any reference image (uploaded face or channel thumbnails)
  styleProfile?: string; // vision-derived brief of the channel's own thumbnails
  channelTitle?: string;
  identityDescription?: string; // physical description of the creator, for identity lock
  answers?: Record<string, string>; // clarifying-question answers
}

/** Turn inputs (incl. the channel's style profile + Q&A answers) into a strong image prompt. */
async function buildThumbnailPrompt(input: PromptInput): Promise<string> {
  const { title, style, notes, hasReference, styleProfile, channelTitle, identityDescription, answers } = input;
  const styleDesc = STYLE_PRESETS[style] ?? STYLE_PRESETS.mrbeast;
  const subjectLine = hasReference
    ? 'IDENTITY LOCK: Recreate the SAME real person shown in the reference image(s) as the main subject — preserve their exact face, hair, and identity precisely. Do not invent a different-looking person.'
    : 'Include an expressive human subject or a striking central visual as the focal point.';

  const answerLines = answers && Object.keys(answers).length
    ? Object.entries(answers).map(([q, a]) => `- ${q} ${a}`).join('\n')
    : '';

  const system =
    'You are a world-class YouTube thumbnail art director. Write ONE vivid image-generation prompt (2-4 sentences) for an AI image model. ' +
    'It must describe: the scene/composition, the subject, colors/lighting, and a SHORT punchy 2-4 word TEXT OVERLAY (in quotes) to render directly on the image. ' +
    'If a CHANNEL STYLE brief is given, MATCH that channel\'s signature (palette, typography, framing, face usage). ' +
    'If an IDENTITY LOCK line is present, you MUST keep that instruction verbatim in your output so the image model preserves the person. ' +
    'Honor the creative choices. Optimize for curiosity, contrast, and high click-through. Output ONLY the prompt text — no preamble.';

  const user = [
    `Video title: "${title}"`,
    channelTitle ? `Channel: ${channelTitle}` : '',
    styleProfile ? `CHANNEL STYLE brief (match this):\n${styleProfile}` : `Style: ${styleDesc}`,
    subjectLine,
    identityDescription ? `The person is: ${identityDescription}` : '',
    answerLines ? `Creative choices:\n${answerLines}` : '',
    notes ? `Extra notes: ${notes}` : '',
    'Format: 16:9 YouTube thumbnail, bold and eye-catching, high CTR.',
  ].filter(Boolean).join('\n');

  try {
    const expanded = (await callMeshText(user, system)).trim();
    if (expanded) return expanded;
  } catch (e) {
    console.warn('Prompt expansion failed, using template:', e);
  }
  // Fallback template if the LLM call fails.
  return `${styleProfile || styleDesc}. YouTube thumbnail for a video titled "${title}". ${subjectLine} Bold short text overlay derived from the title. 16:9, high contrast, high click-through.`;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const title = String(form.get('title') ?? '').trim();
    const style = String(form.get('style') ?? 'mrbeast');
    const notes = String(form.get('notes') ?? '').trim();
    const sizeRaw = String(form.get('size') ?? '1536x1024') as ThumbSize;
    const size = VALID_SIZES.includes(sizeRaw) ? sizeRaw : '1536x1024';
    const n = Math.min(Math.max(parseInt(String(form.get('n') ?? '2'), 10) || 2, 1), 4);
    const face = form.get('face');
    const hasFace = face instanceof Blob && face.size > 0;
    const styleProfile = String(form.get('styleProfile') ?? '').trim() || undefined;
    const channelTitle = String(form.get('channelTitle') ?? '').trim() || undefined;
    const identityDescription = String(form.get('identityDescription') ?? '').trim() || undefined;
    let answers: Record<string, string> | undefined;
    try {
      const raw = String(form.get('answers') ?? '');
      if (raw) answers = JSON.parse(raw);
    } catch {
      answers = undefined;
    }
    let referenceUrls: string[] = [];
    try {
      const raw = String(form.get('referenceUrls') ?? '');
      if (raw) referenceUrls = (JSON.parse(raw) as string[]).filter(Boolean).slice(0, 3);
    } catch {
      referenceUrls = [];
    }

    if (!title) {
      return Response.json({ error: 'A video title or topic is required.' }, { status: 400 });
    }

    // Build the reference set: uploaded face is the PRIMARY subject; the channel's
    // own thumbnails carry the creator's identity + style. Downloaded server-side.
    const references: ReferenceImage[] = [];
    if (hasFace) references.push({ blob: face as Blob, filename: (face as File).name || 'face.png' });
    const remaining = hasFace ? 2 : 3; // don't over-stuff the reference set
    const fetched = await Promise.all(
      referenceUrls.slice(0, remaining).map(async (url, i) => {
        try {
          const r = await fetch(url);
          if (!r.ok) return null;
          const buf = await r.arrayBuffer();
          return { blob: new Blob([buf], { type: r.headers.get('content-type') || 'image/jpeg' }), filename: `ref-${i}.jpg` } as ReferenceImage;
        } catch {
          return null;
        }
      })
    );
    for (const f of fetched) if (f) references.push(f);

    const hasReference = references.length > 0;
    const prompt = await buildThumbnailPrompt({ title, style, notes, hasReference, styleProfile, channelTitle, identityDescription, answers });

    const images = hasReference
      ? await editWithReference({ prompt, references, size, n })
      : await generateThumbnails({ prompt, size, n });

    if (!images.length) {
      return Response.json({ error: 'The image model returned no images. Try again.' }, { status: 502 });
    }

    return Response.json({ images, prompt });
  } catch (e: any) {
    console.error('Thumbnail generation error:', e);
    return Response.json({ error: e?.message || 'Thumbnail generation failed.' }, { status: 500 });
  }
}
