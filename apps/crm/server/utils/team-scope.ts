export interface TeamScopeEdge {
  parent_team_id: string
  child_team_id: string
}

export function expandManagedTeamIds(
  directAdminTeamIds: Iterable<string>,
  edges: Iterable<TeamScopeEdge>,
): string[] {
  const managedTeamIds = new Set(directAdminTeamIds)
  const childrenByParent = new Map<string, string[]>()

  for (const edge of edges) {
    const children = childrenByParent.get(edge.parent_team_id) ?? []
    children.push(edge.child_team_id)
    childrenByParent.set(edge.parent_team_id, children)
  }

  const queue = [...managedTeamIds]
  for (let index = 0; index < queue.length; index += 1) {
    const teamId = queue[index]
    if (!teamId) continue

    for (const childTeamId of childrenByParent.get(teamId) ?? []) {
      if (managedTeamIds.has(childTeamId)) continue
      managedTeamIds.add(childTeamId)
      queue.push(childTeamId)
    }
  }

  return [...managedTeamIds]
}
