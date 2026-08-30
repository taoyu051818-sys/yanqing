import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  new URL(
    '../../prisma/migrations/20260830173000_training_trials_youth_rules/migration.sql',
    import.meta.url,
  ),
  'utf8',
)

describe('training trial and youth rule database guards', () => {
  it('guards idempotency keys and lowercase sha-256 command hashes', () => {
    expect(migration).toContain('"TrainingTrial_creation_key_check"')
    expect(migration).toContain('"TrainingTrialTransition_key_check"')
    expect(migration).toContain('"YouthTrainingRule_request_key_check"')
    expect(migration.match(/\^\[0-9a-f\]\{64\}\$/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('requires status evidence, structured assessment and maker-checker decisions', () => {
    expect(migration).toContain('"TrainingTrial_status_evidence_check"')
    expect(migration).toContain('"TrainingTrial_assessment_check"')
    expect(migration).toContain('jsonb_array_length("assessmentDimensions") > 0')
    expect(migration).toContain('"YouthTrainingRule_maker_checker_check"')
    expect(migration).toContain('"decisionCommandHash" IS NOT NULL')
  })
})
