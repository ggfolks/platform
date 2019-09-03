import {dataEquals} from "../core/data"
import {clamp, dim2, rect, vec2} from "../core/math"
import {Mutable, Source, Value} from "../core/react"
import {PMap, Remover} from "../core/util"
import {getConstantOrValueNodeId} from "../graph/graph"
import {InputEdge} from "../graph/node"
import {Element, ElementConfig, ElementContext, MouseInteraction, Observer} from "./element"
import {AbsConstraints, AbsGroup, AxisConfig, VGroup} from "./group"
import {List} from "./list"
import {Action, Model, ModelData, ModelKey, ModelProvider, Spec, dataProvider} from "./model"
import {InputValue, NodeCreator} from "./node"

/** A navigable graph viewer. */
export interface GraphViewerConfig extends ElementConfig {
  type :"graphviewer"
  editable? :Spec<Value<boolean>>
}

export class GraphViewer extends VGroup {
  readonly contents :Element[] = []

  private _editable = Value.constant(false)
  private _nodeCreator :Mutable<NodeCreator>
  private _stack :[Model, Element][] = []
  private _poppable = Mutable.local(false)

  constructor (readonly ctx :ElementContext, parent :Element, readonly config :GraphViewerConfig) {
    super(ctx, parent, {...config, offPolicy: "stretch"})
    if (this.config.editable) this._editable = ctx.model.resolve(this.config.editable)
    const categoryKeys = ctx.model.resolve<Source<string[]>>("categoryKeys")
    const categoryData = ctx.model.resolve<ModelProvider>("categoryData")
    this._nodeCreator = ctx.model.resolve<Mutable<NodeCreator>>("nodeCreator")
    const remove = ctx.model.resolve<Action>("remove")
    this.contents.push(
      ctx.elem.create(ctx, this, {
        type: "box",
        scopeId: "graphViewerHeader",
        contents: {
          type: "row",
          scopeId: "default",
          offPolicy: "stretch",
          contents: [
            {
              type: "menubar",
              offPolicy: "stretch",
              element: {
                type: "menu",
                contents: {
                  type: "box",
                  contents: {type: "label", text: "title"},
                },
                element: {
                  type: "menuitem",
                  enabled: "enabled",
                  contents: {
                    type: "box",
                    contents: {
                      type: "row",
                      offPolicy: "stretch",
                      contents: [
                        {type: "label", text: "name"},
                        {type: "spacer", height: 0, constraints: {stretch: true}},
                        {type: "label", text: Value.constant("▸"), visible: "submenu"},
                        {type: "shortcut", command: "shortcut"},
                      ],
                    },
                    style: {halign: "stretch"},
                  },
                  element: {
                    type: "menuitem",
                    contents: {
                      type: "box",
                      contents: {type: "label", text: "name"},
                      style: {halign: "left"},
                    },
                    action: "action",
                  },
                  keys: "keys",
                  data: "data",
                  action: "action",
                  separator: "separator",
                },
                keys: "keys",
                data: "data",
              },
              data: dataProvider({
                graph: {
                  title: Value.constant("Graph"),
                  keys: Value.constant(["import", "export", "sep", "close"]),
                  data: dataProvider({
                    import: {
                      name: Value.constant("Import..."),
                      enabled: this._editable,
                      action: () => {},
                    },
                    export: {
                      name: Value.constant("Export..."),
                      action: () => {},
                    },
                    sep: {separator: Value.constant(true)},
                    close: {
                      name: Value.constant("Close"),
                      shortcut: Value.constant("closeTab"),
                      action: remove,
                    },
                  }),
                },
                edit: {
                  title: Value.constant("Edit"),
                  keys: Value.constant(["undo", "redo", "sep", "cut", "copy", "paste", "delete"]),
                  data: dataProvider({
                    undo: {
                      name: Value.constant("Undo"),
                      enabled: Value.constant(false),
                      shortcut: Value.constant("undo"),
                      action: () => {},
                    },
                    redo: {
                      name: Value.constant("Redo"),
                      enabled: Value.constant(false),
                      shortcut: Value.constant("redo"),
                      action: () => {},
                    },
                    sep: {separator: Value.constant(true)},
                    cut: {
                      name: Value.constant("Cut"),
                      enabled: Value.constant(false),
                      shortcut: Value.constant("cut"),
                      action: () => {},
                    },
                    copy: {
                      name: Value.constant("Copy"),
                      enabled: Value.constant(false),
                      shortcut: Value.constant("copy"),
                      action: () => {},
                    },
                    paste: {
                      name: Value.constant("Paste"),
                      enabled: Value.constant(false),
                      shortcut: Value.constant("paste"),
                      action: () => {},
                    },
                    delete: {
                      name: Value.constant("Delete"),
                      enabled: Value.constant(false),
                      shortcut: Value.constant("delete"),
                      action: () => {},
                    },
                  }),
                },
                view: {
                  title: Value.constant("View"),
                  keys: Value.constant(["zoomIn", "zoomOut", "zoomReset", "zoomToFit"]),
                  data: dataProvider({
                    zoomIn: {
                      name: Value.constant("Zoom In"),
                      shortcut: Value.constant("zoomIn"),
                      action: () => {},
                    },
                    zoomOut: {
                      name: Value.constant("Zoom Out"),
                      shortcut: Value.constant("zoomOut"),
                      action: () => {},
                    },
                    zoomReset: {
                      name: Value.constant("Reset Zoom"),
                      shortcut: Value.constant("zoomReset"),
                      action: () => {},
                    },
                    zoomToFit: {
                      name: Value.constant("Zoom to Fit"),
                      action: () => {},
                    },
                  }),
                },
                node: {
                  title: Value.constant("Node"),
                  keys: categoryKeys,
                  data: categoryData,
                },
              }),
              keys: Value.constant(["graph", "edit", "view", "node"]),
            },
            {
              type: "spacer",
              height: 0,
              constraints: {stretch: true},
            },
            {
              type: "button",
              onClick: () => this.pop(),
              visible: this._poppable,
              contents: {
                type: "box",
                contents: {type: "label", text: "backButton.text"},
              },
            },
            {
              type: "button",
              onClick: remove,
              contents: {
                type: "box",
                contents: {type: "label", text: "closeButton.text"},
              },
            },
          ],
        },
        style: {halign: "stretch"},
      }),
      ctx.elem.create(ctx, this, {
        type: "scrollview",
        contents: {type: "graphview", editable: this._editable},
        constraints: {stretch: true},
      }),
    )
    this._stack.push([ctx.model, this.contents[1]])
    this._updateNodeCreator(ctx.model)
  }

