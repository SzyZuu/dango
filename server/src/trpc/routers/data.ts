import { mergeRouters } from '../index.js'
import { dataCatalogRouter } from './data-catalog.js'
import { dataMatureRouter } from './data-mature.js'
import { dataPlayerRouter } from './data-player.js'

export const dataRouter = mergeRouters(dataCatalogRouter, dataPlayerRouter, dataMatureRouter)
