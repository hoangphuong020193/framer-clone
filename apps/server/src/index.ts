import express from 'express'

const app = express()
const port = process.env.PORT ? Number(process.env.PORT) : 3001

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