  push (model :Model) {
    this._stack.push([model, this.contents[1] = this.ctx.elem.create({...this.ctx, model}, this, {
      type: "scrollview",
      contents: {type: "graphview", editable: this._editable},
      constraints: {stretch: true},
    })])
    this._updateNodeCreator(model)
    this._poppable.update(true)
    this.invalidate()
  }

  pop () {
    this._stack.pop()
    const [model, element] = this._stack[this._stack.length - 1]
    this.contents[1] = element
    this._updateNodeCreator(model)
    this._poppable.update(this._stack.length > 1)
    this.invalidate()
  }

  _updateNodeCreator (model :Model) {
    this._nodeCreator.update(model.resolve<Value<NodeCreator>>("createNode").current)
  }
}

/** Visualizes a graph. */
export interface GraphViewConfig extends ElementConfig {
  type :"graphview"
  editable :Spec<Value<boolean>>
}

export class GraphView extends AbsGroup {
  readonly elements = new Map<string, {node :Element, edges :Element}>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :GraphViewConfig) {
    super(ctx, parent, config)
    const data = ctx.model.resolve("nodeData" as Spec<ModelProvider>)
    let models :Model[] | null = []
    const editable = ctx.model.resolve(this.config.editable)
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
              contents: {type: "nodeview", offPolicy: "stretch", editable},
            }),
            edges: ctx.elem.create(subctx, this, {type: "edgeview", editable}),
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
      const inputData = model.resolve("inputData" as Spec<ModelProvider>)
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
        const data = inputData.resolve(inputKey)
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
  editable :Spec<Value<boolean>>
}

