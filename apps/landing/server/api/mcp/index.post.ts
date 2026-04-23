export default defineEventHandler(async (event) => {
  const body = await readBody<{ method: string; params?: Record<string, unknown> }>(event)

  if (body.method === 'tools/list') {
    return {
      tools: listMcpTools().map(({ name, description, inputSchema }) => ({
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
    const tool = listMcpTools().find((t) => t.name === name)
    if (!tool) throw createError({ statusCode: 404, statusMessage: `tool ${name} not found` })
    return await tool.handler(args)
  }

  throw createError({ statusCode: 400, statusMessage: `unknown method: ${body.method}` })
})
