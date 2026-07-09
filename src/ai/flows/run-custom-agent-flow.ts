/**
 * @fileOverview Runs a user-built custom agent (Build Your Own Agent) through the
 * Mesh API as a bounded TOOL-CALLING LOOP: the model can call real tools
 * (fetch a channel, read a transcript, search YouTube) before answering, instead
 * of guessing from memory. The final answer is streamed token-by-token.
 *
 * NOTE: this is a plain server-only module (not a 'use server' action file) —
 * it exports an async generator + types, which server actions disallow. It's
 * consumed by the /api/agents/chat route handler, which runs on the server.
 */

import {
  callMeshWithTools,
  callMeshJson,
  streamMeshChat,
  type MeshLoopMessage,
  type MeshAssistantMessage,
} from '@/services/mesh';
import { getDeliverable, type DeliverableSpec } from '@/ai/agents/deliverables';
import { getToolSchemas, executeTool } from '@/ai/tools/agent-tools';
import { getComposioTools, executeComposioTool, listConnections } from '@/services/composio';
import { resolveSkills, buildSkillIndex, getSkill } from '@/ai/skills';
import type { MeshToolSchema } from '@/services/mesh';
import { fetchYouTubeChannelData, fetchVideoDetails } from '@/services/youtube';
import { extractVideoId } from '@/ai/tools/agent-tools';

export interface RunCustomAgentInput {
  instructions: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  userMessage: string;
  /** Optional model override (defaults to deepseek-v3 in the Mesh service). */
  model?: string;
  /** Per-agent toolset (tool names). Empty/undefined = all tools. */
  tools?: string[];
  /** Composio connector toolkits this agent may act through (e.g. ['gmail','googlesheets']). */
  connectors?: string[];
  /** Expert skill playbooks this agent may load on demand (see src/ai/skills). */
  skills?: string[];
  /**
   * Workspace mode: instead of streaming prose, compose a typed JSON result
   * matching this deliverable schema (see src/ai/agents/deliverables.ts).
   */
  deliverable?: string;
  /** Durable, distilled facts about the user, carried across separate chats.
   *  Folded into the system prompt so the agent "remembers" the user. */
  memory?: string;
  /** Legacy: prepend a one-off YouTube snapshot to the user message. */
  youtubeUrl?: string;
}

/** Events emitted while an agent runs, for the streaming UI. */
export type AgentEvent =
  | { type: 'status'; content: string } // e.g. "Reading channel…"
  | { type: 'text'; content: string } // a chunk of the final answer
  | { type: 'deliverable'; content: string } // a typed JSON result for a dedicated UI
  | { type: 'ping' } // keep-alive during a long compose; clients ignore it
  | { type: 'error'; content: string };

// Raised from 5: loading a skill consumes a step, and agents should still have
// room to research with their tools afterwards.
const MAX_STEPS = 8;

// Friendly labels for the "🔧 …" status chips shown while tools run.
const TOOL_STATUS: Record<string, string> = {
  get_youtube_channel: 'Reading channel data…',
  get_video_transcript: 'Reading the video transcript…',
  search_youtube_videos: 'Searching YouTube…',
  analyze_video_script: 'Analyzing the script…',
  get_trending_summary: 'Scanning current trends…',
  analyze_title_patterns: 'Studying winning titles…',
};

/**
 * Models occasionally wrap JSON in prose or code fences even in json mode.
 * Pull out the outermost object and verify it parses; return null if it doesn't.
 */