export class NodeView extends VGroup {
  readonly id :string
  readonly contents :Element[] = []

  private readonly _editable :Value<boolean>

  constructor (ctx :ElementContext, parent :Element, readonly config :NodeViewConfig) {
    super(ctx, parent, config)
    this.id = ctx.model.resolve<Value<string>>("id").current
    this._editable = ctx.model.resolve(this.config.editable)
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
        editable: this._editable,
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
                    editable: this._editable,
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
              data: "inputData",
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
                    editable: this._editable,
                    contents: {type: "row", contents: []},
                  },
                ],
              },
              data: "outputData",
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
    if (interaction || !this._editable.current) return interaction
    const basePos = vec2.clone(pos)
    const constraints = this.requireParent.config.constraints as AbsConstraints
    const position = constraints.position!
    const origin = position.slice()
    this.setCursor(this, "move")
    const cancel = () => this.clearCursor(this)
    return {
      move: (event, pos) => {
        position[0] = origin[0] + pos[0] - basePos[0]
        position[1] = origin[1] + pos[1] - basePos[1]
        this.invalidate()
      },
      release: cancel,
      cancel,
    }
  }
}

/** Depicts a node's editable/viewable properties. */
export interface PropertyViewConfig extends AxisConfig {
  type :"propertyview"
  editable :Spec<Value<boolean>>
}

export class PropertyView extends VGroup {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :PropertyViewConfig) {
    super(ctx, parent, config)
    const propertyData = ctx.model.resolve("propertyData" as Spec<ModelProvider>)
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
          const model = propertyData.resolve(key)
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
  editable :Spec<Value<boolean>>
}

export interface EdgeStyle {
  lineWidth? :number
  controlPointOffset? :number
  outlineWidth? :number
  outlineAlpha? :number
}

/** Defines the styles that apply to [[EdgeView]]. */
export interface EdgeViewStyle extends EdgeStyle {
  cursor? :string
}

export const EdgeViewStyleScope = {id: "edgeview", states: ["normal", "hovered"]}

const offsetFrom = vec2.create()
const offsetTo = vec2.create()

type EdgeKeys = [string, string, string]
type OutputTo = [EdgeKeys, vec2, Value<string>]

export class EdgeView extends Element {
  private _nodeId :Value<string>
  private _editable :Value<boolean>
  private _inputKeys :Value<string[]>
  private _defaultOutputKey :Value<string>
  private _inputData :ModelProvider
  private _inputs :Value<InputValue[]>
  private _outputData :ModelProvider
  private _edges :{from :vec2, to :OutputTo[]}[] = []
  private readonly _state = Mutable.local("normal")
  private readonly _lineWidth = this.observe(1)
  private readonly _controlPointOffset = this.observe(40)
  private readonly _outlineWidth = this.observe(0)
  private readonly _outlineAlpha = this.observe(1)
  private _hoverKeys :Observer<EdgeKeys|undefined> = this.observe(undefined)
  private _nodeRemovers :Map<Element, Remover> = new Map()
  private _styleRemovers :Map<Value<string>, Remover> = new Map()

  constructor (ctx :ElementContext, parent :Element, readonly config :EdgeViewConfig) {
    super(ctx, parent, config)
    this._nodeId = ctx.model.resolve("id" as Spec<Value<string>>)
    this._editable = ctx.model.resolve(this.config.editable)
    this._inputKeys = ctx.model.resolve("inputKeys" as Spec<Value<string[]>>)
    this._defaultOutputKey = ctx.model.resolve("defaultOutputKey" as Spec<Value<string>>)
    this._inputData = ctx.model.resolve("inputData" as Spec<ModelProvider>)
    this._outputData = ctx.model.resolve("outputData" as Spec<ModelProvider>)
    this.invalidateOnChange(this._inputs = this._inputKeys.switchMap(inputKeys => {
      return Value.join(...inputKeys.map(inputKey => {
        return this._inputData.resolve(inputKey).resolve("value" as Spec<Value<InputValue>>)
      }))
    }))
    this.disposer.add(this.state.onValue(state => {
      const style = this.style
      this._lineWidth.update(style.lineWidth === undefined ? 1 : style.lineWidth)
      this._controlPointOffset.update(
        style.controlPointOffset === undefined ? 40 : style.controlPointOffset,
      )
      this._outlineWidth.update(style.outlineWidth === undefined ? 0 : style.outlineWidth)
      this._outlineAlpha.update(style.outlineAlpha === undefined ? 1 : style.outlineAlpha)
      if (style.cursor) this.setCursor(this, style.cursor)
      else this.clearCursor(this)
    }))
  }

