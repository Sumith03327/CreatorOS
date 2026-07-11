/**
 * @fileOverview The delivery-target registry — the single source of truth for
 * "which real apps can this product write to, and what does writing mean there".
 *
 * This is the abstraction the whole Composio layer hangs off. `CONNECTORS` (the
 * Connections UI) and `SendToMenu` (the Send-to / Distribute actions) both read
 * it, so adding an app is one entry here rather than edits in three files.
 *
 * Two rules encoded in the data, both learned the hard way:
 *
 *  1. `verb` must spell out any lookup the agent cannot infer. Gmail's draft tool
 *     requires a real `recipient_email`, and the agent has no idea what the user's
 *     own address is — so the verb tells it to fetch the profile first. Without
 *     that, every draft silently fails validation.
 *
 *  2. `publishes: true` marks a target whose output is visible to OTHER PEOPLE
 *     (a public post, a team channel, a mailing list). Those are outward-facing
 *     and effectively irreversible, so the UI must confirm before delivering.
 *     Everything else writes privately to the user's own account (a draft, a doc,
 *     a card) and can go one-click.
 *
 * Every slug here has Composio-managed OAuth, verified against the live catalog —
 * so one-click connect actually works. Notably absent: `twitter` and `typefully`,
 * which have NO managed auth and would hand the user a broken connect button.
 */

export type DeliveryKind =
  | 'doc' // long-form writing
  | 'sheet' // tabular / rows
  | 'task' // a card in a production pipeline
  | 'message' // a chat message to a team
  | 'email' // an email or campaign
  | 'social' // a public post
  | 'calendar' // dated items
  | 'crm' // deals and contacts
  | 'file'; // an archived file

export interface DeliveryTarget {
  slug: string;
  name: string;
  logo: string;
  /** What "save this here" means. Prefer drafts over sends. */
  verb: string;
  /** Which deliverables this target makes sense for. */
  kinds: DeliveryKind[];
  /** Output is visible to other people — the UI must confirm before delivering. */
  publishes?: boolean;
}

const logo = (slug: string) => `https://logos.composio.dev/api/${slug}`;

export const DELIVERY_TARGETS: DeliveryTarget[] = [
  // --- Private to the user: safe to deliver one-click -----------------------
  {
    slug: 'gmail',
    name: 'Gmail',
    kinds: ['email', 'doc'],
    logo: logo('gmail'),
    // The draft tool requires a real recipient_email the agent cannot guess.
    verb:
      'First call the Gmail profile tool to get the authenticated user’s own email address. ' +
      'Then create a DRAFT email addressed to that address (do NOT send it). Put the title in the subject and the content in the body.',
  },
  {
    slug: 'googledocs',
    name: 'Google Docs',
    kinds: ['doc'],
    logo: logo('googledocs'),
    verb: 'Create a new Google Doc titled with the given title, containing the content.',
  },
  {
    slug: 'googlesheets',
    name: 'Google Sheets',
    kinds: ['sheet'],
    logo: logo('googlesheets'),
    verb:
      'Create a new spreadsheet titled with the given title, and write the content into it as rows — ' +
      'one row per item, with a sensible header row.',
  },
  {
    slug: 'googledrive',
    name: 'Google Drive',
    kinds: ['file', 'doc'],
    logo: logo('googledrive'),
    verb: 'Create a new text file in the user’s Drive named after the title, containing the content.',
  },
  {
    slug: 'dropbox',
    name: 'Dropbox',
    kinds: ['file'],
    logo: logo('dropbox'),
    verb: 'Upload a new text file to the user’s Dropbox named after the title, containing the content.',
  },
  {
    slug: 'notion',
    name: 'Notion',
    kinds: ['doc', 'task'],
    logo: logo('notion'),
    verb: 'Create a new Notion page titled with the given title, containing the content.',
  },
  {
    slug: 'trello',
    name: 'Trello',
    kinds: ['task'],
    logo: logo('trello'),
    verb:
      'Create a new Trello card titled with the given title; put the content in the card description. ' +
      'If you must choose a list, use the first/leftmost list on the user’s first board.',
  },
  {
    slug: 'airtable',
    name: 'Airtable',
    kinds: ['sheet', 'task', 'crm'],
    logo: logo('airtable'),
    verb:
      'Add a new record to the user’s base — put the title in the primary/name field and the content ' +
      'in a notes/description field.',
  },
  {
    slug: 'googlecalendar',
    name: 'Google Calendar',
    kinds: ['calendar'],
    logo: logo('googlecalendar'),
    verb: 'Create calendar events for any dated items in the content. If no dates are present, say so and do nothing.',
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    kinds: ['crm'],
    logo: logo('hubspot'),
    verb: 'Create a deal (or a note on the relevant contact) named after the title, with the content as its details.',
  },

  // --- Visible to other people: MUST be confirmed before delivering ---------
  {
    slug: 'slack',
    name: 'Slack',
    kinds: ['message'],
    logo: logo('slack'),
    publishes: true,
    verb: 'Post the content as a message to the user’s Slack, formatted readably.',
  },
  {
    slug: 'discord',
    name: 'Discord',
    kinds: ['message'],
    logo: logo('discord'),
    publishes: true,
    verb: 'Post the content as a message to the user’s Discord, formatted readably.',
  },
  {
    slug: 'linkedin',
    name: 'LinkedIn',
    kinds: ['social'],
    logo: logo('linkedin'),
    publishes: true,
    verb: 'Publish the content as a LinkedIn post from the authenticated user. Use the content verbatim.',
  },
  {
    slug: 'reddit',
    name: 'Reddit',
    kinds: ['social'],
    logo: logo('reddit'),
    publishes: true,
    verb:
      'Submit the content as a Reddit post with the given title. If no subreddit is specified in the content, ' +
      'post to the user’s own profile rather than guessing a subreddit.',
  },
  {
    slug: 'mailchimp',
    name: 'Mailchimp',
    kinds: ['email'],
    logo: logo('mailchimp'),
    publishes: true,
    verb:
      'Create a DRAFT campaign with the title as the subject and the content as the body. ' +
      'Do NOT send it to the list — leave it as a draft for the user to review.',
  },
];

const BY_SLUG = new Map(DELIVERY_TARGETS.map((t) => [t.slug, t]));

export function getTarget(slug: string): DeliveryTarget | undefined {
  return BY_SLUG.get(slug);
}

/** Targets that make sense for a given kind of deliverable. */
export function targetsForKinds(kinds: DeliveryKind[]): DeliveryTarget[] {
  if (!kinds.length) return DELIVERY_TARGETS;
  const want = new Set(kinds);
  return DELIVERY_TARGETS.filter((t) => t.kinds.some((k) => want.has(k)));
}
