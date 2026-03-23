/**
 * Parses Claude Code `--output-format stream-json` JSONL output.
 *
 * Each line is a JSON object with a `type` field. We extract assistant text
 * from streaming deltas or complete assistant messages.
 *
 * With `--verbose`, Claude CLI emits various event types. The assistant text
 * may arrive as:
 *   - `content_block_delta` (streaming chunks — preferred)
 *   - `assistant` (complete message — fallback if no streaming)
 * We track whether streaming deltas arrived to avoid double-counting.
 *
 * Permission prompts arrive as `control_request` events and are surfaced
 * via the `onPermissionRequest` callback.
 */

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface StreamJsonParser {
  /** Feed a raw JSONL line. Returns extracted text. */
  feed(chunk: string): string;
}

export function createStreamJsonParser(
  onPermissionRequest?: (req: PermissionRequest) => void,
): StreamJsonParser {
  let buffer = "";
  /** True once we've seen at least one content_block_delta with text. */
  let sawStreamingDelta = false;

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

          // Permission request — surface to UI, don't extract as text
          if (obj.type === "control_request" && onPermissionRequest) {
            const request = obj.request as Record<string, unknown> | undefined;
            if (request?.subtype === "can_use_tool") {
              onPermissionRequest({
                requestId: obj.request_id as string,
                toolName: request.tool_name as string,
                input: (request.input as Record<string, unknown>) ?? {},
              });
            }
            continue;
          }

          const text = extractText(obj, sawStreamingDelta);
          if (text) {
            extracted += text;
            // If this came from a content_block_delta, mark it
            if (obj.type === "content_block_delta") {
              sawStreamingDelta = true;
            }
          }
        } catch {
          // Not valid JSON — skip
        }
      }

      return extracted;
    },
  };
}

function extractText(
  obj: Record<string, unknown>,
  sawStreamingDelta: boolean,
): string {
  // Content block delta — streaming text chunks (preferred)
  if (obj.type === "content_block_delta") {
    const delta = obj.delta as Record<string, unknown> | undefined;
    if (delta?.type === "text_delta" && typeof delta.text === "string") {
      return delta.text;
    }
  }

  // Assistant message with content array — only if we didn't get streaming deltas
  if (obj.type === "assistant" && !sawStreamingDelta) {
    const message = obj.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (Array.isArray(content)) {
      return content
        .filter(
          (block: Record<string, unknown>) =>
            block.type === "text" && typeof block.text === "string",
        )
        .map((block: Record<string, unknown>) => block.text as string)
        .join("");
    }
  }

  // Result message — only if we didn't get streaming deltas or assistant message
  if (obj.type === "result" && !sawStreamingDelta) {
    const result = obj.result as string | undefined;
    if (typeof result === "string" && result) {
      return result;
    }
  }

  // Error message — always surface
  if (obj.type === "error") {
    const error = obj.error as Record<string, unknown> | undefined;
    if (error && typeof error.message === "string") {
      return `**Error:** ${error.message}\n`;
    }
  }

  return "";
}
