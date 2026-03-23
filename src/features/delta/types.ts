export interface DeltaMetadata {
  id: string;
  name: string;
  status: DeltaStatus;
  repos: DeltaRepo[];
  created_at: number;
  updated_at: number;
}

export type DeltaStatus =
  | "planning"
  | "ready"
  | "executing"
  | "reviewing"
  | "completed"
  | "cancelled";

export interface DeltaRepo {
  path: string;
  role: string;
}

export interface TaskDAG {
  tasks: TaskDef[];
}

export interface TaskDef {
  id: string;
  title: string;
  description: string;
  repo: string;
  depends_on: string[];
  agent: string;
  gates: GateDef[];
  timeout_secs?: number;
}

export type GateDef =
  | { type: "command"; run: string; expect: string }
  | { type: "file_exists"; path: string }
  | { type: "agent_review"; prompt: string };

export interface TaskState {
  id: string;
  status: TaskStatus;
  agent: string;
  pty_session_id: string | null;
  worktree_path: string | null;
  worktree_branch: string | null;
  base_branch: string | null;
  started_at: number | null;
  completed_at: number | null;
  gate_results: GateResultEntry[];
  summary: string | null;
  retry_count: number;
}

export type TaskStatus =
  | "blocked"
  | "ready"
  | "running"
  | "blocked_on_question"
  | "verifying"
  | "done";

export interface GateResultEntry {
  gate_index: number;
  gate_type: string;
  passed: boolean;
  output: string;
}

export type DeltaEvent =
  | {
      type: "user_message";
      message: string;
      timestamp: number;
    }
  | {
      type: "progress";
      task_id: string;
      agent: string;
      message: string;
      timestamp: number;
    }
  | {
      type: "question";
      id: string;
      task_id: string;
      agent: string;
      blocking: boolean;
      question: string;
      options: string[];
      timestamp: number;
    }
  | {
      type: "task_complete";
      task_id: string;
      agent: string;
      summary: string;
      timestamp: number;
    }
  | {
      type: "plan_update";
      task_id: string;
      agent: string;
      section: string;
      content: string;
      timestamp: number;
    }
  | {
      type: "task_state";
      task_id: string;
      from: string;
      to: string;
      reason: string;
      timestamp: number;
    }
  | {
      type: "gate_result";
      task_id: string;
      gate_index: number;
      gate_type: string;
      passed: boolean;
      output: string;
      timestamp: number;
    }
  | {
      type: "question_answered";
      question_id: string;
      answer: string;
      answered_by: string;
      timestamp: number;
    }
  | {
      type: "review_finding";
      task_id: string;
      agent: string;
      severity: string;
      file: string;
      line?: number;
      message: string;
      suggestion: string;
      timestamp: number;
    };
