import {dim2, rect, vec2} from "../core/math"
import {Mutable, Value} from "../core/react"
import {PMap, Remover} from "../core/util"
import {getConstantOrValueNodeId} from "../graph/graph"
import {InputEdge, InputEdges} from "../graph/node"
import {Element, ElementConfig, ElementContext, MouseInteraction} from "./element"
import {AbsConstraints, AbsGroup, AxisConfig, VGroup} from "./group"
import {List} from "./list"
import {Model, ModelData, ModelKey, ModelProvider, Spec} from "./model"

/** A navigable graph viewer. */
export interface GraphViewerConfig extends ElementConfig {
  type :"graphviewer"
}

export class GraphViewer extends VGroup {
  readonly contents :Element[] = []

  private _stack :Element[] = []
  private _poppable = Mutable.local(false)

  constructor (readonly ctx :ElementContext, parent :Element, readonly config :GraphViewerConfig) {
    super(ctx, parent, {...config, offPolicy: "stretch"})
    this.contents.push(
      ctx.elem.create(ctx, this, {
        type: "box",
        scopeId: "graphViewerHeader",
        contents: {
          type: "abslayout",
          scopeId: "default",
          contents: [
            {
              type: "box",
              visible: this._poppable,
              contents: {
                type: "button",
                onClick: () => this.pop(),
                contents: {
                  type: "box",
                  contents: {type: "label", text: "backButton.text"},
                },
              },
              constraints: {stretchX: true},
              style: {halign: "left"},
            },
            {
              type: "box",
              contents: {
                type: "button",
                onClick: "remove",
                contents: {
                  type: "box",
                  contents: {type: "label", text: "closeButton.text"},
                },
              },
              constraints: {stretchX: true},
              style: {halign: "right"},
            },
          ],
        },
        style: {halign: "stretch"},
      }),
      ctx.elem.create(ctx, this, {
        type: "scrollview",
        contents: {type: "graphview"},
        constraints: {stretch: true},
      }),
    )
    this._stack.push(this.contents[1])
  }

  push (model :Model) {
    this._stack.push(this.contents[1] = this.ctx.elem.create({...this.ctx, model}, this, {
      type: "scrollview",
      contents: {type: "graphview"},
      constraints: {stretch: true},
    }))
    this._poppable.update(true)
    this.invalidate()
  }

  pop () {
    this._stack.pop()
    this.contents[1] = this._stack[this._stack.length - 1]
    this._poppable.update(this._stack.length > 1)
    this.invalidate()
  }
}

/** Visualizes a graph. */
export interface GraphViewConfig extends ElementConfig {
  type :"graphview"
}

type InputValue = InputEdge<any> | InputEdges<any>

