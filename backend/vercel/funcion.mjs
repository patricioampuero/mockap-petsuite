// Función de Vercel: el API sobre PostgreSQL de backend/api. La empaqueta construir.mjs.
import { ApiError } from '../../src/shared/errors.ts'
import { pgDatabase } from '../api/db.ts'
import { createApi } from '../api/index.ts'
import { crearAtencion } from '../http.mjs'
import { direccionApp, origenes, rutaOriginal } from './rutas.mjs'

const app = direccionApp(process.env)
if (app) process.env.APP_URL = app

// Pocas conexiones: cada instancia abre las suyas contra el pooler de Supabase.
const atender = crearAtencion({ handle: createApi(pgDatabase(process.env.DATABASE_URL, 3)), ApiError, origins: origenes(process.env) })

export default (req, res) => {
  req.url = rutaOriginal(req.url)
  return atender(req, res)
}
