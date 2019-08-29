import {Source} from "../core/react"
import {Remover} from "../core/util"
import {ModelKey, ModelProvider} from "./model"
import {Element, ElementConfig, ElementContext} from "./element"
import {Spec} from "./style"
import {AxisConfig, VGroup} from "./group"

/** Base interface for list-like elements. */
export interface AbstractListConfig extends AxisConfig {
  element :ElementConfig
  data :Spec<ModelProvider>
  keys :Spec<Source<ModelKey[]>>
}

/** Defines configuration for [[List]] elements. */
export interface ListConfig extends AbstractListConfig {
  type :"list"
}

/** Interface used by list-like elements. */
export interface AbstractList {
  elements :Map<ModelKey, Element>
  contents :Element[]
}

/** A list displays a dynamic list of elements, each instantiated from a sub-model and a list
  * element template. The elements are arrayed along a vertical axis like a [[Group]]. */
export class List extends VGroup implements AbstractList {
  readonly elements = new Map<ModelKey,Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :ListConfig) {
    super(ctx, parent, config)
    this.disposer.add(syncListContents(ctx, this))
  }

  /** Returns the element associated with the given key, if any. */
  getElement (key :ModelKey) {
    return this.elements.get(key)
  }
}

/** Synchronizes a list's contents with its data source. */
export function syncListContents (ctx :ElementContext, list :Element & AbstractList) :Remover {
  const config = list.config as AbstractListConfig
  const data = ctx.model.resolve(config.data)
  return ctx.model.resolve(config.keys).onValue(keys => {
    const {contents, elements} = list
    // first dispose no longer used elements
    const kset = new Set(keys)
    for (const [ekey, elem] of elements) {
      if (!kset.has(ekey)) elem.dispose()
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
