import type { Conversation, CoreMessage, Provider } from './types.ts';

// Explicit opt-in local import; no outgoing requests. Unknown formats are rejected rather than invented.
function asObj(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
}
function str(input: unknown): string { return typeof input === 'string' ? input : ''; }
function date(input: unknown): string|null {
  if (typeof input === 'number') {
    const d = new Date(input < 1e11 ? input * 1000 : input);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof input !== 'string' || !input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function textFromParts(input: unknown): string {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return input.map(x => typeof x === 'string' ? x : str(asObj(x).text)).filter(Boolean).join('\n');
  const o = asObj(input);
  if (Array.isArray(o.parts)) return textFromParts(o.parts);
  if (Array.isArray(o.content)) return textFromParts(o.content);
  return str(o.text);
}
function providerRole(raw: unknown): CoreMessage['role'] {
  const r = str(raw).toLowerCase();
  return ['user', 'human'].includes(r) ? 'user' : ['assistant', 'ai', 'model', 'chatgpt'].includes(r) ? 'assistant' : 'other';
}
export type ImportResult = { provider: Provider; conversations: Conversation[]; ignored: number; warning?: string };

function chatgptConv(raw: unknown, index: number): Conversation|null {
  const c = asObj(raw);
  if (!c.mapping || typeof c.mapping !== 'object') return null;
  const map = asObj(c.mapping);
  const messages: CoreMessage[] = [];
  const seen = new Set<string>();
  let next = str(c.current_node);
  const ordered: Record<string, unknown>[] = [];
  if (next && map[next]) {
    while (next && map[next] && !seen.has(next)) {
      seen.add(next);
      const record = asObj(map[next]);
      ordered.push(record);
      next = str(record.parent);
    }
    ordered.reverse();
  } else {
    ordered.push(...Object.values(map).map(asObj));
    ordered.sort((a,b)=>Number(asObj(a.message).create_time || 0)-Number(asObj(b.message).create_time || 0));
  }
  for (const entry of ordered) {
    const m = asObj(entry.message);
    if (!m || !m.author) continue;
    const body = textFromParts(m.content);
    if (!body.trim()) continue;
    messages.push({id: str(m.id) || `m${messages.length}`, role: providerRole(asObj(m.author).role), text: body.slice(0,50000), at: date(m.create_time)});
  }
  if (!messages.length) return null;
  return {id: `chatgpt:${str(c.id)||index}`,provider:'chatgpt',title: str(c.title)||'Untitled conversation',createdAt:date(c.create_time),updatedAt:date(c.update_time),messages,tags:[]};
}
function claudeConv(raw: unknown, index: number): Conversation|null {
  const c = asObj(raw);
  if (!Array.isArray(c.chat_messages)) return null;
  const messages: CoreMessage[] = c.chat_messages.map((input: unknown, i: number) => {
    const m = asObj(input);
    return { id: str(m.uuid) || `m${i}`, role: providerRole(m.sender), text: textFromParts(m.content), at: date(m.created_at) };
  }).filter((m: CoreMessage) => m.text.trim());
  if (!messages.length) return null;
  return {id:`claude:${str(c.uuid)||index}`,provider:'claude',title:str(c.name)||'Untitled conversation', createdAt:date(c.created_at), updatedAt:date(c.updated_at), messages, tags:[]};
}
function genericConv(raw: unknown, index: number): Conversation|null {
  const c = asObj(raw);
  if (!Array.isArray(c.messages)) return null;
  const p = str(c.provider).toLowerCase();
  const provider: Provider = p === 'chatgpt' || p === 'claude' || p === 'gemini' ? p : 'generic';
  const messages = c.messages.map((rawMessage: unknown,i: number) => {
    const m = asObj(rawMessage);
    return {id:str(m.id)||`m${i}`,role:providerRole(m.role),text:textFromParts(m.content ?? m.text).slice(0,50000),at:date(m.createdAt ?? m.timestamp)};
  }).filter((m: CoreMessage)=>m.text.trim());
  if (!messages.length) return null;
  return {id:`${provider}:${str(c.id)||index}`,provider,title:str(c.title)||'Untitled conversation',createdAt:date(c.createdAt),updatedAt:date(c.updatedAt),messages,tags:[]};
}
export function parseArchive(raw: unknown): ImportResult {
  const top = asObj(raw);
  const arr = Array.isArray(raw) ? raw : Array.isArray(top.conversations) ? top.conversations : null;
  if (!arr) throw Error('Unsupported export structure. Expected a conversation JSON array or {"conversations": [...]}');
  if (arr.length > 50000) throw Error('Archive exceeds the 50,000 conversation safety limit.');
  const detected = arr.some((x: unknown)=>asObj(x).mapping) ? 'chatgpt' : arr.some((x: unknown)=>Array.isArray(asObj(x).chat_messages)) ? 'claude' : 'generic';
  const parser = detected === 'chatgpt' ? chatgptConv : detected === 'claude' ? claudeConv : genericConv;
  const conversations: Conversation[] = [];
  for (let i = 0; i < arr.length; i++) {
    const result = parser(arr[i],i);
    if (result) conversations.push(result);
  }
  if (!conversations.length) throw Error('No readable conversations found. Gemini Takeout Activity is not yet supported; use normalized JSON.');
  const provider = detected === 'generic' ? conversations[0].provider : detected;
  return {provider,conversations,ignored: arr.length - conversations.length,warning: detected==='generic'?'Generic conversation schema; verify fields before use.':undefined};
}
