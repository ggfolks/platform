import {Source} from "../core/react"
import {NoopRemover, Remover} from "../core/util"
import {ModelKey, ModelProvider} from "./model"
import {Element, ElementConfig, ElementContext} from "./element"
import {Spec} from "./style"
import {AxisConfig, HGroup, VGroup} from "./group"

/** Base interface for list-like elements. */
export interface AbstractListConfig extends AxisConfig {
  element :ElementConfig
  data :Spec<ModelProvider>
  keys :Spec<Source<ModelKey[]>>
}


/** Defines configuration for [[HList]] elements. */
export interface HListConfig extends AbstractListConfig {
  type :"hlist"
}

/** Interface used by list-like elements. */
export interface AbstractList {
  elements :Map<ModelKey, Element>
  contents :Element[]
}

/** An hlist displays a dynamic list of elements, each instantiated from a sub-model and a list
  * element template. The elements are arrayed along a horizontal axis like a [[Row]]. */
export class HList extends HGroup implements AbstractList {
  readonly elements = new Map<ModelKey,Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :HListConfig) {
    super(ctx, parent, config)
    this.disposer.add(syncListContents(ctx, this))
  }
}

/** Defines configuration for [[VList]] elements. */
export interface VListConfig extends AbstractListConfig {
  type :"vlist"
}

/** A vlist displays a dynamic list of elements, each instantiated from a sub-model and a list
  * element template. The elements are arrayed along a vertical axis like a [[Column]]. */
export class VList extends VGroup implements AbstractList {
  readonly elements = new Map<ModelKey,Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :VListConfig) {
    super(ctx, parent, config)
    this.disposer.add(syncListContents(ctx, this))
  }
}

/** Synchronizes a list's contents with its data source. */
export function syncListContents (ctx :ElementContext, list :Element & AbstractList) :Remover {
  const config = list.config as AbstractListConfig
  const keys = ctx.model.resolveOpt(config.keys)
  const data = ctx.model.resolveOpt(config.data)
  if (!(keys && data)) return NoopRemover
  return keys.onValue(keys => {
    const {contents, elements} = list
    // first dispose no longer used elements
    const kset = new Set(keys)
    for (const [ekey, elem] of elements) {
      if (!kset.has(ekey)) {
        elements.delete(ekey)
        elem.dispose()
      }
    }
    // now create/reuse elements for the new keys
    contents.length = 0
    for (const key of keys) {
      let elem = elements.get(key)
      if (!elem) {
        elem = ctx.elem.create({...ctx, model: data.resolve(key)}, list, config.element)
        list.elements.set(key, elem)
      }
      contents.push(elem)
    }
    list.invalidate()
  })
}
