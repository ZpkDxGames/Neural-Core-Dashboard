export const PROVIDERS = ['chatgpt', 'claude', 'gemini', 'generic'] as const;
export type Provider = typeof PROVIDERS[number];
export type CoreMessage = { id: string; role: 'user'|'assistant'|'other'; text: string; at: string|null };
export type Conversation = {
  id: string;
  provider: Provider;
  title: string;
  createdAt: string|null;
  updatedAt: string|null;
  messages: CoreMessage[];
  tags: string[];
};
export type GraphEvidence = { conversationId: string; title: string; provider: Provider; messageId: string|null; excerpt: string };
export type GraphNode = {
  id: string;
  label: string;
  type: 'core'|'category'|'provider'|'conversation'|'concept';
  category: string;
  provider?: Provider;
  description?: string;
  strength: number;
  evidence?: GraphEvidence[];
};
export type GraphEdge = {source: string; target: string; type: string};
export type KnowledgeGraph = {nodes: GraphNode[]; edges: GraphEdge[]};
export const CATEGORIES = [
  'Development', 'AI & Automation', 'UI / UX', 'Learning', 'Gaming', 'Infrastructure', 'Planning', 'General'
] as const;
