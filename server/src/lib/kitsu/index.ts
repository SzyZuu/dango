export {
  kitsuBatchGetStatuses,
  kitsuEpisodes,
  kitsuLatestReleases,
  kitsuMetaByAnilistId,
  kitsuMetaByMalId,
  kitsuSearchAnime,
  kitsuSeasonal,
  kitsuSpotlight,
  kitsuTrending,
  kitsuTitlesByMalIds,
  type KitsuSearchOptions,
  type KitsuTitles,
} from './queries.js'
export { dedupeKitsuMedia, normalizeKitsuEntry } from './normalize.js'
