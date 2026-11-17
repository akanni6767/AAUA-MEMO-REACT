export { default } from '../../src/server/vercel.js'

export const config = {
  api: { bodyParser: false },
  maxDuration: 30,
}
