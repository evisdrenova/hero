import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

/** Tokenize JSON string into colored spans using React elements */
export function JsonHighlight({ json }: { json: string }) {
  const tokens: React.ReactNode[] = [];
  const regex = /("(?:\\.|[^"\\])*")|(true|false|null)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|([{}[\]:,])|(\s+)/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let keyIndex = 0;

  const jsonStr = json;
  while ((match = regex.exec(jsonStr)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(jsonStr.slice(lastIndex, match.index));
    }
    const [, str, bool, num, punct, ws] = match;
    if (str) {
      const after = jsonStr.slice(regex.lastIndex).match(/^\s*:/);
      if (after) {
        tokens.push(<span key={keyIndex++} className="text-blue">{str}</span>);
      } else {
        tokens.push(<span key={keyIndex++} className="text-green">{str}</span>);
      }
    } else if (bool) {
      tokens.push(<span key={keyIndex++} className="text-yellow">{bool}</span>);
    } else if (num) {
      tokens.push(<span key={keyIndex++} className="text-accent-fg">{num}</span>);
    } else if (punct) {
      tokens.push(<span key={keyIndex++} className="text-fg-subtle">{punct}</span>);
    } else if (ws) {
      tokens.push(ws);
    }
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < jsonStr.length) {
    tokens.push(jsonStr.slice(lastIndex));
  }

  return <>{tokens}</>;
}

export function JsonViewer({ text }: { text: string }) {
  const formatted = useMemo(() => {
    try {
      return JSON.stringify(JSON.parse(text.trim()), null, 2);
    } catch {
      return text;
    }
  }, [text]);

  const lines = formatted.split("\n");
  const [collapsed, setCollapsed] = useState(lines.length > 12);
  const preview = lines.slice(0, 6).join("\n");

  return (
    <div className="relative">
      <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
        {collapsed ? (
          <>
            <JsonHighlight json={preview} />
            {lines.length > 6 && (
              <span className="text-fg-faint">{"\n  ..."}</span>
            )}
          </>
        ) : (
          <JsonHighlight json={formatted} />
        )}
      </pre>
      {lines.length > 12 && (
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="mt-1 flex items-center gap-1 text-[10px] text-accent-fg hover:text-accent"
        >
          {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          {collapsed ? `Show all (${lines.length} lines)` : "Collapse"}
        </button>
      )}
    </div>
  );
}
