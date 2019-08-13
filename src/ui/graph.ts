import {Record} from "../core/data"
import {Source} from "../core/react"
import {Element, ElementConfig, ElementContext} from "./element"
import {AbsGroup} from "./group"
import {ModelProvider, Spec} from "./model"

/** Visualizes a graph. */
export interface GraphViewerConfig extends ElementConfig {
  type :"graphviewer"
  data :Spec<ModelProvider>
  keys :Spec<Source<IterableIterator<string>>>
}

export class GraphViewer extends AbsGroup {
  private readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :GraphViewerConfig) {
    super(ctx, parent, config)
    const data = ctx.model.resolve(config.data)
    this.disposer.add(ctx.model.resolve(config.keys).onValue(keys => {
      const {contents, elements} = this
      // first dispose no longer used elements
      const kset = new Set(keys)
      for (const [ekey, elem] of elements.entries()) {
        if (!kset.has(ekey)) {
          elements.delete(ekey)
          elem.dispose()
        }
      }
      // now create/reuse elements for the new keys
      contents.length = 0
      let x = 0
      for (const key of kset) {
        let elem = this.elements.get(key)
        if (!elem) {
          const config = {
            type: "box",
            contents: {
              type: "column",
              contents: [
                {
                  type: "label",
                  text: "type",
                }
              ],
            },
            constraints: {position: [0, 0]},
          }
          elem = ctx.elem.create({...ctx, model: data.resolve(key)}, this, config)
          this.elements.set(key, elem)
        }
        contents.push(elem);
        (elem.config.constraints as Record).position[0] = x
        x += elem.preferredSize(this.width, this.height)[0] + 10
      }
      this.invalidate()
    }))
  }
}
