/**
 * Parses Claude Code `--output-format stream-json` JSONL output.
 *
 * Each line is a JSON object with a `type` field. We extract assistant text
 * from `assistant` events (content blocks of type "text").
 */

export interface StreamJsonParser {
  /** Feed a raw chunk (may contain partial lines). Returns extracted text. */
  feed(chunk: string): string;
}

export function createStreamJsonParser(): StreamJsonParser {
  let buffer = "";

  return {
    feed(chunk: string): string {
      buffer += chunk;
      let extracted = "";

      // Process complete lines
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);

        if (!line) continue;

        try {
          const obj = JSON.parse(line);
          const text = extractText(obj);
          if (text) extracted += text;
        } catch {
          // Not valid JSON — skip (could be a partial line or non-JSON output)
        }
      }

      return extracted;
    },
  };
}

function extractText(obj: Record<string, unknown>): string {
  // Content block delta — streaming text chunks
  if (obj.type === "content_block_delta") {
    const delta = obj.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
  }

  // Assistant message with content array
  if (obj.type === "assistant") {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (block: Record<string, unknown>) =>
            block.type === "text" && typeof block.text === "string"
        )
        .map((block: Record<string, unknown>) => block.text as string)
        .join("");
    }
  }

  // Result message — final output
  if (obj.type === "result") {
    const result = obj.result as string | undefined;
    if (typeof result === "string" && result) {
      return result;
    }
  }

  // Error message — surface to user
  if (obj.type === "error") {
    const error = obj.error as Record<string, unknown> | undefined;
    if (error && typeof error.message === "string") {
      return `**Error:** ${error.message}\n`;
    }
  }

  return "";
}
