import {Source} from "../core/react"
import {ModelKey, ModelProvider} from "./model"
import {Element, ElementConfig, ElementContext} from "./element"
import {Spec} from "./style"
import {AxisConfig, VGroup} from "./group"

/** Defines configuration for [[List]] elements. */
export interface ListConfig extends AxisConfig {
  element :ElementConfig
  data :Spec<ModelProvider>
  keys :Spec<Source<ModelKey[]>>
}

/** A list displays a dynamic list of elements, each instantiated from a sub-model and a list
  * element template. The elements are arrayed along a vertical axis like a [[Group]]. */
export class List extends VGroup {
  private readonly elements = new Map<ModelKey,Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :ListConfig) {
    super(ctx, parent, config)
    const data = ctx.model.resolve(config.data)
    this.disposer.add(ctx.model.resolve(config.keys).onValue(keys => {
      const {contents, elements} = this
      // first dispose no longer used elements
      const kset = new Set(keys)
      for (const [ekey, elem] of elements.entries()) {
        if (!kset.has(ekey)) elem.dispose()
      }
      // now create/reuse elements for the new keys
      contents.length = 0
      for (const key of keys) {
        let elem = this.elements.get(key)
        if (!elem) {
          elem = ctx.elem.create({...ctx, model: data.resolve(key)}, this, config.element)
          this.elements.set(key, elem)
        }
        contents.push(elem)
      }
      this.invalidate()
    }))
  }
}
