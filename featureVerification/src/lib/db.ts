import mongoClient from './mongodb'

const client = mongoClient
const db = client.db(process.env.DB_NAME || 'drug-sentencing-predictor')

export { client, db }
