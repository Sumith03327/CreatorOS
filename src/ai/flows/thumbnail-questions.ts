'use server';
/**
 * @fileOverview Generates 2-4 clarifying questions (each with a few options)
 * to ask a creator before generating their thumbnail — so the result matches
 * their intent. Runs on cheap deepseek JSON mode.
 */

import { callMesh } from '@/services/mesh';

export interface ThumbnailQuestion {
  question: string;
  options: string[];
}

const SYSTEM =
  'You are a YouTube thumbnail art director gathering the few key creative decisions needed before generating a thumbnail. ' +
  'Return STRICT JSON: {"questions":[{"question":string,"options":[string,...]}]}. ' +
  'Produce 2-4 questions max. Each question must have 3-4 short, concrete options. ' +
  'Focus on decisions that most change the image: emotional tone/mood, the main focal subject, ' +
  'a dominant accent color, and whether to feature the creator\'s face. Keep questions short. No prose outside the JSON.';

export async function generateThumbnailQuestions(title: string, styleProfile: string): Promise<ThumbnailQuestion[]> {
  const prompt =
    `Video title: "${title}"\n` +
    `Channel style profile:\n${styleProfile}\n\n` +
    'Generate the clarifying questions as specified.';

  try {
    const raw = await callMesh(prompt, SYSTEM);
    const parsed = JSON.parse(raw);
    const questions: ThumbnailQuestion[] = Array.isArray(parsed?.questions) ? parsed.questions : [];
    return questions
      .filter((q) => q && typeof q.question === 'string' && Array.isArray(q.options))
      .slice(0, 4)
      .map((q) => ({ question: q.question, options: q.options.slice(0, 4).map(String) }));
  } catch (e) {
    console.error('Question generation failed, using defaults:', e);
    return [
      { question: 'What mood should it convey?', options: ['High energy / hype', 'Serious / credible', 'Funny / playful', 'Mysterious / dramatic'] },
      { question: 'What should be the focal subject?', options: ['A person reacting', 'The main object/topic', 'Bold text + graphic', 'A before/after split'] },
      { question: 'Feature your face?', options: ['Yes, prominently', 'Small / corner', 'No face'] },
    ];
  }
}
