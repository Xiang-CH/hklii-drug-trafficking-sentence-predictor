import { describe, expect, it } from 'vitest'
import app from './app.js'

const baseRequest = {
	drugs: [{ type: 'Cocaine', quantity: 10 }],
	guiltyPlea: 'Plead not guilty',
	aggravatingFactors: [],
	mitigatingFactors: [],
}

async function post(body: unknown, path = '/api/sentence-predictions') {
	return app.request(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(body),
	})
}

describe('predictor API', () => {
	it('returns a healthy status', async () => {
		const response = await app.request('/api/health')

		expect(response.status).toBe(200)
		expect(await response.json()).toEqual({ status: 'ok' })
	})

	it('returns a deterministic single-drug prediction', async () => {
		const response = await post({
			...baseRequest,
			defendantRole: 'Actual trafficker',
			guiltyPlea: 'Plead guilty (earliest opportunity)',
			aggravatingFactors: ['Multiple Drugs'],
			mitigatingFactors: ['Assistance - useful'],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body).toMatchObject({
			status: 'supported',
			startingPointMonths: 60,
			startingPointYears: 5,
			finalSentenceMonths: 37.64,
			finalSentenceYears: 3.14,
		})
		expect(body.adjustments).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					factor: 'Actual trafficker',
					category: 'defendantRole',
					direction: 'increase',
				}),
				expect.objectContaining({
					factor: 'Plead guilty (earliest opportunity)',
					category: 'guiltyPlea',
					direction: 'decrease',
				}),
			]),
		)
	})

	it('applies plea and assistance reductions non-compounding from the notional sentence', async () => {
		const response = await post({
			...baseRequest,
			guiltyPlea: 'Plead guilty (first day of trial)',
			mitigatingFactors: ['Assistance - risk'],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.startingPointMonths).toBe(60)
		expect(body.finalSentenceMonths).toBe(28.5)
		expect(body.finalSentenceYears).toBe(2.38)
		const plea = body.adjustments.find(
			(adjustment: { factor: string }) =>
				adjustment.factor === 'Plead guilty (first day of trial)',
		)
		const assistance = body.adjustments.find(
			(adjustment: { factor: string }) => adjustment.factor === 'Assistance - risk',
		)
		expect(plea.months).toBe(12)
		expect(assistance.months).toBe(19.5)
		expect(plea.baseMonths).toBe(60)
		expect(assistance.baseMonths).toBe(60)
	})

	it('allows a null guiltyPlea with no plea reduction', async () => {
		const response = await post({
			...baseRequest,
			guiltyPlea: null,
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.status).toBe('supported')
		expect(body.startingPointMonths).toBe(60)
		expect(body.adjustments).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ category: 'guiltyPlea' }),
			]),
		)
	})

	it('allows an omitted guiltyPlea with no plea reduction', async () => {
		const { guiltyPlea: _guiltyPlea, ...withoutPlea } = baseRequest
		const response = await post(withoutPlea)
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.status).toBe('supported')
		expect(body.startingPointMonths).toBe(60)
		expect(body.adjustments).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ category: 'guiltyPlea' }),
			]),
		)
	})

	it('supports multiple drugs and Fluorodeschloroketamine', async () => {
		const response = await post({
			...baseRequest,
			drugs: [
				{ type: 'Fluorodeschloroketamine', quantity: 2 },
				{ type: 'Heroin', quantity: 1 },
			],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.startingPointMonths).toBe(31.16)
		expect(body.adjustments).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ factor: 'Multiple Drugs' }),
			]),
		)
	})

	it('only applies Multiple Drugs when explicitly requested', async () => {
		const response = await post({
			...baseRequest,
			drugs: [
				{ type: 'Cocaine', quantity: 10 },
				{ type: 'Heroin', quantity: 10 },
			],
			aggravatingFactors: ['Multiple Drugs'],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.adjustments).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					factor: 'Multiple Drugs',
					category: 'aggravating',
					direction: 'increase',
				}),
			]),
		)
	})

	it('defaults to the notional-weighted starting point', async () => {
		const response = await post({
			...baseRequest,
			drugs: [
				{ type: 'Cocaine', quantity: 500 },
				{ type: 'Methamphetamine', quantity: 10 },
			],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.startingPointMode).toBe('notional-weighted')
		expect(body.startingPointBreakdown).toBeNull()
		expect(body.startingPointMonths).toBe(192.73)
	})

	it('holds the starting point at the most serious drug in multi-drug-floor mode', async () => {
		const response = await post({
			...baseRequest,
			startingPointMode: 'multi-drug-floor',
			drugs: [
				{ type: 'Cocaine', quantity: 10 },
				{ type: 'Methamphetamine', quantity: 10 },
			],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.startingPointMode).toBe('multi-drug-floor')
		expect(body.startingPointMonths).toBe(84)
		expect(body.startingPointYears).toBe(7)
		expect(body.startingPointBreakdown).toMatchObject({
			mode: 'multi-drug-floor',
			baselineMonths: 84,
			provisionalMonths: 80.5,
			upliftMonths: 0,
		})
		expect(body.startingPointBreakdown.groups).toHaveLength(2)
		expect(body.startingPointBreakdown.groups[0]).toMatchObject({
			guidelineGroup: 'methamphetamine',
			family: 'Methamphetamine',
			drugTypes: ['Methamphetamine'],
			quantity: 10,
			startingPointMonths: 84,
		})
	})

	it('adds the multi-drug uplift when the combined sentence clears the baseline', async () => {
		const response = await post({
			...baseRequest,
			startingPointMode: 'multi-drug-floor',
			drugs: [
				{ type: 'Cocaine', quantity: 500 },
				{ type: 'Methamphetamine', quantity: 10 },
			],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.startingPointMonths).toBe(192.73)
		expect(body.startingPointBreakdown).toMatchObject({
			baselineMonths: 192,
			provisionalMonths: 192.73,
			upliftMonths: 0.73,
		})
	})

	it('keeps the rounded breakdown consistent with the starting point', async () => {
		// A sub-gram second drug lifts the raw starting point by ~0.002 months.
		// Rounding the raw uplift on its own would report 0 while the starting
		// point sits 0.01 above the baseline.
		const combos = [
			[
				{ type: 'Cocaine', quantity: 2500 },
				{ type: 'Ketamine', quantity: 0.5 },
			],
			[
				{ type: 'Cocaine', quantity: 10 },
				{ type: 'Methamphetamine', quantity: 10 },
			],
			[
				{ type: 'Cocaine', quantity: 500 },
				{ type: 'Methamphetamine', quantity: 10 },
			],
			[
				{ type: 'Heroin', quantity: 1200 },
				{ type: 'Cannabis/THC', quantity: 8000 },
			],
			[
				{ type: 'Midazolam', quantity: 2500 },
				{ type: 'Nimetazepam', quantity: 400 },
			],
		]

		for (const drugs of combos) {
			const response = await post({
				...baseRequest,
				startingPointMode: 'multi-drug-floor',
				drugs,
			})
			const body = await response.json()
			const breakdown = body.startingPointBreakdown

			expect(response.status).toBe(200)
			expect(
				breakdown.baselineMonths + breakdown.upliftMonths,
			).toBeCloseTo(body.startingPointMonths, 6)
			expect(breakdown.upliftMonths >= 0).toBe(true)
			// A zero uplift is exactly the case where the baseline binds.
			expect(breakdown.upliftMonths === 0).toBe(
				breakdown.baselineMonths === body.startingPointMonths,
			)
		}
	})

	it('reports a sub-cent uplift instead of rounding it to zero', async () => {
		const response = await post({
			...baseRequest,
			startingPointMode: 'multi-drug-floor',
			drugs: [
				{ type: 'Cocaine', quantity: 2500 },
				{ type: 'Ketamine', quantity: 0.5 },
			],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.startingPointBreakdown.baselineMonths).toBe(253.71)
		expect(body.startingPointBreakdown.upliftMonths).toBe(0.01)
		expect(body.startingPointMonths).toBe(253.72)
	})

	it('aggregates drugs that share a guideline group in multi-drug-floor mode', async () => {
		const response = await post({
			...baseRequest,
			startingPointMode: 'multi-drug-floor',
			drugs: [
				{ type: 'Cocaine', quantity: 300 },
				{ type: 'Heroin', quantity: 300 },
			],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.startingPointBreakdown.groups).toEqual([
			{
				guidelineGroup: 'cocaine-heroin',
				family: 'Cocaine',
				drugTypes: ['Cocaine', 'Heroin'],
				quantity: 600,
				startingPointMonths: 196.8,
			},
		])
	})

	it('leaves a single-drug prediction unchanged in multi-drug-floor mode', async () => {
		const floorResponse = await post({
			...baseRequest,
			startingPointMode: 'multi-drug-floor',
		})
		const weightedResponse = await post(baseRequest)
		const floor = await floorResponse.json()
		const weighted = await weightedResponse.json()

		expect(floor.startingPointMonths).toBe(60)
		expect(floor.finalSentenceMonths).toBe(weighted.finalSentenceMonths)
		expect(floor.adjustments).toEqual(weighted.adjustments)
	})

	it('rejects an unknown starting point mode', async () => {
		const response = await post({
			...baseRequest,
			startingPointMode: 'highest-drug',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({
			error: 'VALIDATION_ERROR',
		})
	})

	// it('supports Midazolam powder and rejects the tablet variant', async () => {
	// 	const powderResponse = await post({
	// 		...baseRequest,
	// 		drugs: [{ type: 'Midazolam', quantity: 2, variant: 'powder' }],
	// 	})
	// 	const tabletResponse = await post({
	// 		...baseRequest,
	// 		drugs: [{ type: 'Midazolam', quantity: 2, variant: 'tablet' }],
	// 	})

	// 	expect((await powderResponse.json()).startingPointMonths).toBe(0.02)
	// 	expect(tabletResponse.status).toBe(400)
	// })

	it('supports Midazolam using the powder guidelines', async () => {
		const response = await post({
			...baseRequest,
			drugs: [{ type: 'Midazolam', quantity: 2 }],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.startingPointMonths).toBe(0.02)
	})

	it('applies role and cross-border adjustments', async () => {
		const response = await post({
			...baseRequest,
			defendantRole: 'Courier / Storekeeper',
			additionalCircumstances: ['Cross-border trafficking'],
		})
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.finalSentenceMonths).toBe(63.53)
		expect(body.adjustments).toEqual(
			expect.arrayContaining([
			expect.objectContaining({
				factor: 'Courier / Storekeeper',
				months: 0,
			}),
			expect.objectContaining({
				factor: 'Cross-border trafficking',
				category: 'aggravating',
			}),
		]),
		)
	})

	it('accepts the starting point mode on the similar-cases endpoint', async () => {
		const response = await post(
			{
				...baseRequest,
				startingPointMode: 'multi-drug-floor',
			},
			'/api/similar-cases',
		)
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(Array.isArray(body)).toBe(true)
		expect(body.length).toBeGreaterThan(0)
	})

	it('returns JSON validation errors', async () => {
		const response = await post({
			...baseRequest,
			drugs: [{ type: 'Cocaine', quantity: 0 }],
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({
			error: 'VALIDATION_ERROR',
			fields: {
				'drugs.0.quantity': 'Too small: expected number to be >0',
			},
		})
	})

	it('rejects invalid drug types and negative quantities', async () => {
		const invalidTypeResponse = await post({
			...baseRequest,
			drugs: [{ type: 'Unknown', quantity: 1 }],
		})
		const negativeQuantityResponse = await post({
			...baseRequest,
			drugs: [{ type: 'Cocaine', quantity: -1 }],
		})

		expect(invalidTypeResponse.status).toBe(400)
		expect(negativeQuantityResponse.status).toBe(400)
	})

	// it('rejects invalid Midazolam and factor combinations', async () => {
	// 	const missingVariantResponse = await post({
	// 		...baseRequest,
	// 		drugs: [{ type: 'Midazolam', quantity: 2 }],
	// 	})
	// 	const nonMidazolamVariantResponse = await post({
	// 		...baseRequest,
	// 		drugs: [{ type: 'Cocaine', quantity: 2, variant: 'powder' }],
	// 	})
	// 	const assistanceResponse = await post({
	// 		...baseRequest,
	// 		mitigatingFactors: ['Assistance - limited', 'Assistance - useful'],
	// 	})
	// 	const duplicateFactorResponse = await post({
	// 		...baseRequest,
	// 		aggravatingFactors: ['On bail', 'On bail'],
	// 	})

	// 	expect(missingVariantResponse.status).toBe(400)
	// 	expect(nonMidazolamVariantResponse.status).toBe(400)
	// 	expect(assistanceResponse.status).toBe(400)
	// 	expect(duplicateFactorResponse.status).toBe(400)
	// })

	it('rejects unsupported circumstances without a role', async () => {
		const response = await post({
			...baseRequest,
			additionalCircumstances: ['Cross-border trafficking'],
		})

		expect(response.status).toBe(400)
	})

	it('rejects legacy circumstances and mitigating factors', async () => {
		const circumstanceResponse = await post({
			...baseRequest,
			defendantRole: 'Actual trafficker',
			additionalCircumstances: ['Divan keeping'],
		})
		const mitigatingFactorResponse = await post({
			...baseRequest,
			mitigatingFactors: ['Extreme youth'],
		})

		expect(circumstanceResponse.status).toBe(400)
		expect(mitigatingFactorResponse.status).toBe(400)
	})

	it('handles malformed JSON with a JSON error response', async () => {
		const response = await app.request('/api/sentence-predictions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: '{',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({
			error: 'VALIDATION_ERROR',
		})
	})

	it('returns a list of similar cases', async () => {
		const response = await post(baseRequest, '/api/similar-cases')
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(Array.isArray(body)).toBe(true)
		expect(body.length).toBeGreaterThan(0)
		expect(body.length).toBeLessThanOrEqual(10)
		for (const item of body) {
			expect(item).toMatchObject({
				neutralCitation: expect.any(String),
				title: expect.any(String),
				url: expect.any(String),
				score: expect.any(Number),
			})
			expect(item.score).toBeGreaterThanOrEqual(0.6)
			expect(item.score).toBeLessThanOrEqual(1)
		}
		for (let i = 1; i < body.length; i++) {
			expect(body[i].score).toBeLessThanOrEqual(body[i - 1].score)
		}
	})

	it('ranks multi-drug similar cases by drug profile, not coincidental sentence length', async () => {
		const response = await post(
			{
				drugs: [
					{ type: 'Cocaine', quantity: 50 },
					{ type: 'Heroin', quantity: 50 },
				],
				guiltyPlea: 'Plead not guilty',
				aggravatingFactors: [],
				mitigatingFactors: [],
			},
			'/api/similar-cases',
		)
		const body = await response.json()

		expect(response.status).toBe(200)
		expect(body.length).toBeGreaterThan(0)
		for (const item of body) {
			expect(item.neutralCitation).not.toBe('[2025] HKCFI 6413')
		}
	})

	it('validates the similar-cases request body', async () => {
		const response = await post(
			{ drugs: [{ type: 'Unknown', quantity: 1 }], guiltyPlea: 'Plead not guilty' },
			'/api/similar-cases',
		)

		expect(response.status).toBe(400)
		expect(await response.json()).toMatchObject({
			error: 'VALIDATION_ERROR',
		})
	})
})
