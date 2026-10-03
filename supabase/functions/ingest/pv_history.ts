import { HistoricalPanel, PvChangeOperations } from './schema.ts'

export interface PvConfigurationStage {
  readonly effectiveDate: Solaroid.Supabase.Date.Ymd
  readonly spendingId?: number
  readonly fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[]
}

export class InvalidPvHistoryError extends Error {}

export function reconstructPvConfigurationStages(
  metadata: Solaroid.Supabase.Plant.Metadata,
  launchDate: Solaroid.Supabase.Date.Ymd,
  changes: readonly Solaroid.Supabase.Plant.Pv.ChangeRecord[],
): readonly PvConfigurationStage[] {
  if (!changes.length) return []

  const currentFields = parseCurrentFields(metadata)
  const orderedChanges = [...changes]
    .map((change) => ({
      ...change,
      operations: parseOperations(change.operations),
    }))
    .sort((first, second) => first.date.localeCompare(second.date) || first.id - second.id)

  for (const change of orderedChanges) {
    if (change.date < launchDate) {
      throw new InvalidPvHistoryError(`PV change ${change.id} predates plant launch`)
    }
    if (change.type === 'improvement' && change.operations.some(isCapacityReduction)) {
      throw new InvalidPvHistoryError(`Improvement PV change ${change.id} cannot reduce capacity`)
    }
  }

  let fields = cloneFields(currentFields)
  for (const change of [...orderedChanges].reverse()) {
    for (const operation of [...change.operations].reverse()) {
      fields = undoOperation(fields, operation)
      assertHistoricalConfiguration(fields, true)
    }
  }
  assertHistoricalConfiguration(fields)

  const stages: PvConfigurationStage[] = [{ effectiveDate: launchDate, fields: cloneFields(fields) }]
  for (const change of orderedChanges) {
    for (const operation of change.operations) {
      fields = applyOperation(fields, operation)
      assertHistoricalConfiguration(fields, true)
    }
    stages.push({
      effectiveDate: change.date,
      ...(change.spending_id === null ? {} : { spendingId: change.spending_id }),
      fields: cloneFields(fields),
    })
  }

  if (normalizedFields(fields) !== normalizedFields(currentFields)) {
    throw new InvalidPvHistoryError('PV changes do not reconstruct current plant metadata')
  }

  return stages
}

function parseCurrentFields(metadata: Solaroid.Supabase.Plant.Metadata) {
  const parsed = HistoricalPanel.array().safeParse(metadata.pvs)
  if (!parsed.success) {
    throw new InvalidPvHistoryError('Current PV fields require id and modules')
  }
  assertUniqueIds(parsed.data)
  return parsed.data
}

function parseOperations(operations: readonly Solaroid.Supabase.Plant.Pv.ChangeOperation[]) {
  const parsed = PvChangeOperations.safeParse(operations)
  if (!parsed.success) throw new InvalidPvHistoryError('PV change operations are invalid')
  return parsed.data
}

function undoOperation(
  fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[],
  operation: Solaroid.Supabase.Plant.Pv.ChangeOperation,
) {
  if (operation.kind === 'add_field') {
    const field = fields.find((candidate) => candidate.id === operation.field.id)
    if (!field) {
      throw new InvalidPvHistoryError(`Added PV field ${operation.field.id} is missing from current metadata`)
    }
    if (normalizedFields([field]) !== normalizedFields([operation.field])) {
      throw new InvalidPvHistoryError(`Added PV field ${operation.field.id} does not match its recorded configuration`)
    }
    return fields.filter((field) => field.id !== operation.field.id)
  }

  if (operation.kind === 'remove_field') {
    if (fields.some((field) => field.id === operation.field.id)) {
      throw new InvalidPvHistoryError(`Removed PV field ${operation.field.id} still exists after its event`)
    }
    return [...fields, { ...operation.field }]
  }

  const field = fields.find((candidate) => candidate.id === operation.field_id)
  if (!field) throw new InvalidPvHistoryError(`PV field ${operation.field_id} does not exist`)

  if (operation.kind === 'decrease_field') {
    return fields.map((candidate) => candidate.id === operation.field_id
      ? {
        ...candidate,
        modules: candidate.modules + operation.modules_removed,
        power: candidate.power + operation.power_removed_w,
      }
      : candidate)
  }

  const modules = field.modules - operation.modules_added
  const power = field.power - operation.power_added_w
  if (modules <= 0 || power <= 0) {
    throw new InvalidPvHistoryError(`PV field ${operation.field_id} has invalid historical capacity`)
  }

  return fields.map((candidate) => candidate.id === operation.field_id ? { ...candidate, modules, power } : candidate)
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
