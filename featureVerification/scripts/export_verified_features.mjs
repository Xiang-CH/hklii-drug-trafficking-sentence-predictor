import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '../..')
const envFile = path.join(repositoryRoot, 'featureVerification', '.env.local')
const outputPath = path.resolve(
	process.argv[2] ?? path.join(repositoryRoot, 'verified-features.xlsx'),
)

process.loadEnvFile(envFile)

const projectRequire = createRequire(
	path.join(repositoryRoot, 'featureVerification', 'package.json'),
)
const { MongoClient, ObjectId } = projectRequire('mongodb')
const artifactToolRequire = createRequire(
	path.join(
		process.env.ARTIFACT_TOOL_SEARCH_DIR ?? repositoryRoot,
		'package.json',
	),
)
const artifactToolUrl = pathToFileURL(
	artifactToolRequire.resolve('@oai/artifact-tool'),
).href
const { SpreadsheetFile, Workbook } = await import(artifactToolUrl)
const mongoUri = process.env.DB_MONGODB_URI
const databaseName = process.env.DB_NAME || 'drug-sentencing-predictor'

if (!mongoUri) {
	throw new Error(`DB_MONGODB_URI is missing from ${envFile}`)
}

const client = new MongoClient(mongoUri, {
	appName: 'Drug Sentencing Verified Features Export',
})

function isExpandableObject(value) {
	return (
		value !== null &&
		typeof value === 'object' &&
		!Array.isArray(value) &&
		!(value instanceof Date) &&
		!(value instanceof ObjectId) &&
		!value._bsontype
	)
}

function cleanXmlText(value) {
	let cleaned = ''
	for (const character of value) {
		const codePoint = character.codePointAt(0)
		const isAllowed =
			codePoint === 0x09 ||
			codePoint === 0x0a ||
			codePoint === 0x0d ||
			(codePoint >= 0x20 && codePoint <= 0xd7ff) ||
			(codePoint >= 0xe000 && codePoint <= 0xfffd) ||
			(codePoint >= 0x10000 && codePoint <= 0x10ffff)
		cleaned += isAllowed
			? character
			: `\\u${codePoint.toString(16).padStart(4, '0')}`
	}
	return cleaned
}

function makeJsonSafe(value) {
	if (value instanceof ObjectId) return value.toHexString()
	if (value instanceof Date) return value.toISOString()
	if (typeof value === 'string') return cleanXmlText(value)
	if (Array.isArray(value)) return value.map(makeJsonSafe)
	if (isExpandableObject(value)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, nestedValue]) => [
				key,
				makeJsonSafe(nestedValue),
			]),
		)
	}
	if (value && typeof value === 'object' && value._bsontype) {
		return value.toString()
	}
	return value
}

function toCellValue(value) {
	if (value === undefined || value === null) return null
	if (value instanceof ObjectId) return value.toHexString()
	if (value instanceof Date) return value
	if (Array.isArray(value)) return JSON.stringify(makeJsonSafe(value))
	if (isExpandableObject(value)) return JSON.stringify(makeJsonSafe(value))
	if (typeof value === 'string') {
		const cleaned = cleanXmlText(value)
		return cleaned.startsWith('=') ? `'${cleaned}` : cleaned
	}
	if (typeof value === 'object' && value._bsontype) return value.toString()
	return value
}

const weekdayNames = [
	null,
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday',
	'Sunday',
]

function parseIsoDate(value) {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return value
	}
	const [year, month, day] = value.split('-').map(Number)
	return new Date(Date.UTC(year, month - 1, day))
}

function offenceDateValue(value) {
	if (Array.isArray(value)) {
		return value
			.map((date) => {
				const parsedDate = parseIsoDate(date)
				return parsedDate instanceof Date
					? new Intl.DateTimeFormat('en-GB', {
							day: '2-digit',
							month: 'short',
							year: 'numeric',
							timeZone: 'UTC',
						}).format(parsedDate)
					: parsedDate
			})
			.join(' to ')
	}
	return parseIsoDate(value)
}

function weekdayValue(value) {
	const values = Array.isArray(value) ? value : [value]
	return values
		.map((day) => weekdayNames[day] ?? day)
		.join(', ')
}