function extractJson(raw: string): string | null {
  const cleaned = raw.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  const candidate = cleaned.slice(start, end + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Compose the typed deliverable. Models occasionally return prose or a cut-off
 * object; retry once with a blunt correction before giving up.
 */
async function composeDeliverable(
  messages: MeshLoopMessage[],
  instruction: string,
  model?: string
): Promise<string | null> {
  messages.push({ role: 'user', content: instruction });
  const first = extractJson(await callMeshJson(messages, model));
  if (first) return first;

  messages.push({
    role: 'user',
    content:
      'Your last reply was not valid JSON. Reply with ONLY the JSON object — no prose, no code fences, no commentary. Keep it compact.',
  });
  return extractJson(await callMeshJson(messages, model));
}

/**
 * Ground the deliverable against what the agent actually saw, then re-serialize.
 * If validation throws, fall back to the raw JSON rather than losing the run.
 */
function groundDeliverable(spec: DeliverableSpec, json: string, toolOutputs: string[]): string {
  if (!spec.validate) return json;
  try {
    return JSON.stringify(spec.validate(JSON.parse(json), toolOutputs));
  } catch (e) {
    console.error('deliverable validation failed (using raw):', e);
    return json;
  }
}

/**
 * Compose the deliverable while emitting a keep-alive every few seconds. A JSON
 * compose (plus a possible retry) can run for a minute with zero bytes on the
 * wire, which clients and proxies treat as a dead stream.
 */
async function* composeWithHeartbeat(
  messages: MeshLoopMessage[],
  instruction: string,
  model?: string
): AsyncGenerator<AgentEvent, string | null, unknown> {
  const work = composeDeliverable(messages, instruction, model);
  const TICK: unique symbol = Symbol('tick') as any;

  while (true) {
    let timer: ReturnType<typeof setTimeout>;
    const tick = new Promise<typeof TICK>((resolve) => {
      timer = setTimeout(() => resolve(TICK), 8000);
    });
    const winner = await Promise.race([work, tick]);
    clearTimeout(timer!);
    if (winner === TICK) {
      yield { type: 'ping' };
      continue;
    }
    return winner as string | null;
  }
}

/** Turn a Composio tool name (e.g. GMAIL_SEND_EMAIL) into a friendly app label. */
function prettyConnector(toolName: string): string {
  const app = toolName.split('_')[0] || 'app';
  const map: Record<string, string> = {
    GMAIL: 'Gmail',
    GOOGLESHEETS: 'Google Sheets',
    GOOGLEDOCS: 'Google Docs',
    GOOGLECALENDAR: 'Google Calendar',
    NOTION: 'Notion',
    SLACK: 'Slack',
  };
  return map[app] ?? app.charAt(0) + app.slice(1).toLowerCase();
}

/** Legacy helper: prepend a one-off YouTube snapshot (kept for backward compat). */
async function buildYouTubeContext(url: string): Promise<string | null> {
  try {
    const videoId = extractVideoId(url);
    if (videoId) {
      const video = await fetchVideoDetails(videoId);
      if (!video) return null;
      return `Video Title: ${video.title}\nChannel: ${video.channelTitle || 'Unknown'}\nViews: ${video.viewCount || 'N/A'}\nPublished: ${video.publishedAt}`;
    }
    const channel = await fetchYouTubeChannelData(url);
    if (!channel) return null;
    return `Channel: ${channel.title}\nDescription: ${channel.description}\nSubscribers: ${channel.statistics.subscriberCount}\nTotal Views: ${channel.statistics.viewCount}\nVideos: ${channel.statistics.videoCount}`;
  } catch (e) {
    console.error('YouTube context lookup failed:', e);
    return null;
  }
}

function buildSystemPrompt(input: RunCustomAgentInput): string {
  let prompt = input.instructions;

  const memory = input.memory?.trim();
  if (memory) {
    // The agent's own instructions come first; remembered facts are appended as a
    // clearly-fenced block so the model treats them as known context, not orders.
    prompt +=
      `\n\n--- WHAT YOU REMEMBER ABOUT THIS USER (from previous conversations) ---\n` +
      `${memory}\n` +
      `Use this context naturally when relevant; don't recite it back or mention that you "remember" unless asked.`;
  }

  // Progressive disclosure: index only. Full playbooks arrive via `load_skill`.
  prompt += buildSkillIndex(resolveSkills(input.skills));

  return prompt;
}

/** The `load_skill` tool, scoped to the skills THIS agent is allowed to read. */
function buildLoadSkillSchema(skillNames: string[]): MeshToolSchema {
  return {
    type: 'function',
    function: {
      name: 'load_skill',
      description:
        'Load the full expert playbook for one of your skills. Call this before doing substantive work the skill covers, then follow the playbook closely.',
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            enum: skillNames,
            description: 'The skill name to load, exactly as listed in YOUR SKILLS.',
          },
        },
        required: ['skill'],
      },
    },
  };
}

