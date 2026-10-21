import { sql } from 'drizzle-orm'
import { DatabaseWrapper } from '../db.js'
import { getDrizzle } from '../db/drizzle.js'

export type ProgressRepo<Row> = {
  getByKey: (db: DatabaseWrapper, key: string) => Row[] | Promise<Row[]>
  getLatest: (db: DatabaseWrapper, key: string) => Row | undefined | Promise<Row | undefined>
  deleteByKey: (db: DatabaseWrapper, key: string) => unknown
  deleteMany: (db: DatabaseWrapper, keys: string[]) => unknown
}

export type ProgressRepoConfig = {
  table: string
  keyCol: string
  columns: string
}

export function makeProgressRepo<Row>(config: ProgressRepoConfig): ProgressRepo<Row> {
  const table = sql.raw(`"${config.table}"`)
  const keyCol = sql.raw(config.keyCol)
  const columns = sql.raw(config.columns)

  return {
    getByKey: (db: DatabaseWrapper, key: string) =>
      getDrizzle(db).all<Row>(
        sql`SELECT ${columns} FROM ${table} WHERE ${keyCol} = ${key} ORDER BY updatedAt DESC, rowid DESC`
      ),

    getLatest: (db: DatabaseWrapper, key: string) =>
      getDrizzle(db).all<Row>(
        sql`SELECT ${columns} FROM ${table} WHERE ${keyCol} = ${key} ORDER BY updatedAt DESC, rowid DESC LIMIT 1`
      )[0],

    deleteByKey: (db: DatabaseWrapper, key: string) =>
      getDrizzle(db).run(sql`DELETE FROM ${table} WHERE ${keyCol} = ${key}`),

    deleteMany: (db: DatabaseWrapper, keys: string[]) => {
      if (keys.length === 0) return Promise.resolve()
      return getDrizzle(db).run(
        sql`DELETE FROM ${table} WHERE ${keyCol} IN (${sql.join(
          keys.map((key) => sql`${key}`),
          sql`, `
        )})`
      )
    },
  }
}
