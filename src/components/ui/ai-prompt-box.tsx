import React from "react";
import { ArrowUp } from "lucide-react";

// Utility function for className merging
const cn = (...classes: (string | undefined | null | false)[]) => classes.filter(Boolean).join(" ");

// Textarea Component
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  className?: string;
}
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex w-full rounded-md border-none bg-transparent px-3 py-2 text-sm text-fg placeholder:text-fg-faint focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50 min-h-[40px] resize-none",
      className
    )}
    ref={ref}
    rows={1}
    {...props}
  />
));
Textarea.displayName = "Textarea";

// PromptInput Context and Components
interface PromptInputContextType {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
}
const PromptInputContext = React.createContext<PromptInputContextType>({
  isLoading: false,
  value: "",
  setValue: () => {},
  maxHeight: 200,
  onSubmit: undefined,
  disabled: false,
});
function usePromptInput() {
  return React.useContext(PromptInputContext);
}

interface PromptInputProps {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}
const PromptInput = React.forwardRef<HTMLDivElement, PromptInputProps>(
  (
    {
      className,
      isLoading = false,
      maxHeight = 200,
      value,
      onValueChange,
      onSubmit,
      children,
      disabled = false,
    },
    ref
  ) => {
    const [internalValue, setInternalValue] = React.useState(value || "");
    const handleChange = (newValue: string) => {
      setInternalValue(newValue);
      onValueChange?.(newValue);
    };
    return (
      <PromptInputContext.Provider
        value={{
          isLoading,
          value: value ?? internalValue,
          setValue: onValueChange ?? handleChange,
          maxHeight,
          onSubmit,
          disabled,
        }}
      >
        <div
          ref={ref}
          className={cn(
            "rounded-2xl border border-border bg-bg-raised p-1.5 transition-colors focus-within:border-border-hover",
            className
          )}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    );
  }
);
PromptInput.displayName = "PromptInput";

interface PromptInputTextareaProps {
  disableAutosize?: boolean;
  placeholder?: string;
}
const PromptInputTextarea: React.FC<PromptInputTextareaProps & React.ComponentProps<typeof Textarea>> = ({
  className,
  onKeyDown,
  disableAutosize = false,
  placeholder,
  ...props
}) => {
  const { value, setValue, maxHeight, onSubmit, disabled } = usePromptInput();
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (disableAutosize || !textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height =
      typeof maxHeight === "number"
        ? `${Math.min(textareaRef.current.scrollHeight, maxHeight)}px`
        : `min(${textareaRef.current.scrollHeight}px, ${maxHeight})`;
  }, [value, maxHeight, disableAutosize]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(e);
  };

  return (
    <Textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      className={cn("text-sm", className)}
      disabled={disabled}
      placeholder={placeholder}
      {...props}
    />
  );
};

// Main PromptInputBox Component
interface PromptInputBoxProps {
  onSend?: (message: string, files?: File[]) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
}
export const PromptInputBox = React.forwardRef((props: PromptInputBoxProps, ref: React.Ref<HTMLDivElement>) => {
  const { onSend = () => {}, isLoading = false, placeholder = "Type your message here...", className } = props;
  const [input, setInput] = React.useState("");
  const promptBoxRef = React.useRef<HTMLDivElement>(null);

  // TODO: File attachments (commented out for now)
  // const [files, setFiles] = React.useState<File[]>([]);
  // const [filePreviews, setFilePreviews] = React.useState<{ [key: string]: string }>({});
  // const uploadInputRef = React.useRef<HTMLInputElement>(null);

  // TODO: Voice recording (commented out for now)
  // const [isRecording, setIsRecording] = React.useState(false);

  // TODO: Search/Think/Canvas toggles (commented out for now)
  // const [showSearch, setShowSearch] = React.useState(false);
  // const [showThink, setShowThink] = React.useState(false);
  // const [showCanvas, setShowCanvas] = React.useState(false);

  const handleSubmit = () => {
    if (input.trim()) {
      onSend(input);
      setInput("");
    }
  };

  const hasContent = input.trim() !== "";

  return (
    <PromptInput
      value={input}
      onValueChange={setInput}
      isLoading={isLoading}
      onSubmit={handleSubmit}
      className={cn("w-full", className)}
      disabled={isLoading}
      ref={ref || promptBoxRef}
    >
      {/* TODO: File preview area
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 p-0 pb-1">
          ...file thumbnails...
        </div>
      )}
      */}

      <PromptInputTextarea
        placeholder={placeholder}
        className="text-sm"
      />

      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-1">
          {/* TODO: Attachment button
          <button className="flex h-7 w-7 items-center justify-center rounded-full text-fg-subtle transition-colors hover:bg-bg-hover hover:text-fg-muted">
            <Paperclip className="h-4 w-4" />
          </button>
          */}

          {/* TODO: Search toggle
          <button className="...">
            <Globe className="h-4 w-4" />
          </button>
          */}

          {/* TODO: Think toggle
          <button className="...">
            <BrainCog className="h-4 w-4" />
          </button>
          */}

          {/* TODO: Canvas toggle
          <button className="...">
            <FolderCode className="h-4 w-4" />
          </button>
          */}
        </div>

        <button
          onClick={handleSubmit}
          disabled={!hasContent || isLoading}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full transition-all duration-150",
            hasContent && !isLoading
              ? "bg-accent text-white hover:bg-accent-hover"
              : "bg-bg-hover text-fg-faint"
          )}
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </PromptInput>
  );
});
PromptInputBox.displayName = "PromptInputBox";
