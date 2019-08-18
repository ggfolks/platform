import {dim2, rect, vec2} from "../core/math"
import {Source, Value} from "../core/react"
import {InputEdge, InputEdges} from "../graph/node"
import {Element, ElementConfig, ElementContext} from "./element"
import {AbsConstraints, AbsGroup, Row} from "./group"
import {List} from "./list"
import {Model, ModelKey, ModelProvider, Spec} from "./model"
import {DefaultPaint, PaintConfig} from "./style"

/** Visualizes a graph. */
export interface GraphViewerConfig extends ElementConfig {
  type :"graphviewer"
  data :Spec<ModelProvider>
  keys :Spec<Source<IterableIterator<string>>>
}

type InputValue = InputEdge<any> | InputEdges<any>

export class GraphViewer extends AbsGroup {
  readonly elements = new Map<string, {node :Element, edges :Element}>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :GraphViewerConfig) {
    super(ctx, parent, config)
    const data = ctx.model.resolve(config.data)
    let models :Model[] | null = []
    this.disposer.add(ctx.model.resolve(config.keys).onValue(keys => {
      const {contents, elements} = this
      // first dispose no longer used elements
      const kset = new Set(keys)
      for (const [ekey, elems] of elements.entries()) {
        if (!kset.has(ekey)) {
          elements.delete(ekey)
          elems.node.dispose()
          elems.edges.dispose()
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
          const subctx = {...ctx, model}
          elem = {
            node: ctx.elem.create(subctx, this, config),
            edges: ctx.elem.create(subctx, this, {type: "edgeview"}),
          }
          this.elements.set(key, elem)
        }
        // render edges below nodes
        contents.push(elem.node)
        contents.unshift(elem.edges)
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
            const element = graphViewer.elements.get(key)!.node
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
        const value = data.resolve("value" as Spec<Value<InputValue>>)
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

/** Visualizes a node's input edges. */
export interface EdgeViewConfig extends ElementConfig {
  type :"edgeview"
}

/** Defines the styles that apply to [[EdgeView]]. */
export interface EdgeViewStyle {
  stroke? :Spec<PaintConfig>
  lineWidth? :number
}

export class EdgeView extends Element {
  private _nodeId :Value<string>
  private _inputKeys :Value<string[]>
  private _outputKeys :Value<string[]>
  private _input :ModelProvider
  private _inputs :Value<InputValue[]>
  private _output :ModelProvider
  private _edges :{from :vec2, to :vec2[]}[] = []
  private _paint = this.observe(DefaultPaint)
  private _lineWidth = 1

  constructor (ctx :ElementContext, parent :Element, readonly config :EdgeViewConfig) {
    super(ctx, parent, config)
    this._nodeId = ctx.model.resolve("id" as Spec<Value<string>>)
    this._inputKeys = ctx.model.resolve("inputKeys" as Spec<Value<string[]>>)
    this._outputKeys = ctx.model.resolve("outputKeys" as Spec<Value<string[]>>)
    this._input = ctx.model.resolve("input" as Spec<ModelProvider>)
    this._output = ctx.model.resolve("output" as Spec<ModelProvider>)
    this.invalidateOnChange(this._inputs = this._inputKeys.switchMap(inputKeys => {
      return Value.join(...inputKeys.map(inputKey => {
        return this._input.resolve(inputKey).resolve("value" as Spec<Value<InputValue>>)
      }))
    }))
    const style = this.getStyle(this.config.style, "normal") as EdgeViewStyle
    if (style.stroke) this._paint.observe(ctx.style.resolvePaint(style.stroke))
    if (style.lineWidth) this._lineWidth = style.lineWidth
  }

  getDefaultOutputKey () {
    for (const outputKey of this._outputKeys.current) {
      const outputModel = this._output.resolve(outputKey)
      const isDefault = outputModel.resolve("isDefault" as Spec<Value<boolean>>)
      if (isDefault.current) return outputKey
    }
    return this._outputKeys.current[0]
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    // find corresponding node
    const node = this._requireValidatedNode(this._nodeId.current)
    const inputList = node.findChild("list") as List

    this._edges.length = 0
    const min = vec2.fromValues(Infinity, Infinity)
    const max = vec2.fromValues(-Infinity, -Infinity)

    const inputKeys = this._inputKeys.current
    const inputs = this._inputs.current
    for (let ii = 0; ii < inputKeys.length; ii++) {
      const input = inputs[ii]
      if (input === undefined) continue
      const inputKey = inputKeys[ii]
      const source = inputList.contents[ii]
      const from = vec2.fromValues(source.x, source.y + source.height / 2)
      vec2.min(min, min, from)
      vec2.max(max, max, from)
      const to :vec2[] = []
      const addEdge = (input :InputEdge<any>) => {
        let targetId :string
        let outputId :string|undefined
        if (Array.isArray(input)) {
          [targetId, outputId] = input
        } else if (typeof input === "string") {
          targetId = input
        } else {
          return // TODO: constants
        }
        const targetNode = this._requireValidatedNode(targetId)
        const row = targetNode.findChild("row") as Row
        const outputList = row.contents[1].findChild("list") as List
        let target :Element|undefined
        if (outputId) {
          target = outputList.getElement(outputId)
        } else {
          const targetEdges = this._requireEdges(targetId) as EdgeView
          target = outputList.getElement(targetEdges.getDefaultOutputKey())
        }
        if (target) {
          const toPos = vec2.fromValues(target.x + target.width, target.y + target.height / 2)
          to.push(toPos)
          vec2.min(min, min, toPos)
          vec2.max(max, max, toPos)
        }
      }
      const inputModel = this._input.resolve(inputKey)
      const multiple = inputModel.resolve("multiple" as Spec<Value<boolean>>)
      if (multiple.current) {
        if (Array.isArray(input)) input.forEach(addEdge)
      } else {
        addEdge(input)
      }
      this._edges.push({from, to})
    }
    if (min[0] <= max[0] && min[1] <= max[1]) {
      dim2.set(into, max[0] - min[0], max[1] - min[1])
      this.config.constraints = {position: [min[0], min[1]]}
    } else {
      dim2.set(into, 0, 0)
    }
  }

  private _requireValidatedNode (nodeId :string) :Element {
    const viewer = this.requireParent as GraphViewer
    const node = viewer.elements.get(nodeId)!.node
    const position = (node.config.constraints as AbsConstraints).position!
    const size = node.preferredSize(-1, -1)
    node.setBounds(rect.fromValues(position[0], position[1], size[0], size[1]))
    node.validate()
    return node
  }

  private _requireEdges (nodeId :string) :Element {
    const viewer = this.requireParent as GraphViewer
    return viewer.elements.get(nodeId)!.edges
  }

  protected relayout () {}

  protected rerender (canvas :CanvasRenderingContext2D) {
    if (this._edges.length === 0) return
    canvas.beginPath()
    for (const edge of this._edges) {
      for (const to of edge.to) {
        canvas.moveTo(edge.from[0], edge.from[1])
        canvas.bezierCurveTo(to[0], edge.from[1], edge.from[0], to[1], to[0], to[1])
      }
    }
    this._paint.current.prepStroke(canvas)
    canvas.lineWidth = this._lineWidth
    canvas.stroke()
    canvas.lineWidth = 1
  }
}
