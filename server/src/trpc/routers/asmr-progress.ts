import { router, protectedProcedure } from '../index.js'
import { performAsmrWriteTransactionAsync } from '../../db/transaction.js'
import { adultNonListIds } from '../../utils/db-utils.js'
import type { DatabaseWrapper } from '../../db.js'
import {
  AsmrLibraryRepository,
  AsmrProgressRepository,
  type AsmrContinueListeningRow,
  type AsmrProgressRow,
} from '../../repositories/asmr.repository.js'
import { createProgressRouter } from './progress-factory.js'
import { defineSchema, idFieldInput, reqObj, reqStr, strOrNull } from '../validation.js'

const getAdultNonListWorkIds = (db: DatabaseWrapper) =>
  adultNonListIds(
    db,
    'asmr_progress',
    'asmr_library',
    'workId',
    'COALESCE(l.isAdult, p.isAdult) = 1'
  )

export type AsmrProgressWorkInput = { workId: string }

const asmrProgressWorkInput = () => idFieldInput('workId')

export type AsmrProgressSaveInput = {
  workId: string
  trackIndex?: unknown
  trackLabel?: unknown
  currentTime?: unknown
  duration?: unknown
  title?: string | null
  thumbnail?: string | null
  rjCode?: string | null
  isAdult?: unknown
}

const asmrProgressSaveInput = () =>
  defineSchema<AsmrProgressSaveInput, AsmrProgressSaveInput>((value) => {
    const obj = reqObj(value)
    return {
      workId: reqStr(obj, 'workId'),
      trackIndex: obj.trackIndex,
      trackLabel: obj.trackLabel,
      currentTime: obj.currentTime,
      duration: obj.duration,
      title: strOrNull(obj, 'title'),
      thumbnail: strOrNull(obj, 'thumbnail'),
      rjCode: strOrNull(obj, 'rjCode'),
      isAdult: obj.isAdult ?? null,
    }
  })

export type AsmrProgressRemoveInput = { workId: string; trackIndex?: unknown }

const asmrProgressRemoveInput = () =>
  defineSchema<AsmrProgressRemoveInput, AsmrProgressRemoveInput>((value) => {
    const obj = reqObj(value)
    return { workId: reqStr(obj, 'workId'), trackIndex: obj.trackIndex ?? undefined }
  })

const shared = createProgressRouter<
  AsmrProgressRow,
  AsmrContinueListeningRow,
  AsmrProgressWorkInput,
  AsmrProgressRemoveInput
>({
  db: (ctx) => ctx.asmrDb,
  write: performAsmrWriteTransactionAsync,
  repo: AsmrProgressRepository,
  keyField: 'workId',
  byKeyInput: asmrProgressWorkInput(),
  removeInput: asmrProgressRemoveInput(),
  removeOne: (db, key, input) => {
    if (input.trackIndex === undefined || input.trackIndex === null) return false
    AsmrProgressRepository.deleteTrack(db, key, Number(input.trackIndex))
    return true
  },
  continueRows: (db, limit) => AsmrProgressRepository.getContinueListening(db, limit),
  continueSettings: { ignoreAdult: 'asmrIgnoreAdultContent', listOnly: 'asmrCwWatchlistOnly' },
  isAdult: (row) => row.isAdult === 1,
  watchlistStatus: 'Listening',
  adultIds: getAdultNonListWorkIds,
})

export const asmrProgressRouter = router({
  getByWork: shared.byKey,

  save: protectedProcedure.input(asmrProgressSaveInput()).mutation(async ({ ctx, input }) => {
    const trackIndexNum = Math.max(Math.round(Number(input.trackIndex)) || 0, 0)
    const timeNum = Math.max(Number(input.currentTime) || 0, 0)
    const durationNum = Math.max(Number(input.duration) || 0, 0)
    await performAsmrWriteTransactionAsync(ctx.asmrDb, async (tx) => {
      await AsmrProgressRepository.upsert(tx, {
        workId: String(input.workId),
        trackIndex: trackIndexNum,
        trackLabel: String(input.trackLabel || ''),
        currentTime: timeNum,
        duration: durationNum,
        title: input.title ?? null,
        thumbnail: input.thumbnail ?? null,
        rjCode: input.rjCode ?? null,
        isAdult: input.isAdult != null ? Number(input.isAdult) : null,
      })
      await AsmrLibraryRepository.touchProgress(tx, String(input.workId), {
        trackIndex: trackIndexNum,
        trackLabel: String(input.trackLabel || ''),
        position: timeNum,
      })
    })
    return { success: true }
  }),

  remove: shared.remove,
  removeMany: shared.removeMany,
  continueListening: shared.continue,
  adultCount: shared.adultCount,
  purgeAdult: shared.purgeAdult,
})