  get style () :EdgeViewStyle { return this.getStyle(this.config.style, this.state.current) }
  get styleScope () { return EdgeViewStyleScope }
  get state () :Value<string> { return this._state }

  getDefaultOutputKey () {
    return this._defaultOutputKey.current
  }

  getOutputStyle (key :string) {
    return this._outputData.resolve(key).resolve("style" as Spec<Value<string>>)
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    if (!(rect.contains(this.bounds, pos) && this.visible.current && this._edges.length)) return
    const view = this.requireParent as GraphView
    canvas.translate(view.x, view.y)
    canvas.lineWidth = this._lineWidth.current
    canvas.globalAlpha = 0
    const outlineWidth = this._outlineWidth.current
    const off = this._controlPointOffset.current
    let hoverKeys :EdgeKeys|undefined
    outerLoop: for (const edge of this._edges) {
      for (const [keys, to] of edge.to) {
        canvas.beginPath()
        canvas.moveTo(edge.from[0], edge.from[1])
        canvas.bezierCurveTo(edge.from[0] - off, edge.from[1], to[0] + off, to[1], to[0], to[1])
        if (outlineWidth && dataEquals(keys, this._hoverKeys.current)) {
          canvas.lineWidth = outlineWidth
          canvas.stroke()
          canvas.lineWidth = this._lineWidth.current
        } else {
          canvas.stroke()
        }
        if (canvas.isPointInStroke(pos[0], pos[1])) {
          op(this)
          hoverKeys = keys
          break outerLoop
        }
      }
    }
    if (!dataEquals(this._hoverKeys.current, hoverKeys)) this._hoverKeys.update(hoverKeys)
    canvas.lineWidth = 1
    canvas.globalAlpha = 1
    canvas.translate(-view.x, -view.y)
  }

  handleMouseLeave (event :MouseEvent, pos :vec2) { this._hoverKeys.update(undefined) }

  handleMouseDown (event :MouseEvent, pos :vec2) {
    const keys = this._hoverKeys.current
    if (keys === undefined || !this._editable.current) return undefined
    const [inputKey, targetId, outputKey] = keys
    // sever the connection
    const input = this._inputData.resolve(inputKey)
    const multiple = input.resolve("multiple" as Spec<Value<boolean>>)
    const value = input.resolve("value" as Spec<Mutable<InputValue>>)
    if (multiple.current) {
      for (let ii = 0; ii < value.current.length; ii++) {
        const element = value.current[ii]
        if (
          typeof element === "string"
            ? element === targetId
            : Array.isArray(element)
            ? element[0] === targetId && element[1] === outputKey
            : element !== undefined && getConstantOrValueNodeId(element) === targetId
        ) {
          const newValue = value.current.slice()
          newValue.splice(ii, 1)
          value.update(newValue)
          break
        }
      }
    } else value.update(undefined)

    // pass the buck to the output terminal
    const view = this.requireParent as GraphView
    const node = view.elements.get(targetId)!.node
    const outputs = node.findTaggedChild("outputs") as List
    const terminal = outputs.getElement(outputKey)!.findChild("terminal") as Terminal
    return terminal.handleMouseDown(event, pos)
  }