export class GraphView extends AbsGroup {
  readonly elements = new Map<string, {node :Element, edges :Element}>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :GraphViewConfig) {
    super(ctx, parent, config)
    const data = ctx.model.resolve("nodeData" as Spec<ModelProvider>)
    let models :Model[] | null = []
    this.disposer.add(ctx.model.resolve("nodeKeys" as Spec<Value<string[]>>).onValue(keys => {
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
          const subctx = {...ctx, model}
          elem = {
            node: ctx.elem.create(subctx, this, {
              type: "box",
              constraints: {position: [0, 0]},
              scopeId: "node",
              contents: {type: "nodeview", offPolicy: "stretch"},
            }),
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
    const graphView = this
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
        let x = 0
        do {
          const nextColumn = new Column()
          for (const key of column.keys) {
            const element = graphView.elements.get(key)!.node
            const layoutNode = layoutNodes.get(key)
            if (!layoutNode) {
              if (!placed.has(element)) {
                continue // laid out in same row
              }
              // the node has already been laid out; move this column over
              const constraints = element.config.constraints as AbsConstraints
              const position = constraints.position as number[]
              const size = element.preferredSize(-1, -1)
              x = Math.max(x, position[0] + size[0] + horizontalGap)
              continue
            }
            layoutNodes.delete(key)
            column.elements.push(element)
            const size = element.preferredSize(-1, -1)
            column.width = Math.max(column.width, size[0])
            column.height += size[1]
            nextColumn.keys.push(...layoutNode.inputs)
          }
          if (column.elements.length > 0) {
            x = Math.max(0, x - column.width - horizontalGap)
            columns.unshift(column)
          }
          maxHeight = Math.max(maxHeight, column.height)
          column = nextColumn
        } while (column.keys.length > 0)

        for (const column of columns) {
          let y = top + (maxHeight - column.height) / 2
          for (const element of column.elements) {
            const constraints = element.config.constraints as AbsConstraints
            const size = element.preferredSize(-1, -1)
            const position = constraints.position as number[]
            position[0] = x + (column.width - size[0])
            position[1] = y
            y += size[1]
            placed.add(element)
          }
          x += column.width + horizontalGap
        }
        return maxHeight + 40
      }
    }
    const roots = new Set(keys)
    const layoutNodes = new Map<string, LayoutNode>()
    const placed = new Set<Element>()

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
        } else if (edge !== undefined) {
          const nodeId = getConstantOrValueNodeId(edge)
          inputs.push(nodeId)
          roots.delete(nodeId)
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

/** Depicts a single node. */
export interface NodeViewConfig extends AxisConfig {
  type :"nodeview"
}

export class NodeView extends VGroup {
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :NodeViewConfig) {
    super(ctx, parent, config)
    const hasProperties = ctx.model.resolve<Value<ModelKey[]>>("propertyKeys").current.length > 0
    const hasInputs = ctx.model.resolve<Value<ModelKey[]>>("inputKeys").current.length > 0
    const hasOutputs = ctx.model.resolve<Value<ModelKey[]>>("outputKeys").current.length > 0

    const bodyContents :ElementConfig[] = []
    if (ctx.model.resolve<Value<string>>("type").current === "subgraph") {
      bodyContents.push({
        type: "button",
        onClick: () => {
          const graphViewer = parent.parent!.parent!.parent as GraphViewer
          graphViewer.push(new Model(ctx.model.data.subgraph as ModelData))
        },
        contents: {
          type: "box",
          scopeId: "nodeButton",
          contents: {type: "label", text: Value.constant("Open")},
        },
      })
    }
    if (hasProperties) {
      bodyContents.push({
        type: "propertyview",
        scopeId: "nodeProperties",
        offPolicy: "stretch",
      })
    }
    if (hasInputs || hasOutputs) {
      bodyContents.push({
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
              tags: new Set(["inputs"]),
              gap: 1,
              offPolicy: "stretch",
              element: {
                type: "row",
                contents: [
                  {
                    type: "terminal",
                    direction: "input",
                    value: "style",
                    contents: {type: "row", contents: []},
                  },
                  {
                    type: "box",
                    scopeId: "nodeInput",
                    contents: {type: "label", text: "name"},
                    style: {halign: "left"},
                    constraints: {stretch: true},
                  },
                ],
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
              tags: new Set(["outputs"]),
              gap: 1,
              offPolicy: "stretch",
              element: {
                type: "row",
                contents: [
                  {
                    type: "box",
                    scopeId: "nodeOutput",
                    contents: {type: "label", text: "name"},
                    style: {halign: "right"},
                    constraints: {stretch: true},
                  },
                  {
                    type: "terminal",
                    direction: "output",
                    value: "style",
                    contents: {type: "row", contents: []},
                  },
                ],
              },
              data: "output",
              keys: "outputKeys",
            },
          }
        ],
      })
    }
    this.contents.push(
      ctx.elem.create(ctx, this, {
        type: "box",
        scopeId: "nodeHeader",
        contents: {type: "label", text: "type"},
      }),
      ctx.elem.create(ctx, this, {
        type: "box",
        scopeId: "nodeBody",
        style: {halign: "stretch"},
        contents: {
          type: "column",
          offPolicy: "stretch",
          gap: 5,
          contents: bodyContents,
        },
      }),
    )
  }

  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    const interaction = super.handleMouseDown(event, pos)
    if (interaction) return interaction
    const basePos = vec2.clone(pos)
    const constraints = this.requireParent.config.constraints as AbsConstraints
    const position = constraints.position!
    const origin = position.slice()
    return {
      move: (event, pos) => {
        position[0] = origin[0] + pos[0] - basePos[0]
        position[1] = origin[1] + pos[1] - basePos[1]
        this.invalidate()
      },
      release: () => {},
      cancel: () => {},
    }
  }
}

/** Depicts a node's editable/viewable properties. */
export interface PropertyViewConfig extends AxisConfig {
  type :"propertyview"
}

export class PropertyView extends VGroup {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :PropertyViewConfig) {
    super(ctx, parent, config)
    const property = ctx.model.resolve("property" as Spec<ModelProvider>)
    this.disposer.add(ctx.model.resolve("propertyKeys" as Spec<Value<string[]>>).onValue(keys => {
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
          const model = property.resolve(key)
          elem = ctx.elem.create({...ctx, model}, this, {
            type: "row",
            contents: [
              {
                type: "box",
                constraints: {stretch: true},
                style: {halign: "left"},
                contents: {
                  type: "label",
                  text: model.resolve("name" as Spec<Value<string>>).map(name => name + ":"),
                },
              },
              {
                type: "label",
                constraints: {stretch: true},
                text: model.resolve("value" as Spec<Value<any>>).map(toLimitedString),
              },
            ],
          })
          this.elements.set(key, elem)
        }
        contents.push(elem)
      }
      this.invalidate()
    }))
  }
}

