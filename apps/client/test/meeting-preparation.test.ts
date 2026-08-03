import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildMeetingPreparationSummary,
  createMeetingPreparationState,
  meetingPreparationProgress,
  parseMeetingPreparationState,
  profileIsReady,
} from '../app/utils/meeting-preparation.ts'

function completedProfile() {
  return {
    goal: 'purchase' as const,
    stage: 'searching' as const,
    incomeSources: ['employment'] as const,
    coBorrower: 'no' as const,
    propertyBudget: '600k_800k' as const,
    ownFunds: '100k_200k' as const,
    loanAmount: '500k_700k' as const,
    loanTerm: '30' as const,
    monthlyNetIncome: '10k_15k' as const,
    monthlyObligations: 'up_to_1k' as const,
    comfortablePayment: '3500_4500' as const,
  }
}

describe('meeting preparation answers', () => {
  it('starts with a server-compatible v2 shape without free-text fields', () => {
    const answers = createMeetingPreparationState()

    assert.equal(answers.version, 2)
    assert.equal(answers.profile.propertyBudget, null)
    assert.equal('customQuestion' in answers, false)
    assert.equal('updatedAt' in answers, false)
    assert.equal('completedAt' in answers, false)
  })

  it('normalizes untrusted and legacy values into clickable choices', () => {
    const answers = parseMeetingPreparationState(JSON.stringify({
      version: 1,
      activeStep: 99,
      profile: {
        ...completedProfile(),
        propertyBudget: '750 000 zł',
        loanTerm: '40',
        incomeSources: ['employment', 'employment', 'invented'],
      },
      readConceptIds: ['capacity-vs-budget', 'invented'],
      checkedItemIds: ['goal-budget', 'invented'],
      selectedQuestionIds: ['safe-budget', 'invented'],
      customQuestion: 'free text is not part of v2',
    }))

    assert.equal(answers.version, 2)
    assert.equal(answers.activeStep, 4)
    assert.equal(answers.profile.propertyBudget, null)
    assert.equal(answers.profile.loanTerm, null)
    assert.deepEqual(answers.profile.incomeSources, ['employment'])
    assert.deepEqual(answers.readConceptIds, ['capacity-vs-budget'])
    assert.deepEqual(answers.checkedItemIds, ['goal-budget'])
    assert.deepEqual(answers.selectedQuestionIds, ['safe-budget'])
  })

  it('counts a complete clicked profile and renders ranges in the case brief', () => {
    const answers = createMeetingPreparationState()
    answers.profile = {
      ...completedProfile(),
      incomeSources: ['employment'],
    }
    answers.readConceptIds = ['capacity-vs-budget']
    answers.checkedItemIds = ['goal-budget']
    answers.selectedQuestionIds = ['safe-budget']

    assert.equal(profileIsReady(answers.profile), true)
    assert.ok(meetingPreparationProgress(answers) > 55)
    assert.match(buildMeetingPreparationSummary(answers), /600–800 tys\. zł/)
    assert.match(buildMeetingPreparationSummary(answers), /Brief jest zapisany przy sprawie/)
  })
})
