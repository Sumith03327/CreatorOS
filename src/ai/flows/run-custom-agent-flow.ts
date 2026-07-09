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
  streamMeshChat,
  type MeshLoopMessage,
  type MeshAssistantMessage,
} from '@/services/mesh';
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
  // Skills: expose `load_skill` only when this agent actually has skills.
  const agentSkills = resolveSkills(input.skills);
  const skillSchemas = agentSkills.length ? [buildLoadSkillSchema(agentSkills.map((s) => s.name))] : [];

  const toolSchemas = [...localSchemas, ...composioSchemas, ...skillSchemas];
  const composioNames = new Set(composioSchemas.map((s) => s.function.name));

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // Detection call: does the model want to use a tool, or answer now?
      const resp: MeshAssistantMessage = await callMeshWithTools(messages, toolSchemas, {
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
            yield { type: 'status', content: `Loading skill: ${skill?.title ?? requested}…` };
            result = skill
              ? skill.content
              : `tool failed: "${requested}" is not one of your skills. Available: ${agentSkills.map((s) => s.name).join(', ')}.`;
          } else {
            yield {
              type: 'status',
              content: TOOL_STATUS[name] ?? (isComposio ? `Acting via ${prettyConnector(name)}…` : `Running ${name}…`),
            };
            result = isComposio ? await executeComposioTool(name, args) : await executeTool(name, args);
          }

          messages.push({ role: 'tool', tool_call_id: call.id, content: result });
        }
        continue; // loop again with tool results in context
      }

      // No tool calls → the model is ready to answer. Stream that answer fresh
      // (without tools, since we know none are needed) for real token streaming.
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
    if (ev.type === 'text') out += ev.content;
    if (ev.type === 'error') throw new Error(ev.content);
  }
  return out;
}