function toLimitedString (value :any) {
  // round numbers to six digits after decimal
  if (typeof value === "number") return String(Math.round(value * 1000000) / 1000000)
  const string = String(value)
  return string.length > 30 ? string.substring(0, 27) + "..." : string
}

/** Visualizes a node's input edges. */
export interface EdgeViewConfig extends ElementConfig {
  type :"edgeview"
  style :PMap<EdgeViewStyle>
}

/** Defines the styles that apply to [[EdgeView]]. */
export interface EdgeViewStyle {
  lineWidth? :number
}

export class EdgeView extends Element {
  private _nodeId :Value<string>
  private _inputKeys :Value<string[]>
  private _defaultOutputKey :Value<string>
  private _input :ModelProvider
  private _inputs :Value<InputValue[]>
  private _output :ModelProvider
  private _edges :{from :vec2, to :[vec2, Value<string>][]}[] = []
  private _lineWidth = 1
  private _nodeRemovers :Map<Element, Remover> = new Map()
  private _styleRemovers :Map<Value<string>, Remover> = new Map()

  constructor (ctx :ElementContext, parent :Element, readonly config :EdgeViewConfig) {
    super(ctx, parent, config)
    this._nodeId = ctx.model.resolve("id" as Spec<Value<string>>)
    this._inputKeys = ctx.model.resolve("inputKeys" as Spec<Value<string[]>>)
    this._defaultOutputKey = ctx.model.resolve("defaultOutputKey" as Spec<Value<string>>)
    this._input = ctx.model.resolve("input" as Spec<ModelProvider>)
    this._output = ctx.model.resolve("output" as Spec<ModelProvider>)
    this.invalidateOnChange(this._inputs = this._inputKeys.switchMap(inputKeys => {
      return Value.join(...inputKeys.map(inputKey => {
        return this._input.resolve(inputKey).resolve("value" as Spec<Value<InputValue>>)
      }))
    }))
    const style = this.getStyle(this.config.style, "normal") as EdgeViewStyle
    if (style.lineWidth) this._lineWidth = style.lineWidth
  }

  getDefaultOutputKey () {
    return this._defaultOutputKey.current
  }

  getOutputStyle (key :string) {
    return this._output.resolve(key).resolve("style" as Spec<Value<string>>)
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    // find corresponding node
    const node = this._requireValidatedNode(this._nodeId.current)
    const inputList = node.findTaggedChild("inputs") as List

    this._edges.length = 0
    const min = vec2.fromValues(Infinity, Infinity)
    const max = vec2.fromValues(-Infinity, -Infinity)

    const inputKeys = this._inputKeys.current
    const inputs = this._inputs.current
    const view = this.requireParent as GraphView
    for (let ii = 0; ii < inputKeys.length; ii++) {
      const input = inputs[ii]
      if (input === undefined) continue
      const inputKey = inputKeys[ii]
      const source = inputList.contents[ii]
      const from = vec2.fromValues(source.x - view.x, source.y + source.height / 2 - view.y)
      vec2.min(min, min, from)
      vec2.max(max, max, from)
      const to :[vec2, Value<string>][] = []
      const addEdge = (input :InputEdge<any>) => {
        let targetId :string
        let outputId :string|undefined
        if (Array.isArray(input)) {
          [targetId, outputId] = input
        } else if (typeof input === "string") {
          targetId = input
        } else if (input !== undefined) {
          targetId = getConstantOrValueNodeId(input)
        } else {
          return
        }
        const targetNode = this._requireValidatedNode(targetId)
        const outputList = targetNode.findTaggedChild("outputs") as List
        const targetEdges = this._requireEdges(targetId) as EdgeView
        if (!outputId) outputId = targetEdges.getDefaultOutputKey()
        const target = outputList.getElement(outputId)
        if (target) {
          const toPos = vec2.fromValues(
            target.x + target.width - view.x,
            target.y + target.height / 2 - view.y,
          )
          const style = targetEdges.getOutputStyle(outputId)
          if (!this._styleRemovers.has(style)) {
            const remover = style.onValue(() => this.dirty())
            this._styleRemovers.set(style, remover)
            this.disposer.add(remover)
          }
          to.push([toPos, style])
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
      const expand = Math.ceil(this._lineWidth / 2)
      dim2.set(into, max[0] - min[0] + expand * 2, max[1] - min[1] + expand * 2)
      this.config.constraints = {position: [min[0] - expand, min[1] - expand]}
    } else {
      dim2.set(into, 0, 0)
    }
  }

  private _requireValidatedNode (nodeId :string) :Element {
    const view = this.requireParent as GraphView
    const node = view.elements.get(nodeId)!.node
    const position = (node.config.constraints as AbsConstraints).position!
    const size = node.preferredSize(-1, -1)
    node.setBounds(rect.fromValues(view.x + position[0], view.y + position[1], size[0], size[1]))
    node.validate()

    // when the node is invalidated, we also need to invalidate
    if (!this._nodeRemovers.has(node)) {
      const remover = node.valid.onValue(value => {
        if (!value) this.invalidate()
      })
      this.disposer.add(remover)
      this._nodeRemovers.set(node, remover)
    }
    return node
  }

  private _requireEdges (nodeId :string) :Element {
    const view = this.requireParent as GraphView
    return view.elements.get(nodeId)!.edges
  }

  protected relayout () {}

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    if (this._edges.length === 0) return
    const view = this.requireParent as GraphView
    canvas.translate(view.x, view.y)
    canvas.lineWidth = this._lineWidth
    for (const edge of this._edges) {
      for (const [to, style] of edge.to) {
        canvas.strokeStyle = style.current
        canvas.beginPath()
        canvas.moveTo(edge.from[0], edge.from[1])
        canvas.bezierCurveTo(edge.from[0] - 40, edge.from[1], to[0] + 40, to[1], to[0], to[1])
        canvas.stroke()
      }
    }
    canvas.lineWidth = 1
    canvas.translate(-view.x, -view.y)
  }
}

/** Defines the styles that apply to [[Terminal]]. */
export interface TerminalStyle {
  radius? :number
  outlineWidth? :number
  outlineAlpha? :number
  cursor? :string
}

/** Visualizes a single node terminal. */
export interface TerminalConfig extends ElementConfig {
  type :"terminal"
  direction :"input" | "output"
  value :Spec<Value<string>>
  style :PMap<TerminalStyle>
}

export const TerminalStyleScope = {id: "terminal", states: ["normal", "hovered"]}

const expandedBounds = rect.create()

export class Terminal extends Element {
  private readonly _state = Mutable.local("normal")
  private readonly _hovered = Mutable.local(false)
  private readonly _value :Value<string>
  private readonly _radius = this.observe(5)
  private readonly _outlineWidth = this.observe(0)
  private readonly _outlineAlpha = this.observe(1)

