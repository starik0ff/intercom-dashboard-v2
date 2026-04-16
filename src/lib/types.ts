export interface Message {
  author: string;
  body: string;
  date: string;
}

export interface Conversation {
  conversation_id: string;
  created_at: string;
  updated_at: string;
  messages: Message[];
  admin_assignee_id: number | null;
}

export interface SearchResult {
  conversation_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  authors: string[];
  matches: MessageMatch[];
}

export interface MessageMatch {
  author: string;
  body: string;
  date: string;
  index: number;
}

export interface AuthorIndex {
  [author: string]: string[];
}

export interface StatsData {
  totalConversations: number;
  totalAuthors: number;
  dateRange: { min: string; max: string };
}
