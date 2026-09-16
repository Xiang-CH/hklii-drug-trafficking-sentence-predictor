import { describe, expect, it } from 'vitest'
import {
	predictMultiDrugFloorStartingPoint,
	predictNotionalWeightedMonths,
	predictStartingPointMonths,
} from './guidelineModel.js'

const COCAINE_HEROIN_EQUIVALENT = [1, 5, 10, 40, 300, 900, 4000, 20000, 50000]
const KETAMINE_ECSTASY_NIMETAZEPAM_EQUIVALENT = [0.5, 2, 20, 150, 450, 800, 1500, 2500, 9000]

describe('guideline groups', () => {
	it('sentences cocaine and heroin on the same table', () => {
		for (const quantity of COCAINE_HEROIN_EQUIVALENT) {
			expect(predictStartingPointMonths('Heroin', quantity)).toBe(
				predictStartingPointMonths('Cocaine', quantity),
			)
		}
	})

	it('sentences ketamine, ecstasy and nimetazepam on the same table', () => {
		for (const quantity of KETAMINE_ECSTASY_NIMETAZEPAM_EQUIVALENT) {
			const ketamine = predictStartingPointMonths('Ketamine', quantity)
			expect(predictStartingPointMonths('Ecstasy', quantity)).toBe(ketamine)
			expect(predictStartingPointMonths('Nimetazepam', quantity)).toBe(ketamine)
		}
	})

	it('aggregates a shared guideline group into one baseline group', () => {
		const result = predictMultiDrugFloorStartingPoint([
			{ type: 'Cocaine', quantity: 300 },
			{ type: 'Heroin', quantity: 300 },
		])

		expect(result).not.toBeNull()
		expect(result?.groups).toHaveLength(1)
		expect(result?.groups[0]).toMatchObject({
			group: 'cocaine-heroin',
			family: 'Cocaine',
			drugTypes: ['Cocaine', 'Heroin'],
			quantity: 600,
			months: 196.8,
		})
		expect(result?.baselineMonths).toBe(196.8)
	})

	it('aggregates different drugs of one group before reading the table', () => {
		// Four separate gram entries of the same guideline group must be treated
		// as 10 grams, not as four sub-gram sentences.
		const aggregated = predictMultiDrugFloorStartingPoint([
			{ type: 'Cocaine', quantity: 5 },
			{ type: 'Heroin', quantity: 5 },
			{ type: 'Midazolam', quantity: 100 },
		])

		expect(aggregated?.groups.map((group) => group.quantity)).toEqual([10, 100])
		expect(aggregated?.baselineMonths).toBe(60)
		expect(aggregated?.startingPointMonths).toBe(60)
	})
})

describe('multi-drug floor starting point', () => {
	it('leaves a single drug unchanged', () => {
		const drugs = [{ type: 'Cocaine', quantity: 10 }]
		const floor = predictMultiDrugFloorStartingPoint(drugs)

		expect(floor?.startingPointMonths).toBe(predictNotionalWeightedMonths(drugs))
		expect(floor?.startingPointMonths).toBe(60)
		expect(floor?.upliftMonths).toBe(0)
	})

	it('never falls below the most serious single drug', () => {
		const floor = predictMultiDrugFloorStartingPoint([
			{ type: 'Cocaine', quantity: 10 },
			{ type: 'Methamphetamine', quantity: 10 },
		])

		// The notional-weighted sentence (80.5) is below the 84-month
		// methamphetamine sentence, so the baseline binds and no uplift applies.
		expect(floor?.provisionalMonths).toBeCloseTo(80.5, 10)
		expect(floor?.baselineMonths).toBe(84)
		expect(floor?.upliftMonths).toBe(0)
		expect(floor?.startingPointMonths).toBe(84)
	})

	it('adds the uplift when the combined sentence clears the baseline', () => {
		const floor = predictMultiDrugFloorStartingPoint([
			{ type: 'Cocaine', quantity: 500 },
			{ type: 'Methamphetamine', quantity: 10 },
		])

		expect(floor?.baselineMonths).toBe(192)
		expect(floor?.provisionalMonths).toBeCloseTo(192.72941176470587, 10)
		expect(floor?.upliftMonths).toBeCloseTo(0.72941176470587, 10)
		expect(floor?.startingPointMonths).toBeCloseTo(192.72941176470587, 10)
	})

	it('never reduces the notional-weighted starting point', () => {
		const cases = [
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
				{ type: 'Ketamine', quantity: 30 },
				{ type: 'Cannabis/THC', quantity: 8000 },
			],
			[
				{ type: 'Fluorodeschloroketamine', quantity: 2 },
				{ type: 'Heroin', quantity: 1 },
			],
			[
				{ type: 'Midazolam', quantity: 2500 },
				{ type: 'Nimetazepam', quantity: 400 },
				{ type: 'Ecstasy', quantity: 60 },
			],
		]

		for (const drugs of cases) {
			const floor = predictMultiDrugFloorStartingPoint(drugs)
			const weighted = predictNotionalWeightedMonths(drugs)

			expect(floor).not.toBeNull()
			expect(weighted).not.toBeNull()
			expect(floor?.startingPointMonths).toBeGreaterThanOrEqual(
				weighted as number,
			)
			const highestGroup = Math.max(
				...(floor?.groups ?? []).map((group) => group.months),
			)
			expect(floor?.baselineMonths).toBe(highestGroup)
			expect(floor?.startingPointMonths).toBeGreaterThanOrEqual(highestGroup)
		}
	})

	it('reports no uplift when the baseline absorbs the additional drugs', () => {
		const floor = predictMultiDrugFloorStartingPoint([
			{ type: 'Cocaine', quantity: 5 },
			{ type: 'Heroin', quantity: 5 },
			{ type: 'Midazolam', quantity: 100 },
		])

		expect(floor?.upliftMonths).toBe(0)
		expect(floor?.startingPointMonths).toBe(floor?.baselineMonths)
	})

	it('returns null when any drug has no guideline', () => {
		expect(
			predictMultiDrugFloorStartingPoint([
				{ type: 'Cocaine', quantity: 10 },
				{ type: 'Unknown', quantity: 1 },
			]),
		).toBeNull()
	})

	it('orders groups from most to least serious', () => {
		const floor = predictMultiDrugFloorStartingPoint([
			{ type: 'Cocaine', quantity: 10 },
			{ type: 'Methamphetamine', quantity: 10 },
			{ type: 'Midazolam', quantity: 100 },
		])

		const months = (floor?.groups ?? []).map((group) => group.months)
		expect(months).toEqual([...months].sort((left, right) => right - left))
	})
})
