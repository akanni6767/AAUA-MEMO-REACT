import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.js'

let client

export function getSql() {
  if (!process.env.DATABASE_URL && process.loadEnvFile) {
    try { process.loadEnvFile('.env') } catch (_) {}
  }
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  if (!client) {
    const url = new URL(process.env.DATABASE_URL)
    url.searchParams.delete('channel_binding')
    client = postgres(url.toString(), { ssl: 'require', max: 8 })
  }
  return client
}

export function getDb() {
  return drizzle(getSql(), { schema })
}