function flattenObject(value, prefix = '', output = {}) {
	if (!isExpandableObject(value)) return output

	for (const [key, nestedValue] of Object.entries(value)) {
		const column = prefix ? `${prefix}.${key}` : key

		if (nestedValue === undefined || nestedValue === null) continue
		if (isExpandableObject(nestedValue)) {
			flattenObject(nestedValue, column, output)
		} else if (column === 'offence_date.date') {
			output[column] = offenceDateValue(nestedValue)
		} else if (column === 'offence_date.day_of_week') {
			output[column] = weekdayValue(nestedValue)
		} else if (column === 'offence_time.time') {
			output[column] =
				typeof nestedValue === 'string'
					? nestedValue.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '')
					: toCellValue(nestedValue)
		} else {
			output[column] = toCellValue(nestedValue)
		}
	}

	return output
}

function idString(value) {
	if (value instanceof ObjectId) return value.toHexString()
	if (value === undefined || value === null) return null
	return String(value)
}

function recordMetadata(document) {
	return {
		verified_feature_id: idString(document._id),
		source_judgement_id: idString(document.source_judgement_id),
		source_llm_extraction_id: idString(document.source_llm_extraction_id),
		is_verified: document.is_verified === true,
		exclude: document.exclude ?? null,
		remarks: document.remarks ?? null,
		created_at: document.created_at ?? document.createdAt ?? null,
		created_by: idString(document.created_by ?? document.createdBy),
		updated_at: document.updated_at ?? document.updatedAt ?? null,
		verified_at: document.verified_at ?? document.verifiedAt ?? null,
		verified_by: idString(document.verified_by ?? document.verifiedBy),
	}
}

function relationshipMetadata(document) {
	return {
		verified_feature_id: idString(document._id),
		source_judgement_id: idString(document.source_judgement_id),
		is_verified: document.is_verified === true,
		exclude: document.exclude ?? null,
	}
}

function columnName(index) {
	let value = index + 1
	let name = ''
	while (value > 0) {
		const remainder = (value - 1) % 26
		name = String.fromCharCode(65 + remainder) + name
		value = Math.floor((value - 1) / 26)
	}
	return name
}

function rowsToMatrix(rows, fallbackHeaders) {
	const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))]
	const finalHeaders = headers.length ? headers : fallbackHeaders
	return {
		headers: finalHeaders,
		values: [
			finalHeaders,
			...rows.map((row) => finalHeaders.map((header) => row[header] ?? null)),
		],
	}
}

function addSheet(workbook, name, rows, tableName) {
	const sheet = workbook.worksheets.add(name)
	sheet.showGridLines = false
	sheet.freezePanes.freezeRows(1)

	const { headers, values } = rowsToMatrix(rows, [
		'verified_feature_id',
	'source_judgement_id',
	])
	const lastRow = values.length
	const lastColumn = columnName(headers.length - 1)
	const usedRange = sheet.getRange(`A1:${lastColumn}${lastRow}`)
	usedRange.values = values
	usedRange.format.font = { name: 'Arial', size: 10, color: '#1F2937' }
	usedRange.format.verticalAlignment = 'center'
	usedRange.format.wrapText = false

	const headerRange = sheet.getRange(`A1:${lastColumn}1`)
	headerRange.format = {
		fill: '#24476B',
		font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' },
		horizontalAlignment: 'center',
		verticalAlignment: 'center',
		wrapText: true,
	}
	headerRange.format.rowHeight = 30

	for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
		const header = headers[columnIndex]
		const columnRange = sheet.getRange(
			`${columnName(columnIndex)}1:${columnName(columnIndex)}${lastRow}`,
		)
		const width =
			header === 'verified_feature_id' || header.endsWith('_id')
				? 26
				: /source|remarks|json|\.address|\.name/.test(header)
					? 36
					: /date|_at$/.test(header)
						? 21
						: 18
		columnRange.format.columnWidth = width

		if (/(^|[._])date$/.test(header)) {
			columnRange.format.numberFormat = 'dd mmm yyyy'
		} else if (/_at$/.test(header)) {
			columnRange.format.numberFormat = 'yyyy-mm-dd hh:mm:ss'
		}
	}

	if (rows.length > 0) {
		sheet.tables.add(`A1:${lastColumn}${lastRow}`, true, tableName)
		const bodyRange = sheet.getRange(`A2:${lastColumn}${lastRow}`)
		bodyRange.format.wrapText = false
		bodyRange.format.rowHeight = 20
	}

	return { sheet, headers, rows: rows.length }
}