  protected get computeState () :string {
    return this._hoverKeys.current === undefined ? "normal" : "hovered"
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
    const offset = this._controlPointOffset.current
    for (let ii = 0; ii < inputKeys.length; ii++) {
      const input = inputs[ii]
      if (input === undefined) continue
      const inputKey = inputKeys[ii]
      const source = inputList.contents[ii]
      const from = vec2.fromValues(source.x - view.x, source.y + source.height / 2 - view.y)
      vec2.set(offsetFrom, from[0] - offset, from[1])
      vec2.min(min, min, offsetFrom)
      vec2.max(max, max, from)
      const to :OutputTo[] = []
      const addEdge = (input :InputEdge<any>) => {
        let targetId :string
        let outputKey :string|undefined
        if (Array.isArray(input)) {
          [targetId, outputKey] = input
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
        if (!outputKey) outputKey = targetEdges.getDefaultOutputKey()
        const target = outputList.getElement(outputKey)
        if (target) {
          const toPos = vec2.fromValues(
            target.x + target.width - view.x,
            target.y + target.height / 2 - view.y,
          )
          const style = targetEdges.getOutputStyle(outputKey)
          if (!this._styleRemovers.has(style)) {
            const remover = style.onValue(() => this.dirty())
            this._styleRemovers.set(style, remover)
            this.disposer.add(remover)
          }
          to.push([[inputKey, targetId, outputKey], toPos, style])
          vec2.set(offsetTo, toPos[0] + offset, toPos[1])
          vec2.min(min, min, toPos)
          vec2.max(max, max, offsetTo)
        }
      }
      const inputModel = this._inputData.resolve(inputKey)
      const multiple = inputModel.resolve("multiple" as Spec<Value<boolean>>)
      if (multiple.current) {
        if (Array.isArray(input)) input.forEach(addEdge)
      } else {
        addEdge(input)
      }
      this._edges.push({from, to})
    }
    if (min[0] <= max[0] && min[1] <= max[1]) {
      const expand = Math.ceil(Math.max(this._lineWidth.current, this._outlineWidth.current) / 2)
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

  protected relayout () {
    this._state.update(this.computeState)
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    if (this._edges.length === 0) return
    const view = this.requireParent as GraphView
    canvas.translate(view.x, view.y)
    canvas.lineWidth = this._lineWidth.current
    const outlineWidth = this._outlineWidth.current
    const off = this._controlPointOffset.current
    for (const edge of this._edges) {
      for (const [keys, to, style] of edge.to) {
        canvas.strokeStyle = style.current
        canvas.beginPath()
        canvas.moveTo(edge.from[0], edge.from[1])
        canvas.bezierCurveTo(edge.from[0] - off, edge.from[1], to[0] + off, to[1], to[0], to[1])
        if (outlineWidth && dataEquals(keys, this._hoverKeys.current)) {
          canvas.lineWidth = outlineWidth
          canvas.globalAlpha = this._outlineAlpha.current
          canvas.stroke()
          canvas.lineWidth = this._lineWidth.current
          canvas.globalAlpha = 1
        }
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
  edge? :EdgeStyle
  outlineWidth? :number
  outlineAlpha? :number
  cursor? :string
}

/** Visualizes a single node terminal. */
export interface TerminalConfig extends ElementConfig {
  type :"terminal"
  direction :"input" | "output"
  editable :Spec<Value<boolean>>
  value :Spec<Value<string>>
  style :PMap<TerminalStyle>
}

export const TerminalStyleScope = {id: "terminal", states: ["normal", "hovered", "targeted"]}

const expandedBounds = rect.create()
const endpointBounds = rect.create()

export class Terminal extends Element {
  readonly targeted = Mutable.local(false)

  private readonly _state = Mutable.local("normal")
  private readonly _hovered = Mutable.local(false)
  private readonly _name :Value<string>
  private readonly _editable :Value<boolean>
  private readonly _value :Value<string>
  private readonly _multiple? :Value<boolean>
  private readonly _connections? :Mutable<InputValue>
  private readonly _radius = this.observe(5)
  private readonly _outlineWidth = this.observe(0)
  private readonly _outlineAlpha = this.observe(1)
  private _endpoint? :vec2

  constructor (ctx :ElementContext, parent :Element, readonly config :TerminalConfig) {
    super(ctx, parent, config)
    this._name = ctx.model.resolve("name" as Spec<Value<string>>)
    this._value = ctx.model.resolve(config.value)
    this._editable = ctx.model.resolve(config.editable)
    if (config.direction === "input") {
      this._multiple = ctx.model.resolve("multiple" as Spec<Value<boolean>>)
      this._connections = ctx.model.resolve("value" as Spec<Mutable<InputValue>>)
    }
    this.disposer.add(this._value.onValue(() => this.dirty()))
    const updateState = () => this._state.update(this.computeState)
    this.disposer.add(this._hovered.onValue(updateState))
    this.disposer.add(this.targeted.onValue(updateState))
    this.disposer.add(this.state.onValue(state => {
      const style = this.getStyle(this.config.style, state)
      this._radius.update(style.radius === undefined ? 5 : style.radius)
      this._outlineWidth.update(style.outlineWidth === undefined ? 0 : style.outlineWidth)
      this._outlineAlpha.update(style.outlineAlpha === undefined ? 1 : style.outlineAlpha)
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
  get edgeControlPointOffset () {
    const style = this.style
    return style.edge && style.edge.controlPointOffset !== undefined
      ? style.edge.controlPointOffset
      : 40
  }
  get edgeLineWidth () {
    const style = this.style
    return style.edge && style.edge.lineWidth !== undefined ? style.edge.lineWidth : 1
  }
  get edgeOutlineWidth () {
    const style = this.style
    return style.edge && style.edge.outlineWidth !== undefined ? style.edge.outlineWidth : 0
  }
  get edgeOutlineAlpha () {
    const style = this.style
    return style.edge && style.edge.outlineAlpha !== undefined ? style.edge.outlineAlpha : 1
  }

  handleMouseEnter (event :MouseEvent, pos :vec2) { this._hovered.update(true) }
  handleMouseLeave (event :MouseEvent, pos :vec2) { this._hovered.update(false) }

  maybeHandleMouseDown (event :MouseEvent, pos :vec2) {
    return rect.contains(this.expandBounds(this.bounds), pos)
      ? this.handleMouseDown(event, pos)
      : undefined
  }
  handleMouseDown (event :MouseEvent, pos :vec2) {
    if (!this._editable.current) return
    const endpoint = this._endpoint = vec2.clone(pos)
    this.dirty()
    // move node to end of view so that dragged edge is always on top of other nodes
    let ancestor = this.parent!
    let id = ""
    while (!(ancestor instanceof GraphView)) {
      if (ancestor instanceof NodeView) id = ancestor.id
      ancestor = ancestor.parent!
    }
    const graphView = ancestor as GraphView
    const elements = graphView.elements.get(id)!
    const index = graphView.contents.lastIndexOf(elements.node)
    const lastIndex = graphView.contents.length - 1
    if (index !== lastIndex) {
      const tmp = graphView.contents[lastIndex]
      graphView.contents[lastIndex] = elements.node
      graphView.contents[index] = tmp
      tmp.dirty()
    }
    this.setCursor(this, "move")
    const region = rect.create()
    const elementPos = vec2.create()
    let targetTerminal :Terminal|undefined
    const visitOver = (pos :vec2) => {
      const radius = this._radius.current
      let closestTerminal :Terminal|undefined
      let closestDistance = Infinity
      graphView.applyToIntersecting(
        rect.set(region, pos[0] - radius, pos[1] - radius, radius * 2, radius * 2),
        (element :Element) => {
          if (!(element instanceof Terminal && element.sign === -this.sign)) return
          const distance = vec2.distance(pos, element.pos(elementPos))
          if (distance < closestDistance) {
            closestTerminal = element
            closestDistance = distance
          }
        },
      )
      if (closestTerminal === targetTerminal) return
      if (targetTerminal) targetTerminal.targeted.update(false)
      targetTerminal = closestTerminal
      if (targetTerminal) targetTerminal.targeted.update(true)
    }
    visitOver(pos)
    const cleanup = () => {
      this.dirty()
      this._endpoint = undefined
      this.clearCursor(this)
      if (targetTerminal) targetTerminal.targeted.update(false)
    }
    return {
      move: (event :MouseEvent, pos :vec2) => {
        this.dirty()
        vec2.copy(endpoint, pos)
        this.dirty()
        visitOver(pos)
      },
      release: () => {
        cleanup()
        if (targetTerminal) targetTerminal._connect(this)
      },
      cancel: cleanup,
    }
  }

  private _connect (terminal :Terminal) {
    // always process on input
    if (this.config.direction === "output") {
      terminal._connect(this)
      return
    }
    if (this._multiple!.current) {
      const current = this._connections!.current || []
      this._connections!.update(current.concat([terminal._getInputValue()]))
    } else {
      this._connections!.update(terminal._getInputValue())
    }
  }

  private _getInputValue () {
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor instanceof NodeView) return [ancestor.id, this._name.current]
    }
    throw new Error("Missing NodeView ancestor")
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    if (rect.contains(this.expandBounds(this.bounds), pos) && this.visible.current) op(this)
  }
  applyToIntersecting (region :rect, op :(element :Element) => void) {
    if (rect.intersects(this.expandBounds(this.bounds), region) && this.visible.current) op(this)
  }

  expandBounds (bounds :rect) :rect {
    const radius = this._radius.current
    const outlineWidth = this._outlineWidth.current
    const halfOutlineWidth = Math.round(outlineWidth/2)
    const radiusWidth = 2 * radius + outlineWidth
    const halfRadiusWidth = radius + halfOutlineWidth
    rect.set(
      expandedBounds,
      bounds[0] + radius * (this.sign - 1) - halfOutlineWidth,
      bounds[1] - halfRadiusWidth,
      radiusWidth,
      radiusWidth,
    )
    if (!this._endpoint) return expandedBounds
    const controlPointOffset = this.edgeControlPointOffset
    const lineWidth = Math.max(this.edgeLineWidth, this.edgeOutlineWidth)
    const halfLineWidth = Math.round(lineWidth/2)
    rect.union(
      expandedBounds,
      expandedBounds,
      rect.set(
        endpointBounds,
        this.x + controlPointOffset * this.sign - halfLineWidth,
        this.y - halfLineWidth,
        radiusWidth,
        radiusWidth,
      ),
    )
    rect.union(
      expandedBounds,
      expandedBounds,
      rect.set(
        endpointBounds,
        this._endpoint[0] - controlPointOffset * this.sign - halfLineWidth,
        this._endpoint[1] - halfLineWidth,
        radiusWidth,
        radiusWidth,
      ),
    )
    return rect.union(
      expandedBounds,
      expandedBounds,
      rect.set(
        endpointBounds,
        this._endpoint[0] - halfRadiusWidth,
        this._endpoint[1] - halfRadiusWidth,
        radiusWidth,
        radiusWidth,
      ),
    )
  }

  protected get computeState () :string {
    return this.targeted.current ? "targeted" : this._hovered.current ? "hovered" : "normal"
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    dim2.set(into, 0, 0)
  }

  protected relayout () {}

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    const style = this._value.current
    canvas.strokeStyle = style
    canvas.fillStyle = style
    if (this._endpoint) {
      const controlPointOffset = this.edgeControlPointOffset
      canvas.beginPath()
      canvas.moveTo(this.x, this.y)
      const min = Math.min(this.x, this._endpoint[0])
      const max = Math.max(this.x, this._endpoint[0])
      canvas.bezierCurveTo(
        clamp(this.x + controlPointOffset * this.sign, min, max),
        this.y,
        clamp(this._endpoint[0] - controlPointOffset * this.sign, min, max),
        this._endpoint[1],
        this._endpoint[0],
        this._endpoint[1],
      )
      const outlineWidth = this.edgeOutlineWidth
      if (outlineWidth) {
        canvas.lineWidth = outlineWidth
        canvas.globalAlpha = this.edgeOutlineAlpha
        canvas.stroke()
        canvas.globalAlpha = 1
      }
      canvas.lineWidth = this.edgeLineWidth
      canvas.stroke()
      canvas.lineWidth = 1
    }
    this._drawTerminal(canvas, this.x + this._radius.current * this.sign, this.y)
    if (this._endpoint) {
      this._drawTerminal(canvas, this._endpoint[0], this._endpoint[1])
    }
  }

  _drawTerminal (canvas :CanvasRenderingContext2D, x :number, y :number) {
    canvas.beginPath()
    const radius = this._radius.current
    const outlineWidth = this._outlineWidth.current
    const outlineAlpha = this._outlineAlpha.current
    canvas.arc(x, y, radius, 0, 2 * Math.PI)
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
