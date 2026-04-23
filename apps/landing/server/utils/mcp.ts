export interface McpTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (input: unknown) => Promise<unknown>
}

const registry: McpTool[] = []

export function registerMcpTool(tool: McpTool) {
  registry.push(tool)
}

export function listMcpTools(): McpTool[] {
  return registry
}