function buildInitialMessages(input: RunCustomAgentInput, userContent: string): MeshLoopMessage[] {
  return [
    { role: 'system', content: buildSystemPrompt(input) },
    ...input.history.map((h) => ({ role: h.role, content: h.content }) as MeshLoopMessage),
    { role: 'user', content: userContent },
  ];
}

/**
 * Streaming agent runner. Resolves any tool calls (non-streaming, emitting status
 * events), then streams the final answer token-by-token as `text` events.
 */
export async function* runCustomAgentStream(input: RunCustomAgentInput): AsyncGenerator<AgentEvent> {
  let userContent = input.userMessage;
  if (input.youtubeUrl?.trim()) {
    const context = await buildYouTubeContext(input.youtubeUrl.trim());
    if (context) userContent = `[YouTube Context]\n${context}\n\n[User Message]\n${input.userMessage}`;
  }

  const messages = buildInitialMessages(input, userContent);

  // Assemble this agent's toolset: local tools + any Composio connector tools.
  // Only load tools for CONNECTED apps; for unconnected ones, tell the model so
  // it asks the user to connect instead of futilely calling a dead tool.
  const localSchemas = getToolSchemas(input.tools);
  let composioSchemas: typeof localSchemas = [];
  if (input.connectors?.length) {
    try {
      const active = new Set(
        (await listConnections()).filter((c) => c.status === 'ACTIVE').map((c) => c.slug)
      );
      const connected = input.connectors.filter((s) => active.has(s));
      const notConnected = input.connectors.filter((s) => !active.has(s));
      if (connected.length) composioSchemas = await getComposioTools(connected);
      const sys = messages[0];
      if (notConnected.length && sys.role === 'system') {
        sys.content +=
          `\n\n[Connections] Not connected yet: ${notConnected.join(', ')}. ` +
          `If a task needs one of these, tell the user to connect it in the Connections panel — do not try to use it.`;
      }
    } catch (e) {
      console.error('Composio tools unavailable:', e);
    }
  }
  // Workspace mode: a typed deliverable replaces the streamed prose answer.
  const spec = getDeliverable(input.deliverable);

  // Skills: expose `load_skill` only when this agent actually has skills.
  const agentSkills = resolveSkills(input.skills);
  /** Guards against a model re-loading the same playbook every step. */
  const loadedSkills = new Set<string>();
  const composioNames = new Set(composioSchemas.map((s) => s.function.name));
  /** Everything the agent's tools returned — the ground truth for validation. */
  const toolOutputs: string[] = [];

  /**
   * Rebuilt each step: `load_skill` only offers the skills not yet loaded, and
   * disappears entirely once they all are. Without this, models happily call it
   * every iteration until the step cap, which is slow and bloats the context.
   */
  const currentToolSchemas = () => {
    const remaining = agentSkills.filter((s) => !loadedSkills.has(s.name)).map((s) => s.name);
    const skillSchemas = remaining.length ? [buildLoadSkillSchema(remaining)] : [];
    return [...localSchemas, ...composioSchemas, ...skillSchemas];
  };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // Detection call: does the model want to use a tool, or answer now?
      const resp: MeshAssistantMessage = await callMeshWithTools(messages, currentToolSchemas(), {
        model: input.model,
      });

      if (resp.tool_calls?.length) {
        // Record the assistant's tool-call turn, then run each tool.
        messages.push({ role: 'assistant', content: resp.content ?? '', tool_calls: resp.tool_calls });
        for (const call of resp.tool_calls) {
          const name = call.function.name;
          const isComposio = composioNames.has(name);

          // Parse args first so the status chip can name the skill being loaded.
          let args: Record<string, any> = {};
          try {
            args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
          } catch {
            args = {};
          }

          let result: string;
          if (name === 'load_skill') {
            const requested = String(args.skill ?? '');
            const skill = agentSkills.find((s) => s.name === requested) ? getSkill(requested) : null;
            if (!skill) {
              result = `tool failed: "${requested}" is not one of your skills. Available: ${agentSkills.map((s) => s.name).join(', ')}.`;
            } else if (loadedSkills.has(requested)) {
              // Re-sending a playbook balloons the context and can truncate the
              // final answer. Acknowledge instead, and push the model to answer.
              result = `"${skill.title}" is already loaded and above in this conversation. Do not load it again — use it and produce your answer now.`;
            } else {
              loadedSkills.add(requested);
              yield { type: 'status', content: `Loading skill: ${skill.title}…` };
              result = skill.content;
            }
          } else {
            yield {
              type: 'status',
              content: TOOL_STATUS[name] ?? (isComposio ? `Acting via ${prettyConnector(name)}…` : `Running ${name}…`),
            };
            result = isComposio ? await executeComposioTool(name, args) : await executeTool(name, args);
            // Skill playbooks aren't evidence, so only real tool results count.
            toolOutputs.push(result);
          }

          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
        continue; // loop again with tool results in context
      }

      // No tool calls → the model is ready to answer.

      // Workspace mode: compose a typed deliverable instead of prose.
      if (spec) {
        yield { type: 'status', content: spec.composingLabel };
        const json = yield* composeWithHeartbeat(messages, spec.instruction, input.model);
        if (json) {
          yield { type: 'deliverable', content: groundDeliverable(spec, json, toolOutputs) };
          return;
        }
        yield { type: 'error', content: 'The agent could not produce a structured result. Try again.' };
        return;
      }

      // Chat mode: stream the answer fresh (without tools, since we know none
      // are needed) for real token streaming.
      let streamed = '';
      for await (const delta of streamMeshChat(messages, { model: input.model })) {
        streamed += delta;
        yield { type: 'text', content: delta };
      }
      // Fallback: if the stream produced nothing, emit the detection content.
      if (!streamed && resp.content) yield { type: 'text', content: resp.content };
      return;
    }

    // Hit the step cap with tools still pending — force a final answer, no tools.
    if (spec) {
      yield { type: 'status', content: spec.composingLabel };
      const json = yield* composeWithHeartbeat(messages, spec.instruction, input.model);
      if (json) yield { type: 'deliverable', content: groundDeliverable(spec, json, toolOutputs) };
      else yield { type: 'error', content: 'The agent could not produce a structured result. Try again.' };
      return;
    }
    for await (const delta of streamMeshChat(messages, { model: input.model })) {
      yield { type: 'text', content: delta };
    }
  } catch (e: any) {
    console.error('Agent run failed:', e);
    yield { type: 'error', content: e?.message || 'The agent failed to respond.' };
  }
}

/**
 * Non-streaming convenience wrapper (used by headless tests / callers that just
 * want the final string). Drains the stream and returns the concatenated answer.
 */
export async function runCustomAgent(input: RunCustomAgentInput): Promise<string> {
  let out = '';
  for await (const ev of runCustomAgentStream(input)) {
    // In workspace mode the result arrives as one JSON blob rather than deltas.
    if (ev.type === 'text' || ev.type === 'deliverable') out += ev.content;
    if (ev.type === 'error') throw new Error(ev.content);
  }
  return out;
}