  constructor (ctx :ElementContext, parent :Element, readonly config :TerminalConfig) {
    super(ctx, parent, config)
    this._value = ctx.model.resolve(config.value)
    this.disposer.add(this._value.onValue(() => this.dirty()))
    this.disposer.add(this._hovered.onValue(() => this._state.update(this.computeState)))
    this.disposer.add(this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      this._radius.observe(Value.constant(style.radius === undefined ? 5 : style.radius))
      this._outlineWidth.observe(Value.constant(
        style.outlineWidth === undefined ? 0 : style.outlineWidth,
      ))
      this._outlineAlpha.observe(Value.constant(
        style.outlineAlpha === undefined ? 1 : style.outlineAlpha,
      ))
      if (style.cursor) this.setCursor(this, style.cursor)
      else this.clearCursor(this)
    }))
  }

  get style () :TerminalStyle { return this.getStyle(this.config.style, this.state.current) }
  get styleScope () { return TerminalStyleScope }
  get state () :Value<string> { return this._state }

  get sign () {
    return this.config.direction === "input" ? -1 : 1
  }

  handleMouseEnter (event :MouseEvent, pos :vec2) { this._hovered.update(true) }
  handleMouseLeave (event :MouseEvent, pos :vec2) { this._hovered.update(false) }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    if (rect.contains(this.expandBounds(this.bounds), pos) && this.visible.current) op(this)
  }

  expandBounds (bounds :rect) :rect {
    const radius = this._radius.current
    const outlineWidth = this._outlineWidth.current
    return rect.set(
      expandedBounds,
      bounds[0] + radius * (this.sign - 1) - Math.round(outlineWidth/2),
      bounds[1] - radius - Math.round(outlineWidth/2),
      2 * radius + outlineWidth,
      2 * radius + outlineWidth,
    )
  }

  protected get computeState () :string {
    return this._hovered.current ? "hovered" : "normal"
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.set(into, 0, 0)
  }

  protected relayout () {}

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const style = this._value.current
    canvas.strokeStyle = style
    canvas.fillStyle = style
    canvas.beginPath()
    const radius = this._radius.current
    const outlineWidth = this._outlineWidth.current
    const outlineAlpha = this._outlineAlpha.current
    canvas.arc(this.x + radius * this.sign, this.y, radius, 0, 2 * Math.PI)
    canvas.fill()
    if (outlineWidth) {
      canvas.lineWidth = outlineWidth
      canvas.globalAlpha = outlineAlpha
      canvas.stroke()
      canvas.lineWidth = 1
      canvas.globalAlpha = 1
    }
  }
}
