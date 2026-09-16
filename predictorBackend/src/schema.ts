import { z } from '@hono/zod-openapi'

export const DrugTypeSchema = z.enum([
	'Cocaine',
	'Ketamine',
	'Fluorodeschloroketamine',
	'Methamphetamine',
	'Heroin',
	'Cannabis/THC',
	'Ecstasy',
	'Midazolam',
	'Nimetazepam',
])

// export const MidazolamVariantSchema = z.literal('powder')

export const DefendantRoleSchema = z.enum([
	'Courier / Storekeeper',
	'Actual trafficker',
	'Manager / Organiser',
	'Operator / Financial Controller',
])

export const AdditionalCircumstanceSchema = z.literal(
	'Cross-border trafficking',
)

export const GuiltyPleaSchema = z.enum([
	'Plead not guilty',
	'Plead guilty (earliest opportunity)',
	'Plead guilty (before trial dates are set)',
	'Plead guilty (before trial starts)',
	'Plead guilty (first day of trial)',
	'Plead guilty (during the trial)',
])

// 'notional-weighted' is the original starting point: for each drug, take the
// sentence the total quantity would attract in that drug's family, weight it by
// the drug's share of the total quantity, and sum.
// 'multi-drug-floor' additionally requires the starting point to clear the most
// serious single drug / guideline group; see predictMultiDrugFloorStartingPoint.
export const STARTING_POINT_MODES = [
	'notional-weighted',
	'multi-drug-floor',
] as const

export type StartingPointMode = (typeof STARTING_POINT_MODES)[number]

export const StartingPointModeSchema = z.enum(STARTING_POINT_MODES)

export const AggravatingFactorSchema = z.enum([
	'Multiple Drugs',
	'Persistent offender',
	'On bail',
	'Refugee/Asylum',
	'Use of minors',
])

export const MitigatingFactorSchema = z.enum([
	'Self-consumption',
	'Assistance - limited',
	'Assistance - useful',
	'Assistance - testify',
	'Assistance - risk',
	'Young offender',
	'Medical conditions',
	'Family illness',
	'Rehabilitation programme',
])

const DrugInputSchema = z
	.object({
		type: DrugTypeSchema,
		quantity: z.number().finite().positive(),
		// variant: MidazolamVariantSchema.optional(),
	})
	.strict()
	// .superRefine((drug, context) => {
	// 	if (drug.type === 'Midazolam' && drug.variant === undefined) {
	// 		context.addIssue({
	// 			code: 'custom',
	// 			path: ['variant'],
	// 			message: 'Variant is required for Midazolam',
	// 		})
	// 	}

	// 	if (drug.type !== 'Midazolam' && drug.variant !== undefined) {
	// 		context.addIssue({
	// 			code: 'custom',
	// 			path: ['variant'],
	// 			message: 'Variant is only supported for Midazolam',
	// 		})
	// 	}
	// })

function addDuplicateIssues(
	values: ReadonlyArray<string>,
	path: string,
	context: z.RefinementCtx,
) {
	const seen = new Set<string>()
	for (const [index, value] of values.entries()) {
		if (seen.has(value)) {
			context.addIssue({
				code: 'custom',
				path: [path, index],
				message: 'Duplicate values are not allowed',
			})
		}
		seen.add(value)
	}
}

export const PredictionRequestSchema = z
	.object({
		drugs: z.array(DrugInputSchema).min(1),
		defendantRole: DefendantRoleSchema.nullable().optional().default(null),
		additionalCircumstances: z
			.array(AdditionalCircumstanceSchema)
			.default([]),
		guiltyPlea: GuiltyPleaSchema.nullable().optional().default(null),
		aggravatingFactors: z.array(AggravatingFactorSchema).default([]),
		mitigatingFactors: z.array(MitigatingFactorSchema).default([]),
		startingPointMode: StartingPointModeSchema.default('notional-weighted'),
	})
	.strict()
	.superRefine((request, context) => {
		addDuplicateIssues(
			request.additionalCircumstances,
			'additionalCircumstances',
			context,
		)
		addDuplicateIssues(request.aggravatingFactors, 'aggravatingFactors', context)
		addDuplicateIssues(request.mitigatingFactors, 'mitigatingFactors', context)

		if (
			request.additionalCircumstances.length > 0 &&
			request.defendantRole === null
		) {
			context.addIssue({
				code: 'custom',
				path: ['defendantRole'],
				message:
					'Defendant role is required when additional circumstances are selected',
			})
		}

		const assistanceFactors = request.mitigatingFactors.filter((factor) =>
			factor.startsWith('Assistance - '),
		)
		if (assistanceFactors.length > 1) {
			context.addIssue({
				code: 'custom',
				path: ['mitigatingFactors'],
				message: 'Only one assistance factor may be selected',
			})
		}
	})

export type PredictionRequest = z.infer<typeof PredictionRequestSchema>
