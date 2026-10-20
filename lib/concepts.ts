import type { Conversation, GraphEvidence } from './types.ts';

/**
 * Explicit, deterministic concept mentions. This is not personality inference, semantic
 * understanding, or an LLM output. Every node must have source evidence.
 */
export const CONCEPT_CATALOG = [
  { id: 'nextjs', label: 'Next.js', category: 'Development', aliases: ['next.js', 'nextjs'] },
  { id: 'react', label: 'React', category: 'Development', aliases: ['react', 'reactjs'] },
  { id: 'typescript', label: 'TypeScript', category: 'Development', aliases: ['typescript'] },
  { id: 'javascript', label: 'JavaScript', category: 'Development', aliases: ['javascript'] },
  { id: 'python', label: 'Python', category: 'Development', aliases: ['python'] },
  { id: 'java', label: 'Java', category: 'Development', aliases: ['java'] },
  { id: 'github', label: 'GitHub', category: 'Development', aliases: ['github'] },
  { id: 'postgresql', label: 'PostgreSQL', category: 'Infrastructure', aliases: ['postgresql', 'postgres', 'pgvector'] },
  { id: 'vercel', label: 'Vercel', category: 'Infrastructure', aliases: ['vercel'] },
  { id: 'docker', label: 'Docker', category: 'Infrastructure', aliases: ['docker'] },
  { id: 'ubuntu', label: 'Ubuntu', category: 'Infrastructure', aliases: ['ubuntu'] },
  { id: 'cloudflare', label: 'Cloudflare', category: 'Infrastructure', aliases: ['cloudflare'] },
  { id: 'backups', label: 'Backups', category: 'Infrastructure', aliases: ['backup', 'backups'] },
  { id: 'api', label: 'APIs', category: 'Development', aliases: ['api', 'apis'] },
  { id: 'chrome-extensions', label: 'Browser extensions', category: 'AI & Automation', aliases: ['browser extension', 'chrome extension', 'manifest v3'] },
  { id: 'embeddings', label: 'Embeddings', category: 'AI & Automation', aliases: ['embedding', 'embeddings'] },
  { id: 'neural-network', label: 'Neural networks', category: 'AI & Automation', aliases: ['neural network', 'neural networks'] },
  { id: 'chatgpt', label: 'ChatGPT', category: 'AI & Automation', aliases: ['chatgpt'] },
  { id: 'claude', label: 'Claude', category: 'AI & Automation', aliases: ['claude'] },
  { id: 'gemini', label: 'Gemini', category: 'AI & Automation', aliases: ['gemini'] },
  { id: 'minecraft', label: 'Minecraft', category: 'Gaming', aliases: ['minecraft'] },
  { id: 'paper', label: 'Paper server', category: 'Gaming', aliases: ['paper server', 'papermc'] },
  { id: 'vulkan', label: 'Vulkan', category: 'Gaming', aliases: ['vulkan'] },
  { id: '3d-rendering', label: '3D rendering', category: 'UI / UX', aliases: ['3d rendering', 'three.js', 'webgl'] },
  { id: 'accessibility', label: 'Accessibility', category: 'UI / UX', aliases: ['accessibility', 'screen reader'] },
  { id: 'responsive-design', label: 'Responsive design', category: 'UI / UX', aliases: ['responsive design', 'mobile-first'] },
  { id: 'performance', label: 'Performance profiling', category: 'Development', aliases: ['performance profiling', 'benchmark', 'profiling'] },
  { id: 'security', label: 'Security', category: 'Infrastructure', aliases: ['authentication', 'encryption', 'security'] },
  { id: 'university', label: 'University', category: 'Learning', aliases: ['university', 'college'] },
  { id: 'roadmap', label: 'Roadmap', category: 'Planning', aliases: ['roadmap', 'milestone'] }
] as const;

export type ConceptMention = {
  id: string;
  label: string;
  category: string;
  evidence: GraphEvidence;
};

// The separators matter: "AI" must not match "email"; "Java" must not match "JavaScript".
function findAlias(text: string, aliases: readonly string[]): { start: number; end: number } | null {
  const lower = text.toLowerCase();
  for (const alias of aliases) {
    let cursor = 0;
    while (cursor < lower.length) {
      const pos = lower.indexOf(alias, cursor);
      if (pos < 0) break;
      const end = pos + alias.length;
      const before = pos === 0 || !/[a-z0-9]/.test(lower[pos - 1]!);
      const after = end === lower.length || !/[a-z0-9]/.test(lower[end]!);
      if (before && after) return { start: pos, end };
      cursor = pos + 1;
    }
  }
  return null;
}

function excerpt(text: string, start: number, end: number): string {
  const from = Math.max(0, start - 72);
  const to = Math.min(text.length, end + 104);
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ').trim() + (to < text.length ? '…' : '');
}

export function extractConceptMentions(c: Conversation): ConceptMention[] {
  const results: ConceptMention[] = [];
  // Bound CPU per conversation. Classification is intentionally not an exhaustive transcript search.
  const sample = c.messages.slice(0, 24);
  for (const concept of CONCEPT_CATALOG) {
    let evidence: GraphEvidence | undefined;
    const titleMatch = findAlias(c.title, concept.aliases);
    if (titleMatch) {
      evidence = { conversationId: c.id, title: c.title, provider: c.provider, messageId: null, excerpt: excerpt(c.title, titleMatch.start, titleMatch.end) };
    } else {
      for (const m of sample) {
        const messageText = m.text.slice(0, 4000);
        const found = findAlias(messageText, concept.aliases);
        if (!found) continue;
        evidence = { conversationId: c.id, title: c.title, provider: c.provider, messageId: m.id, excerpt: excerpt(messageText, found.start, found.end) };
        break;
      }
    }
    if (evidence) results.push({ id: concept.id, label: concept.label, category: concept.category, evidence });
  }
  return results;
}
