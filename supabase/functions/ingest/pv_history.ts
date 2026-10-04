import { PvChangeOperations } from './schema.ts'

export interface PvConfigurationStage {
  readonly effectiveDate: Solaroid.Supabase.Date.Ymd
  readonly spendingId?: number
  readonly fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[]
}

export class InvalidPvHistoryError extends Error {}

export function comparePvChanges(
  first: Solaroid.Supabase.Plant.Pv.ChangeRecord,
  second: Solaroid.Supabase.Plant.Pv.ChangeRecord,
) {
  const dateOrder = first.date.localeCompare(second.date)
  if (dateOrder) return dateOrder
  if (first.type === 'commissioning' && second.type !== 'commissioning') return -1
  if (second.type === 'commissioning' && first.type !== 'commissioning') return 1
  return first.id - second.id
}

export function reconstructPvConfigurationStages(
  launchDate: Solaroid.Supabase.Date.Ymd,
  changes: readonly Solaroid.Supabase.Plant.Pv.ChangeRecord[],
): readonly PvConfigurationStage[] {
  const orderedChanges = [...changes]
    .map((change) => ({
      ...change,
      operations: parseOperations(change.operations),
    }))
    .sort(comparePvChanges)

  const commissioningEvents = orderedChanges.filter((change) => change.type === 'commissioning')
  if (commissioningEvents.length !== 1) {
    throw new InvalidPvHistoryError('PV history requires exactly one commissioning event')
  }
  if (orderedChanges[0]?.id !== commissioningEvents[0].id) {
    throw new InvalidPvHistoryError('PV commissioning must be the first event')
  }

  for (const change of orderedChanges) {
    if (change.date < launchDate) {
      throw new InvalidPvHistoryError(`PV change ${change.id} predates plant launch`)
    }
    if (change.type === 'commissioning') {
      if (change.date !== launchDate) {
        throw new InvalidPvHistoryError('PV commissioning date must match plant launch date')
      }
      if (change.spending_id !== null) {
        throw new InvalidPvHistoryError('PV commissioning cannot link to spending')
      }
      if (change.operations.some((operation) => operation.kind !== 'add_field')) {
        throw new InvalidPvHistoryError('PV commissioning may only add fields')
      }
    }
    if (change.type === 'improvement' && change.operations.some(isCapacityReduction)) {
      throw new InvalidPvHistoryError(`Improvement PV change ${change.id} cannot reduce capacity`)
    }
  }

  let fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[] = []
  const stages: PvConfigurationStage[] = []
  for (const change of orderedChanges) {
    for (const operation of change.operations) {
      fields = applyOperation(fields, operation)
      assertHistoricalConfiguration(fields, true)
    }
    if (change.type === 'commissioning') assertHistoricalConfiguration(fields)
    stages.push({
      effectiveDate: change.date,
      ...(change.spending_id === null ? {} : { spendingId: change.spending_id }),
      fields: cloneFields(fields),
    })
  }

  return stages
}

function parseOperations(operations: readonly Solaroid.Supabase.Plant.Pv.ChangeOperation[]) {
  const parsed = PvChangeOperations.safeParse(operations)
  if (!parsed.success) throw new InvalidPvHistoryError('PV change operations are invalid')
  return parsed.data
}

function applyOperation(
  fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[],
  operation: Solaroid.Supabase.Plant.Pv.ChangeOperation,
) {
  if (operation.kind === 'add_field') {
    if (fields.some((field) => field.id === operation.field.id)) {
      throw new InvalidPvHistoryError(`PV field ${operation.field.id} already exists`)
    }
    return [...fields, { ...operation.field }]
  }

  if (operation.kind === 'remove_field') {
    const field = fields.find((candidate) => candidate.id === operation.field.id)
    if (!field) throw new InvalidPvHistoryError(`PV field ${operation.field.id} does not exist`)
    if (normalizedFields([field]) !== normalizedFields([operation.field])) {
      throw new InvalidPvHistoryError(`Removed PV field ${operation.field.id} does not match its recorded configuration`)
    }
    return fields.filter((candidate) => candidate.id !== operation.field.id)
  }

  const field = fields.find((candidate) => candidate.id === operation.field_id)
  if (!field) throw new InvalidPvHistoryError(`PV field ${operation.field_id} does not exist`)

  if (operation.kind === 'decrease_field') {
    const modules = field.modules - operation.modules_removed
    const power = field.power - operation.power_removed_w
    if (modules <= 0 || power <= 0) {
      throw new InvalidPvHistoryError(`PV field ${operation.field_id} must use remove_field when fully removed`)
    }
    return fields.map((candidate) => candidate.id === operation.field_id ? { ...candidate, modules, power } : candidate)
  }

  return fields.map((candidate) => candidate.id === operation.field_id
    ? {
      ...candidate,
      modules: candidate.modules + operation.modules_added,
      power: candidate.power + operation.power_added_w,
    }
    : candidate)
}

function cloneFields(fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[]) {
  return fields.map((field) => ({ ...field }))
}

function assertUniqueIds(fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[]) {
  const ids = new Set<string>()
  for (const field of fields) {
    if (ids.has(field.id)) throw new InvalidPvHistoryError(`PV field ${field.id} is duplicated`)
    ids.add(field.id)
  }
}

function assertHistoricalConfiguration(
  fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[],
  allowEmpty = false,
) {
  if (!allowEmpty && !fields.length) throw new InvalidPvHistoryError('Initial PV configuration cannot be empty')
  assertUniqueIds(fields)
  for (const field of fields) {
    if (field.modules <= 0 || field.power <= 0) {
      throw new InvalidPvHistoryError(`PV field ${field.id} has invalid historical capacity`)
    }
  }
}

function normalizedFields(fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[]) {
  return JSON.stringify([...fields].sort((first, second) => first.id.localeCompare(second.id)))
}

function isCapacityReduction(operation: Solaroid.Supabase.Plant.Pv.ChangeOperation) {
  return operation.kind === 'decrease_field' || operation.kind === 'remove_field'
}
