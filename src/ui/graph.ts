import {Source, Value} from "../core/react"
import {Element, ElementConfig, ElementContext} from "./element"
import {AbsGroup} from "./group"
import {ModelKey, ModelProvider, Spec} from "./model"

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
          const model = data.resolve(key)
          const hasInputs = model.resolve<Value<ModelKey[]>>("inputKeys").current.length > 0
          const hasOutputs = model.resolve<Value<ModelKey[]>>("outputKeys").current.length > 0
          const config = {
            type: "box",
            contents: {
              type: "column",
              offPolicy: "equalize",
              contents: [
                {
                  type: "box",
                  scopeId: "nodeHeader",
                  contents: {type: "label", text: "type"},
                },
                {
                  type: "box",
                  scopeId: "nodeBody",
                  style: {halign: "stretch"},
                  contents: {
                    type: "row",
                    gap: 5,
                    contents: [
                      {
                        type: "box",
                        scopeId: "nodeEdges",
                        constraints: {stretch: hasInputs},
                        style: {halign: "left"},
                        contents: {
                          type: "list",
                          gap: 1,
                          offPolicy: "stretch",
                          element: {
                            type: "box",
                            contents: {type: "label", text: "name"},
                            style: {halign: "left"},
                          },
                          data: "input",
                          keys: "inputKeys",
                        },
                      },
                      {
                        type: "box",
                        scopeId: "nodeEdges",
                        constraints: {stretch: hasOutputs},
                        style: {halign: "right"},
                        contents: {
                          type: "list",
                          gap: 1,
                          offPolicy: "stretch",
                          element: {
                            type: "box",
                            contents: {type: "label", text: "name"},
                            style: {halign: "right"},
                          },
                          data: "output",
                          keys: "outputKeys",
                        },
                      }
                    ],
                  },
                },
              ],
            },
            constraints: {position: [0, 0]},
          }
          elem = ctx.elem.create({...ctx, model}, this, config)
          this.elements.set(key, elem)
        }
        contents.push(elem)
        elem.config.constraints!.position[0] = x
        x += elem.preferredSize(this.width, this.height)[0] + 40
      }
      this.invalidate()
    }))
  }
}
