import type { MortgageCalculation, MortgageScenario } from './types'

const EPSILON = 0.005

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function positive(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

function annuity(balance: number, annualRatePct: number, months: number): number {
  if (months <= 0) return balance
  const rate = annualRatePct / 100 / 12
  if (Math.abs(rate) < 1e-12) return balance / months
  return balance * rate * (1 + rate) ** months / ((1 + rate) ** months - 1)
}

function validate(input: MortgageScenario): void {
  if (!Number.isFinite(input.loanAmount) || input.loanAmount <= 0) throw new Error('loanAmount must be positive')
  if (!Number.isFinite(input.propertyValue) || input.propertyValue <= 0) throw new Error('propertyValue must be positive')
  if (!Number.isInteger(input.termMonths) || input.termMonths <= 0 || input.termMonths > 600) throw new Error('termMonths must be an integer between 1 and 600')
  if (positive(input.fixedPeriodMonths) > input.termMonths) throw new Error('fixedPeriodMonths cannot exceed termMonths')
}

function annualRate(input: MortgageScenario, month: number): number {
  const fixedMonths = positive(input.fixedPeriodMonths)
  if (input.fixedRatePct != null && month <= fixedMonths) return input.fixedRatePct
  return positive(input.marginPct) + positive(input.referenceRatePct) + (input.referenceRateDeltaPct ?? 0)
}

function recurringCosts(input: MortgageScenario, month: number, openingBalance: number): number {
  const rules = input.costRules ?? {}
  const account = positive(rules.accountMonthlyFee)
  const card = positive(rules.cardMonthlyFee)
  const property = input.propertyValue * positive(rules.propertyInsuranceAnnualRatePct) / 100 / 12
  const life = !rules.lifeInsuranceMonths || month <= rules.lifeInsuranceMonths
    ? openingBalance * positive(rules.lifeInsuranceMonthlyRatePct) / 100
    : 0
  return account + card + property + life
}

function initialCosts(input: MortgageScenario): number {
  const rules = input.costRules ?? {}
  return input.loanAmount * positive(rules.commissionPct) / 100
    + positive(rules.appraisalFee)
    + positive(rules.pccFee)
    + positive(rules.courtFee)
}

export function calculateMortgage(input: MortgageScenario): MortgageCalculation {
  validate(input)
  const schedule: MortgageCalculation['schedule'] = []
  const fixedMonths = positive(input.fixedPeriodMonths)
  const strategy = input.overpaymentStrategy ?? 'shorten_term'
  let balance = input.loanAmount
  let equalPayment = input.installmentType === 'equal'
    ? annuity(balance, annualRate(input, 1), input.termMonths)
    : 0
  let previousRate = annualRate(input, 1)

  for (let month = 1; month <= input.termMonths && balance > EPSILON; month += 1) {
    const openingBalance = balance
    const rate = annualRate(input, month)
    const remainingMonths = input.termMonths - month + 1
    if (input.installmentType === 'equal' && (month === 1 || rate !== previousRate || strategy === 'lower_payment')) {
      equalPayment = annuity(openingBalance, rate, remainingMonths)
    }

    const interest = openingBalance * rate / 100 / 12
    const scheduledPrincipal = input.installmentType === 'equal'
      ? Math.max(0, Math.min(openingBalance, equalPayment - interest))
      : Math.min(openingBalance, input.loanAmount / input.termMonths)
    const installment = scheduledPrincipal + interest
    const requestedOverpayment = positive(input.monthlyOverpayment)
      + positive(input.oneOffOverpayments?.[month])
    const overpayment = Math.min(openingBalance - scheduledPrincipal, requestedOverpayment)
    balance = Math.max(0, openingBalance - scheduledPrincipal - overpayment)
    const costs = recurringCosts(input, month, openingBalance)

    schedule.push({
      month,
      annualRatePct: money(rate),
      openingBalance: money(openingBalance),
      installment: money(installment),
      principal: money(scheduledPrincipal),
      interest: money(interest),
      overpayment: money(overpayment),
      recurringCosts: money(costs),
      closingBalance: money(balance),
    })
    previousRate = rate
  }

  const upfront = money(initialCosts(input))
  const totalPrincipal = money(schedule.reduce((sum, row) => sum + row.principal + row.overpayment, 0))
  const totalInterest = money(schedule.reduce((sum, row) => sum + row.interest, 0))
  const totalOverpayments = money(schedule.reduce((sum, row) => sum + row.overpayment, 0))
  const totalRecurringCosts = money(schedule.reduce((sum, row) => sum + row.recurringCosts, 0))
  const totalCost = money(totalInterest + totalRecurringCosts + upfront)
  const first = schedule[0]
  const postFixed = fixedMonths > 0 ? schedule.find((row) => row.month === fixedMonths + 1) : null

  return {
    ltvPct: money(input.loanAmount / input.propertyValue * 100),
    initialCosts: upfront,
    firstInstallment: first?.installment ?? 0,
    firstRecurringCosts: first?.recurringCosts ?? 0,
    firstTotalOutflow: money(
      (first?.installment ?? 0)
      + (first?.recurringCosts ?? 0)
      + (first?.overpayment ?? 0),
    ),
    postFixedInstallment: postFixed?.installment ?? null,
    paidOffMonth: schedule.at(-1)?.month ?? 0,
    totalPrincipal,
    totalInterest,
    totalOverpayments,
    totalRecurringCosts,
    totalCost,
    totalPayment: money(totalPrincipal + totalInterest + totalRecurringCosts + upfront),
    costFirstFiveYears: money(upfront + schedule.slice(0, 60).reduce((sum, row) => sum + row.interest + row.recurringCosts, 0)),
    schedule,
  }
}
