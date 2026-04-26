import { readBody, createError } from 'h3'
import { getCrmMcpTools } from '~~/server/utils/crm-mcp-tools'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ method: string; params?: Record<string, unknown> }>(event)
  const tools = getCrmMcpTools()

  if (body.method === 'tools/list') {
    return {
      tools: tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    }
  }

  if (body.method === 'tools/call') {
    const { name, arguments: args } = (body.params ?? {}) as {
      name: string
      arguments: unknown
    }
    const tool = tools.find((item) => item.name === name)
    if (!tool) throw createError({ statusCode: 404, statusMessage: `tool ${name} not found` })
    return await tool.handler(event, args)
  }

  throw createError({ statusCode: 400, statusMessage: `unknown method: ${body.method}` })
})

