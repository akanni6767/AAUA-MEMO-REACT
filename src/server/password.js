import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = (await scryptAsync(password, salt, 32)).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export async function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false
  const [, salt, hex] = stored.split('$')
  if (!salt || !hex) return false
  const hash = await scryptAsync(password, salt, 32)
  const left = Buffer.from(hex, 'hex')
  if (left.length !== hash.length) return false
  return timingSafeEqual(left, hash)
}
