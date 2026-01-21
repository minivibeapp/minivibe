/**
 * Claude module types
 */

/**
 * Permission prompt captured from Claude CLI
 */
export interface PermissionPrompt {
  type: 'permission_prompt';
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  prompt_id?: string;
  question?: string;
  options?: Array<{
    id: number;
    label: string;
    requiresInput?: boolean;
  }>;
}
