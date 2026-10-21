import { router } from '../index.js'
import { performAsmrWriteTransactionAsync } from '../../db/transaction.js'
import {
  buildAsmrId,
  ASMR_STATUSES,
  AsmrLibraryRepository,
  AsmrProgressRepository,
} from '../../repositories/asmr.repository.js'
import { createLibraryRouter } from './library-factory.js'
import { defineSchema, optStr, reqObj } from '../validation.js'
import { badRequest } from '../errors.js'

export type AsmrLibraryAddInput = {
  rjCode?: string
  id?: string
  title?: string
  thumbnail?: string
  status?: string
  isAdult?: unknown
}

const asmrLibraryAddInput = () =>
  defineSchema<AsmrLibraryAddInput, AsmrLibraryAddInput>((value) => {
    const obj = reqObj(value)
    return {
      rjCode: optStr(obj, 'rjCode'),
      id: optStr(obj, 'id'),
      title: optStr(obj, 'title'),
      thumbnail: optStr(obj, 'thumbnail'),
      status: optStr(obj, 'status'),
      isAdult: obj.isAdult,
    }
  })

export const asmrLibraryRouter = router(
  createLibraryRouter({
    db: (ctx) => ctx.asmrDb,
    write: performAsmrWriteTransactionAsync,
    repo: AsmrLibraryRepository,
    progress: {
      deleteByKey: (db, id) => AsmrProgressRepository.deleteByKey(db, id),
      deleteMany: (db, ids) => AsmrProgressRepository.deleteMany(db, ids),
    },
    statuses: ASMR_STATUSES,
    defaultStatus: 'Listening',
    add: {
      input: asmrLibraryAddInput(),
      build: (input, status) => {
        const rawCode = String(input.rjCode || input.id || '').trim()
        if (!rawCode) {
          throw badRequest('rjCode is required')
        }
        const id = input.id && input.id.trim() ? buildAsmrId(input.id) : buildAsmrId(rawCode)
        return {
          id,
          row: {
            id,
            rjCode: buildAsmrId(rawCode),
            title: String(input.title || ''),
            thumbnail: String(input.thumbnail || ''),
            status,
            isAdult: input.isAdult === true || input.isAdult === 1,
          },
        }
      },
    },
  })
)
