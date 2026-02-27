import { z } from 'zod'

export const DrugTypeSchema = z.enum([
  'Cannabis',
  'THC/CBD',
  'Cathinones',
  'Cocaine',
  'Cough medicine',
  'Ecstasy',
  'GHB/GBL',
  'Heroin',
  'Ketamine',
  'Nimetazepam',
  'Morphine',
  'Methamphetamine',
  'Salvia',
  'TFMPP',
  'Etomidate',
  'Other',
])

export const DefendantRoleSchema = z.enum([
  'Courier',
  'Storekeeper',
  'Lookout/scout',
  'Actual trafficker',
  'Manager/organizer',
  'Operator/financial controller',
  'International operator/financial controller',
  'Other',
])

export const AggravatingFactorTypeSchema = z.enum([
  'Refugee/Asylum',
  'Illegal immigrant',
  'On bail',
  'Suspended sentence',
  'CSD supervision',
  'Wanted',
  'Persistent offender',
  'Import',
  'Export',
  'Use of minors',
  'Multiple drugs',
  'Role of the defendant',
  'Other',
])

export const MitigatingFactorTypeSchema = z.enum([
  'Voluntary surrender',
  'Self-consumption',
  'Assistance - limited',
  'Assistance - useful',
  'Assistance - testify',
  'Assistance - risk',
  'Extreme youth',
  'Young offender',
  'Medical conditions',
  'Family illness',
  'Prosecutorial delay',
  'Mistaken belief',
  'Rehabilitation programme',
  'Other',
])

export const CourtTypeSchema = z.enum(['High Court', 'District Court'])

export const HighCourtPleaStageSchema = z.enum([
  'Unknown',
  'Up to committal',
  'After committal',
  'After dates fixed',
  'First day',
  'During trial',
])

export const DistrictCourtPleaStageSchema = z.enum([
  'Unknown',
  'Plea day',
  'After dates fixed',
  'First day',
  'During trial',
])

export const ChargeTypeSchema = z.enum([
  'Actual Trafficking',
  'Conspiracy to Traffic',
])

export const DrugDetailSchema = z
  .object({
    drug_type: DrugTypeSchema,
    other_drug_type: z.string().nullable().default(null),
    quantity: z.number(),
    source: z.string(),
  })
  .refine(
    (data) => {
      if (data.drug_type === 'Other' && data.other_drug_type === null) {
        return false
      }
      return true
    },
    {
      message: "other_drug_type is required when drug_type is 'Other'",
    },
  )

export const RoleDetailSchema = z.object({
  role: DefendantRoleSchema,
  source: z.string(),
})

export const AggravatingFactorDetailSchema = z
  .object({
    factor: AggravatingFactorTypeSchema,
    other_factor: z.string().nullable().default(null),
    enhancement: z.number().nullable().default(null),
    source: z.string(),
  })
  .refine(
    (data) => {
      if (data.factor === 'Other' && data.other_factor === null) {
        return false
      }
      return true
    },
    {
      message: "other_factor is required when factor is 'Other'",
    },
  )

export const GuiltyPleaDetailSchema = z
  .object({
    pleaded_guilty: z.boolean(),
    court_type: CourtTypeSchema.nullable().default(null),
    high_court_stage: HighCourtPleaStageSchema.nullable().default(null),
    district_court_stage: DistrictCourtPleaStageSchema.nullable().default(null),
    source: z.string(),
  })
  .refine(
    (data) => {
      if (data.pleaded_guilty && data.court_type === null) {
        return false
      }
      if (data.court_type === 'High Court' && data.high_court_stage === null) {
        return false
      }
      if (
        data.court_type === 'District Court' &&
        data.district_court_stage === null
      ) {
        return false
      }
      return true
    },
    {
      message: 'Conditional fields validation failed',
    },
  )

export const MitigatingFactorDetailSchema = z
  .object({
    factor: MitigatingFactorTypeSchema,
    other_factor: z.string().nullable().default(null),
    reduction: z.number().nullable().default(null),
    source: z.string(),
  })
  .refine(
    (data) => {
      if (data.factor === 'Other' && data.other_factor === null) {
        return false
      }
      return true
    },
    {
      message: "other_factor is required when factor is 'Other'",
    },
  )

export const StartingPointDetailInputSchema = z.object({
  sentence_years: z.number(),
  sentence_months: z.number(),
  source: z.string(),
})

export const StartingPointDetailSchema =
  StartingPointDetailInputSchema.transform((data) => ({
    ...data,
    total_months: data.sentence_years * 12 + data.sentence_months,
  }))

export const SentenceAfterRoleDetailInputSchema = z.object({
  sentence_years: z.number(),
  sentence_months: z.number(),
  source: z.string(),
})

export const SentenceAfterRoleDetailSchema =
  SentenceAfterRoleDetailInputSchema.transform((data) => ({
    ...data,
    total_months: data.sentence_years * 12 + data.sentence_months,
  }))

export const NotionalSentenceDetailInputSchema = z.object({
  sentence_years: z.number(),
  sentence_months: z.number(),
  source: z.string(),
})

export const NotionalSentenceDetailSchema =
  NotionalSentenceDetailInputSchema.transform((data) => ({
    ...data,
    total_months: data.sentence_years * 12 + data.sentence_months,
  }))

export const MitigationReductionDetailSchema = z.object({
  reduction_months: z.number(),
  source: z.string(),
})

export const FinalSentenceDetailInputSchema = z.object({
  sentence_years: z.number(),
  sentence_months: z.number(),
  guilty_plea_reduction_years: z.number().nullable().default(null),
  guilty_plea_reduction_months: z.number().nullable().default(null),
  source: z.string(),
})

export const FinalSentenceDetailSchema =
  FinalSentenceDetailInputSchema.transform((data) => ({
    ...data,
    total_months: data.sentence_years * 12 + data.sentence_months,
    guilty_plea_reduction_total_months:
      data.guilty_plea_reduction_years === null &&
      data.guilty_plea_reduction_months === null
        ? null
        : (data.guilty_plea_reduction_years || 0) * 12 +
          (data.guilty_plea_reduction_months || 0),
  }))

export const ChargeDetailSchema = z.object({
  charge_no: z.number(),
  type: ChargeTypeSchema,
  defendant_name: z.string(),
  defendant_id: z.number(),
  source: z.string(),
})

export const TrialSchema = z.object({
  charge_type: ChargeDetailSchema,
  drugs: z.array(DrugDetailSchema).min(1),
  roles: z.array(RoleDetailSchema),
  aggravating_factors: z
    .array(AggravatingFactorDetailSchema)
    .nullable()
    .default(null),
  mitigating_factors: z
    .array(MitigatingFactorDetailSchema)
    .nullable()
    .default(null),
  guilty_plea: GuiltyPleaDetailSchema,
  starting_point: StartingPointDetailSchema,
  sentence_after_role: SentenceAfterRoleDetailSchema.nullable().default(null),
  notional_sentence: NotionalSentenceDetailSchema,
  mitigation_reduction:
    MitigationReductionDetailSchema.nullable().default(null),
  final_sentence: FinalSentenceDetailSchema,
})

export const TrialsSchema = z.object({
  trials: z.array(TrialSchema),
})
