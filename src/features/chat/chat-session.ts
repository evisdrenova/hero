export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ChatSession {
  id: string;
  messages: ChatMessage[];
  pendingText: string;
  isStreaming: boolean;
}

let nextId = 0;
function genId(): string {
  return `msg-${Date.now()}-${nextId++}`;
}

export function createChatSession(
  sessionId: string,
  userPrompt: string,
): ChatSession {
  return {
    id: sessionId,
    messages: [
      {
        id: genId(),
        role: "user",
        content: userPrompt,
        timestamp: Date.now(),
      },
    ],
    pendingText: "",
    isStreaming: false,
  };
}

export function appendOutput(
  session: ChatSession,
  plainText: string,
): ChatSession {
  return {
    ...session,
    pendingText: session.pendingText + plainText,
    isStreaming: true,
  };
}

export function addUserMessage(
  session: ChatSession,
  prompt: string,
): ChatSession {
  const messages = [...session.messages];

  // Flush any pending assistant text as a message
  if (session.pendingText.trim()) {
    messages.push({
      id: genId(),
      role: "assistant",
      content: session.pendingText.trim(),
      timestamp: Date.now(),
    });
  }

  messages.push({
    id: genId(),
    role: "user",
    content: prompt,
    timestamp: Date.now(),
  });

  return {
    ...session,
    messages,
    pendingText: "",
    isStreaming: false,
  };
}

export function flushPending(session: ChatSession): ChatSession {
  if (!session.pendingText.trim()) {
    return { ...session, isStreaming: false };
  }

  return {
    ...session,
    messages: [
      ...session.messages,
      {
        id: genId(),
        role: "assistant",
        content: session.pendingText.trim(),
        timestamp: Date.now(),
      },
    ],
    pendingText: "",
    isStreaming: false,
  };
}
