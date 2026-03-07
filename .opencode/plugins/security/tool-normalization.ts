import type { PermissionInput, ToolInput } from "../adapters/types";

export type SecurityCategory = "bash_command" | "path_access" | "other";

export function summarizeArgKeys(args: Record<string, unknown> | undefined): string {
  if (!args) return "";

  const keys = Object.keys(args);
  if (keys.length === 0) return "";

  return keys.slice(0, 20).join(",") + (keys.length > 20 ? ",..." : "");
}

export function getSecurityCategory(toolName: string, command: string): SecurityCategory {
  const lowerTool = toolName.toLowerCase();

  if (["read", "write", "edit", "apply_patch"].includes(lowerTool)) {
    return "path_access";
  }

  if (command.startsWith("read:") || command.startsWith("write:") || command.startsWith("edit:")) {
    return "path_access";
  }

  if (lowerTool === "bash") {
    return "bash_command";
  }

  return "other";
}

export function extractCommand(input: PermissionInput | ToolInput): string | null {
  const toolName = input.tool.toLowerCase();

  if (toolName === "bash" && typeof input.args?.command === "string") {
    return input.args.command;
  }

  if (["write", "read", "edit", "apply_patch"].includes(toolName)) {
    if (toolName === "apply_patch" && typeof input.args?.patchText === "string") {
      return "apply_patch";
    }

    const filePath =
      typeof input.args?.filePath === "string"
        ? input.args.filePath
        : typeof input.args?.file_path === "string"
          ? input.args.file_path
          : undefined;

    if (typeof filePath === "string") {
      return `${toolName}:${filePath}`;
    }
  }

  return null;
}
