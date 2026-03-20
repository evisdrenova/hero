// Matches all common ANSI escape sequences:
// - CSI sequences: ESC [ ... (cursor, SGR, erase, scroll, etc.)
// - OSC sequences: ESC ] ... ST (title, hyperlinks, etc.)
// - Single-character escapes: ESC followed by one char (e.g., ESC(B, ESC=, ESC>)
// - C1 control codes
const ANSI_RE =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b](?:\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~!]?|.)/g;

// Box-drawing and block characters that TUI apps use for layout
const BOX_DRAWING_RE = /[\u2500-\u257F\u2580-\u259F\u2800-\u28FF]/g;

export function stripAnsi(text: string): string {
  return text
    .replace(ANSI_RE, "")
    .replace(BOX_DRAWING_RE, "");
}