await client.connect()

let documents
try {
	const collection = client.db(databaseName).collection('verified-features')
	documents = await collection
		.find({ is_verified: true })
		.sort({ source_judgement_id: 1, _id: 1 })
		.toArray()
} finally {
	await client.close()
}

const judgments = []
const charges = []
const chargeDefendants = []
const defendants = []
const trials = []

for (const document of documents) {
	const metadata = recordMetadata(document)
	const judgement = document.judgement ?? {}
	const { charges: documentCharges = [], ...judgementFields } = judgement
	judgments.push({ ...metadata, ...flattenObject(judgementFields) })

	for (let chargeIndex = 0; chargeIndex < documentCharges.length; chargeIndex += 1) {
		const charge = documentCharges[chargeIndex] ?? {}
		const {
			defendants_of_charge: defendantsForCharge = [],
			...chargeFields
		} = charge
		charges.push({
			...relationshipMetadata(document),
			charge_index: chargeIndex + 1,
			charge_no: charge.charge_no ?? null,
			...flattenObject(chargeFields),
		})

		for (
			let relationshipIndex = 0;
			relationshipIndex < defendantsForCharge.length;
			relationshipIndex += 1
		) {
			chargeDefendants.push({
				...relationshipMetadata(document),
				charge_index: chargeIndex + 1,
				charge_no: charge.charge_no ?? null,
				relationship_index: relationshipIndex + 1,
				...flattenObject(defendantsForCharge[relationshipIndex]),
			})
		}
	}

	const defendantProfiles = document.defendants?.defendants ?? []
	for (let defendantIndex = 0; defendantIndex < defendantProfiles.length; defendantIndex += 1) {
		defendants.push({
			...relationshipMetadata(document),
			defendant_index: defendantIndex + 1,
			...flattenObject(defendantProfiles[defendantIndex]),
		})
	}

	const trialEntries = document.trials?.trials ?? []
	for (let trialIndex = 0; trialIndex < trialEntries.length; trialIndex += 1) {
		trials.push({
			...relationshipMetadata(document),
			trial_index: trialIndex + 1,
			charge_no: trialEntries[trialIndex]?.charge_type?.charge_no ?? null,
			defendant_id: trialEntries[trialIndex]?.charge_type?.defendant_id ?? null,
			...flattenObject(trialEntries[trialIndex]),
		})
	}
}

const workbook = Workbook.create()
const sheetSummaries = [
	addSheet(workbook, 'judgments', judgments, 'JudgmentsTable'),
	addSheet(workbook, 'charges', charges, 'ChargesTable'),
	addSheet(workbook, 'charge_defendants', chargeDefendants, 'ChargeDefendantsTable'),
	addSheet(workbook, 'defendants', defendants, 'DefendantsTable'),
	addSheet(workbook, 'trials', trials, 'TrialsTable'),
]

workbook.recalculate()

const previewDirectory = path.join(os.tmpdir(), 'verified-features-export-preview')
await fs.mkdir(previewDirectory, { recursive: true })
const renderFailures = []

if (process.env.SKIP_PREVIEW !== '1') {
	for (const { sheet } of sheetSummaries) {
		try {
			const preview = await workbook.render({
				sheetName: sheet.name,
				range: 'A1:H12',
				scale: 1,
				format: 'png',
			})
			await fs.writeFile(
				path.join(previewDirectory, `${sheet.name}.png`),
				new Uint8Array(await preview.arrayBuffer()),
			)
		} catch (error) {
			renderFailures.push({
				sheet: sheet.name,
				message: String(error?.message ?? error).slice(0, 300),
			})
			break
		}
	}
}

await fs.mkdir(path.dirname(outputPath), { recursive: true })
const output = await SpreadsheetFile.exportXlsx(workbook)
await output.save(outputPath)
await fs.rm(`${outputPath}.inspect.ndjson`, { force: true })

console.log(
	JSON.stringify({
		database: databaseName,
		filter: { is_verified: true },
		records: documents.length,
		sheets: sheetSummaries.map(({ sheet, rows }) => ({
			name: sheet.name,
			rows,
		})),
		renderFailures,
		outputPath,
	}),
)
