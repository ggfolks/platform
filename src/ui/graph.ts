import {Source, Value} from "../core/react"
import {InputEdge, InputEdges} from "../graph/node"
import {Element, ElementConfig, ElementContext} from "./element"
import {AbsConstraints, AbsGroup} from "./group"
import {Model, ModelKey, ModelProvider, Spec} from "./model"

/** Visualizes a graph. */
export interface GraphViewerConfig extends ElementConfig {
  type :"graphviewer"
  data :Spec<ModelProvider>
  keys :Spec<Source<IterableIterator<string>>>
}

export class GraphViewer extends AbsGroup {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :GraphViewerConfig) {
    super(ctx, parent, config)
    const data = ctx.model.resolve(config.data)
    let models :Model[] | null = []
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
      for (const key of kset) {
        let elem = this.elements.get(key)
        if (!elem) {
          const model = data.resolve(key)
          if (models) models.push(model)
          const hasInputs = model.resolve<Value<ModelKey[]>>("inputKeys").current.length > 0
          const hasOutputs = model.resolve<Value<ModelKey[]>>("outputKeys").current.length > 0
          const config = {
            type: "box",
            constraints: {position: [0, 0]},
            scopeId: "node",
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
          }
          elem = ctx.elem.create({...ctx, model}, this, config)
          this.elements.set(key, elem)
        }
        contents.push(elem)
      }
      // perform initial layout now that we have the elements and their preferred sizes
      if (models) {
        this._layoutGraph(Array.from(kset), models)
        models = null
      }
      this.invalidate()
    }))
  }

  private _layoutGraph (keys :string[], models :Model[]) {
    const graphViewer = this
    const horizontalGap = 20
    class LayoutNode {
      constructor (readonly inputs :string[]) {}
      layoutRoot (rootKey :string, top :number) :number {
        let maxHeight = 0
        class Column {
          height = 0
          width = 0
          elements :Element[] = []
          constructor (readonly keys :string[] = []) {}
        }
        const columns :Column[] = []
        let column = new Column([rootKey])
        do {
          const nextColumn = new Column()
          for (const key of column.keys) {
            const layoutNode = layoutNodes.get(key)
            if (!layoutNode) {
              continue
            }
            layoutNodes.delete(key)
            const element = graphViewer.elements.get(key) as Element
            column.elements.push(element)
            const size = element.preferredSize(-1, -1)
            column.width = Math.max(column.width, size[0])
            column.height += size[1]
            nextColumn.keys.push(...layoutNode.inputs)
          }
          if (column.elements.length > 0) columns.unshift(column)
          maxHeight = Math.max(maxHeight, column.height)
          column = nextColumn
        } while (column.keys.length > 0)

        let x = 0
        for (const column of columns) {
          let y = top + (maxHeight - column.height) / 2
          for (const element of column.elements) {
            const constraints = element.config.constraints as AbsConstraints
            const size = element.preferredSize(-1, -1)
            const position = constraints.position as number[]
            position[0] = x + (column.width - size[0])
            position[1] = y
            y += size[1]
          }
          x += column.width + horizontalGap
        }
        return maxHeight + 40
      }
    }
    const roots = new Set(keys)
    const layoutNodes = new Map<string, LayoutNode>()

    // create layout nodes, note roots
    for (let ii = 0; ii < keys.length; ii++) {
      const key = keys[ii]
      const model = models[ii]
      const inputKeys = model.resolve("inputKeys" as Spec<Value<string[]>>)
      const input = model.resolve("input" as Spec<ModelProvider>)
      const inputs :string[] = []
      const pushInput = (edge :InputEdge<any>) => {
        if (Array.isArray(edge)) {
          inputs.push(edge[0])
          roots.delete(edge[0])
        } else if (typeof edge === "string") {
          inputs.push(edge)
          roots.delete(edge)
        } else {
          // TODO: create nodes for constants
        }
      }
      for (const inputKey of inputKeys.current) {
        // remove anything from roots that's used as an input
        const data = input.resolve(inputKey)
        const value = data.resolve("value" as Spec<Value<InputEdge<any>|InputEdges<any>>>)
        const multiple = data.resolve("multiple" as Spec<Value<boolean>>)
        if (multiple.current) {
          if (Array.isArray(value.current)) value.current.forEach(pushInput)
        } else {
          pushInput(value.current)
        }
      }
      layoutNodes.set(key, new LayoutNode(inputs))
    }
    // start with the roots
    let y = 0
    for (const key of roots) {
      y += (layoutNodes.get(key) as LayoutNode).layoutRoot(key, y)
    }
    // keep going until we run out of layout nodes
    while (layoutNodes.size > 0) {
      const [key, layoutNode] = layoutNodes.entries().next().value
      y += layoutNode.layoutRoot(key, y)
    }
  }
}
