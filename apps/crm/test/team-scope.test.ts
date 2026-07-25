import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { expandManagedTeamIds } from '../server/utils/team-scope.ts'

describe('expandManagedTeamIds', () => {
  it('includes direct teams and every descendant in a DAG', () => {
    assert.deepEqual(
      expandManagedTeamIds(
        ['branch'],
        [
          { parent_team_id: 'branch', child_team_id: 'mortgage' },
          { parent_team_id: 'branch', child_team_id: 'service' },
          { parent_team_id: 'mortgage', child_team_id: 'senior' },
        ],
      ),
      ['branch', 'mortgage', 'service', 'senior'],
    )
  })

  it('deduplicates descendants reachable through multiple parents', () => {
    assert.deepEqual(
      expandManagedTeamIds(
        ['division-a', 'division-b'],
        [
          { parent_team_id: 'division-a', child_team_id: 'shared-team' },
          { parent_team_id: 'division-b', child_team_id: 'shared-team' },
        ],
      ),
      ['division-a', 'division-b', 'shared-team'],
    )
  })

  it('returns an empty scope for a user without direct team administration', () => {
    assert.deepEqual(
      expandManagedTeamIds([], [
        { parent_team_id: 'branch', child_team_id: 'team' },
      ]),
      [],
    )
  })
})
