import {dataCopy, dataEquals} from "../core/data"
import {dim2, rect, vec2} from "../core/math"
import {Mutable, Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {PMap, Remover, getValue} from "../core/util"
import {GraphConfig, getImplicitNodeId} from "../graph/graph"
import {InputEdge} from "../graph/node"
import {Box} from "./box"
import {createDropdownItemConfig} from "./dropdown"
import {Element, ElementConfig, ElementContext, PointerInteraction, Observer} from "./element"
import {AbsConstraints, AbsGroup, AxisConfig, VGroup, OffAxisPolicy} from "./group"
import {VList} from "./list"
import {Action, Model, ReadableElementsModel, ElementsModel, Spec, dataModel} from "./model"
import {InputValue, NodeCopier, NodeCreator, NodeEdit} from "./node"
import {Panner} from "./scroll"
import {BackgroundConfig, BorderConfig, NoopDecor, addDecorationBounds} from "./style"

/** A navigable graph viewer. */
export interface GraphViewerConfig extends ElementConfig {
  type :"graphViewer"
  editable? :Spec<Value<boolean>>
}

const clipboard = Mutable.local<GraphConfig|undefined>(undefined)

export class GraphViewer extends VGroup {
  readonly contents :Element[] = []
  readonly activePage :Mutable<string>
  readonly selection :MutableSet<string>
  readonly push :(id :string) => void
  readonly applyEdit :(edit :NodeEdit) => void

  private _editable = Value.constant(false)
  private _graphModel :Value<Model>
  private _nodeCreator :Mutable<NodeCreator>
  private _nodeFunctionRemover? :Remover

  constructor (readonly ctx :ElementContext, parent :Element, readonly config :GraphViewerConfig) {
    super(ctx, parent, config)
    if (this.config.editable) this._editable = ctx.model.resolve(this.config.editable)
    const typeCategoryModel = ctx.model.resolve<ElementsModel<string>>("typeCategoryModel")
    const subgraphCategoryModel = ctx.model.resolve<ElementsModel<string>>("subgraphCategoryModel")
    this._graphModel = ctx.model.resolve<Value<Model>>("graphModel")
    this._nodeCreator = ctx.model.resolve<Mutable<NodeCreator>>("nodeCreator")
    const remove = ctx.model.resolve<Action>("remove")
    this.activePage = ctx.model.resolve<Mutable<string>>("activePage")
    this.selection = ctx.model.resolve<MutableSet<string>>("selection")
    this.push = ctx.model.resolve<(id :string) => void>("push")
    this.applyEdit = ctx.model.resolve<(edit :NodeEdit) => void>("applyEdit")
    const haveSelection = this.selection.fold(false, (value, set) => set.size > 0)
    const editableSelection = Value.join(haveSelection, this._editable).map(
      ([selection, editable]) => selection && editable,
    )
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
              type: "menuBar",
              offPolicy: "stretch",
              element: {
                type: "menu",
                contents: {
                  type: "box",
                  contents: {type: "label", text: "name"},
                },
                // max category depth of two for the moment
                element: createDropdownItemConfig(2, "menuItem"),
                model: "model",
                shortcutsModel: "shortcutsModel",
              },
              model: dataModel({
                graph: {
                  name: Value.constant("Graph"),
                  model: dataModel({
                    clearAll: {
                      name: Value.constant("Clear All"),
                      enabled: this._editable,
                      action: this._createGraphModelAction(model => {
                        model.resolve<Action>("removeAll")()
                      }),
                    },
                    sep1: {separator: Value.constant(true)},
                    import: {
                      name: Value.constant("Import..."),
                      enabled: this._editable,
                      action: () => this._import(),
                    },
                    export: {
                      name: Value.constant("Export..."),
                      action: () => this._export(),
                    },
                    sep2: {separator: Value.constant(true)},
                    close: {
                      name: Value.constant("Close"),
                      shortcut: Value.constant("closeTab"),
                    },
                  }),
                  shortcutsModel: dataModel({
                    closeTab: {action: remove},
                  }),
                },
                edit: {
                  name: Value.constant("Edit"),
                  model: dataModel({
                    undo: {
                      name: Value.constant("Undo"),
                      shortcut: Value.constant("undo"),
                    },
                    redo: {
                      name: Value.constant("Redo"),
                      shortcut: Value.constant("redo"),
                    },
                    sep1: {separator: Value.constant(true)},
                    cut: {
                      name: Value.constant("Cut"),
                      shortcut: Value.constant("cut"),
                    },
                    copy: {
                      name: Value.constant("Copy"),
                      shortcut: Value.constant("copy"),
                    },
                    paste: {
                      name: Value.constant("Paste"),
                      shortcut: Value.constant("paste"),
                    },
                    delete: {
                      name: Value.constant("Delete"),
                      shortcut: Value.constant("delete"),
                    },
                    sep2: {separator: Value.constant(true)},
                    selectAll: {
                      name: Value.constant("Select All"),
                      action: this._createPageModelAction(model => {
                        const nodesModel = model.resolve<ElementsModel<string>>("nodesModel")
                        nodesModel.keys.once(keys => {
                          for (const key of keys) this.selection.add(key)
                        })
                      }),
                    },
                  }),
                  shortcutsModel: dataModel({
                    undo: {
                      enabled: ctx.model.resolve<Value<boolean>>("canUndo"),
                      action: ctx.model.resolve<Action>("undo"),
                    },
                    redo: {
                      enabled: ctx.model.resolve<Value<boolean>>("canRedo"),
                      action: ctx.model.resolve<Action>("redo"),
                    },
                    cut: {
                      enabled: editableSelection,
                      action: this._createPageModelAction(model => {
                        clipboard.update(dataCopy(
                          model.resolve<NodeCopier>("copyNodes")(this.selection),
                        ))
                        const page = model.resolve<Value<string>>("id").current
                        this.applyEdit({page, selection: new Set(), remove: this.selection})
                      }),
                    },
                    copy: {
                      enabled: haveSelection,
                      action: this._createPageModelAction(model => {
                        clipboard.update(dataCopy(
                          model.resolve<NodeCopier>("copyNodes")(this.selection),
                        ))
                      }),
                    },
                    paste: {
                      enabled: Value.join2(clipboard, this._editable).map(
                        ([clipboard, editable]) => clipboard && editable,
                      ),
                      action: this._createPageModelAction(model => {
                        this._nodeCreator.current(dataCopy(clipboard.current!))
                      }),
                    },
                    delete: {
                      enabled: editableSelection,
                      action: this._createPageModelAction(model => {
                        const page = model.resolve<Value<string>>("id").current
                        this.applyEdit({page, selection: new Set(), remove: this.selection})
                      }),
                    },
                  }),
                },
                view: {
                  name: Value.constant("View"),
                  model: dataModel({
                    zoomIn: {
                      name: Value.constant("Zoom In"),
                      shortcut: Value.constant("zoomIn"),
                    },
                    zoomOut: {
                      name: Value.constant("Zoom Out"),
                      shortcut: Value.constant("zoomOut"),
                    },
                    zoomReset: {
                      name: Value.constant("Reset Zoom"),
                      shortcut: Value.constant("zoomReset"),
                    },
                    zoomToFit: {
                      name: Value.constant("Zoom to Fit"),
                      shortcut: Value.constant("zoomToFit"),
                    },
                  }),
                  shortcutsModel: dataModel({
                    zoomIn: {
                      action: this._createPannerAction(panner => panner.zoom(1)),
                    },
                    zoomOut: {
                      action: this._createPannerAction(panner => panner.zoom(-1)),
                    },
                    zoomReset: {
                      action: this._createPannerAction(panner => panner.resetZoom()),
                    },
                    zoomToFit: {
                      action: this._createPannerAction(panner => panner.zoomToFit()),
                    },
                  }),
                },
                node: {
                  name: Value.constant("Node"),
                  model: typeCategoryModel,
                },
                subgraph: {
                  name: Value.constant("Subgraph"),
                  model: subgraphCategoryModel,
                },
              }),
            },
            {
              type: "spacer",
              width: 10,
              constraints: {stretch: true},
            },
            {
              type: "button",
              onClick: "pop",
              visible: "canPop",
              contents: {
                type: "box",
                contents: {type: "label", text: Value.constant("←")},
              },
            },
            {
              type: "button",
              onClick: remove,
              contents: {
                type: "box",
                contents: {type: "label", text: Value.constant("×")},
              },
            },
          ],
        },
        style: {halign: "stretch"},
      }),
    )
    this.disposer.add(this._graphModel.onValue(model => {
      const oldContents = this.contents[1]
      if (oldContents) oldContents.dispose()
      this.contents[1] = this._createElement(model)
      this._updateNodeFunctions(model)
      this.invalidate()
    }))
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }

  private _updateNodeFunctions (graphModel :Model) {
    if (this._nodeFunctionRemover) {
      this._nodeFunctionRemover()
      this.disposer.remove(this._nodeFunctionRemover)
    }
    const pagesModel = graphModel.resolve<ElementsModel<string>>("pagesModel")
    this.disposer.add(this._nodeFunctionRemover = this.activePage.onValue(activePage => {
      const pageModel = pagesModel.resolve(activePage)
      const createNodes = pageModel.resolve<NodeCreator>("createNodes")
      this._nodeCreator.update((config :GraphConfig) => {
        const ids = createNodes(config)
        const graphView = this.findChild("graphView") as GraphView
        graphView.repositionNodes(ids)
        return ids
      })
    }))
  }

  private _createPannerAction (op :(panner :Panner) => void) :Action {
    return () => op(this.contents[1].findChild("panner") as Panner)
  }

  private _createGraphModelAction (op :(model :Model) => void) :Action {
    return () => op(this._graphModel.current)
  }

  private _createPageModelAction (op :(model :Model) => void) :Action {
    return () => {
      const graphModel = this._graphModel.current
      const pagesModel = graphModel.resolve<ElementsModel<string>>("pagesModel")
      op(pagesModel.resolve(this.activePage.current))
    }
  }

  private _import () {
    const input = document.createElement("input")
    input.setAttribute("type", "file")
    input.setAttribute("accept", "application/json")
    input.addEventListener("change", event => {
      if (!input.files || input.files.length === 0) return
      const reader = new FileReader()
      reader.onload = () => {
        const json = JSON.parse(reader.result as string)
        const model = this._graphModel.current
        model.resolve<(json :GraphConfig) => void>("fromJSON")(json)
      }
      reader.readAsText(input.files[0])
    })
    input.click()
  }

  private _createElement (model :Model) :Element {
    return this.ctx.elem.create(this.ctx.remodel(model), this, {
      type: "tabbedPane",
      tabElement: {
        type: "box",
        contents: {
          type: "row",
          contents: [
            {
              type: "editableLabel",
              text: "name",
              contents: {
                type: "box",
                contents: {type: "label", overrideParentState: "normal", scopeId: "tab"},
              },
            },
            {
              type: "button",
              visible: "removable",
              contents: {
                type: "box",
                scopeId: "removeTabButton",
                contents: {type: "label", text: Value.constant("×")},
              },
              onClick: "remove",
            },
          ],
        }
      },
      contentElement: {
        type: "panner",
        contents: {type: "graphView", editable: this._editable},
        constraints: {stretch: true},
      },
      addTabElement: {
        type: "button",
        contents: {
          type: "box",
          scopeId: "addTabButton",
          contents: {type: "label", text: Value.constant("✚")},
        },
        onClick: "createPage",
      },
      model: "pagesModel",
      key: "id",
      activeKey: this.activePage,
      updateOrder: "updateOrder",
      constraints: {stretch: true},
    })
  }

  private _export () {
    const model = this._graphModel.current
    const json = model.resolve<() => GraphConfig>("toJSON")()
    const file = new File([JSON.stringify(json)], "graph.json", {type: "application/octet-stream"})
    open(URL.createObjectURL(file), "_self")
    // TODO: call revokeObjectURL when finished with download
  }
}

/** Visualizes a graph. */
export interface GraphViewConfig extends ElementConfig {
  type :"graphView"
  style :PMap<GraphViewStyle>
  editable :Spec<Value<boolean>>
}

export interface GraphViewStyle {
  selectBackground? :Spec<BackgroundConfig>
  selectBorder? :Spec<BorderConfig>
}

const tmpd = dim2.create()
const tmpr = rect.create()

export class GraphView extends AbsGroup {
  readonly elements = new Map<string, {node :Box, edges :EdgeView}>()
  readonly contents :Element[] = []

  private _select? :rect
  private _selectBackground = this.observe(NoopDecor)
  private _selectBorder = this.observe(NoopDecor)
  private readonly _lastContaining = vec2.create()

  constructor (ctx :ElementContext, parent :Element, readonly config :GraphViewConfig) {
    super(ctx, parent, config)
    const nodesModel = ctx.model.resolve<ElementsModel<string>>("nodesModel")
    let models :Model[] | null = []
    const editable = ctx.model.resolve(this.config.editable)
    this.disposer.add(nodesModel.keys.onValue(keys => {
      const {contents, elements} = this
      // first dispose no longer used elements
      const kset = new Set(keys)
      for (const [ekey, elems] of elements.entries()) {
        if (!kset.has(ekey)) {
          elements.delete(ekey)
          // invalidate the node so that anything relying on its outputs will be updated
          elems.node.invalidate()
          elems.node.dispose()
          elems.edges.dispose()
        }
      }
      // now create/reuse elements for the new keys
      contents.length = 0
      for (const key of kset) {
        let elem = this.elements.get(key)
        if (!elem) {
          const model = nodesModel.resolve(key)
          const position = model.resolve<Value<[number, number]>>("position").current
          // if we encounter any valid positions, don't layout automatically
          if (position[0] > 0 || position[1] > 0) models = null
          if (models) models.push(model)
          const subctx = ctx.remodel(model)
          elem = {
            node: ctx.elem.create(subctx, this, {
              type: "box",
              constraints: {position},
              scopeId: "node",
              contents: {type: "nodeView", offPolicy: "stretch", editable},
            }) as Box,
            edges: ctx.elem.create(subctx, this, {type: "edgeView", editable}) as EdgeView,
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

    const style = this.getStyle(this.config.style, this.state.current)
    if (style.selectBackground) {
      this._selectBackground.observe(ctx.style.resolveBackground(style.selectBackground))
    }
    if (style.selectBorder) {
      this._selectBorder.observe(ctx.style.resolveBorder(style.selectBorder))
    }
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    const applied = super.applyToContaining(canvas, pos, op)
    vec2.set(this._lastContaining, pos[0] - this.x, pos[1] - this.y)
    return applied
  }

  repositionNodes (ids :Map<string, string>) {
    // find the centroid
    let cx = 0
    let cy = 0
    for (const id of ids.values()) {
      const nodeView = this.elements.get(id)!.node.contents as NodeView
      const position = nodeView.position.current
      cx += position[0]
      cy += position[1]
    }
    // now translate the centroid to the last mouse position
    // (making sure y is non-negative)
    const dx = this._lastContaining[0] - cx / ids.size
    const dy = Math.max(this._lastContaining[1], 0) - cy / ids.size
    for (const id of ids.values()) {
      const nodeView = this.elements.get(id)!.node.contents as NodeView
      const position = nodeView.position
      position.update([position.current[0] + dx, position.current[1] + dy])
    }
  }

  maybeHandlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    // just assume that anything in the scroll view is in the graph view
    return this.handlePointerDown(event, pos)
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const graphViewer = getGraphViewer(this)
    const interaction = super.handlePointerDown(event, pos)
    if (interaction) {
      if (interaction.type !== "node") graphViewer.selection.clear()
      return interaction
    }
    graphViewer.selection.clear()
    if (!event.shiftKey) {
      return
    }
    this.root.focus.update(undefined)
    this.root.setCursor(this, "crosshair")
    const [ox, oy] = pos
    const select = this._select = rect.fromValues(ox, oy, 0, 0)
    let hovered = new Set<NodeView>()
    let nextHovered = new Set<NodeView>()
    const cleanup = () => {
      for (const element of hovered) element.hovered.update(false)
      this.root.clearCursor(this)
      this.dirty(this._expandSelect(select))
      this._select = undefined
    }
    return {
      move: (event, pos) => {
        this.dirty(this._expandSelect(select))
        const [nx, ny] = pos
        const x = Math.min(ox, nx)
        const y = Math.min(oy, ny)
        rect.set(select, x, y, Math.max(ox, nx) - x, Math.max(oy, ny) - y)
        const expanded = this._expandSelect(select)
        this.dirty(expanded)

        this.applyToIntersecting(expanded, element => {
          if (element instanceof NodeView) {
            element.hovered.update(true)
            nextHovered.add(element)
          }
        })
        for (const element of hovered) {
          if (!nextHovered.has(element)) element.hovered.update(false)
        }
        [hovered, nextHovered] = [nextHovered, hovered]
        nextHovered.clear()
      },
      release: () => {
        for (const element of hovered) graphViewer.selection.add(element.id)
        cleanup()
      },
      cancel: cleanup,
    }
  }

  expandBounds (bounds :rect) :rect {
    const base = super.expandBounds(bounds)
    if (!this._select) return base
    return rect.union(this._expandedBounds, base, this._expandSelect(this._select))
  }

  private _expandSelect (select :rect) :rect {
    return addDecorationBounds(
      tmpr,
      select,
      this._selectBackground.current,
      this._selectBorder.current,
    )
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    if (!this._select) return
    canvas.translate(this._select[0], this._select[1])
    this._selectBackground.current.render(canvas, dim2.set(tmpd, this._select[2], this._select[3]))
    this._selectBorder.current.render(canvas, dim2.set(tmpd, this._select[2], this._select[3]))
    canvas.translate(-this._select[0], -this._select[1])
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
          elements :Box[] = []
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
            const size = element.preferredSize(-1, -1)
            const constraints = element.config.constraints as AbsConstraints
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
    const placed = new Set<Box>()

    // create layout nodes, note roots
    for (let ii = 0; ii < keys.length; ii++) {
      const key = keys[ii]
      const model = models[ii]
      const inputsModel = model.resolve<ReadableElementsModel<string>>("inputsModel")
      const inputs :string[] = []
      const pushInput = (edge :InputEdge<any>) => {
        let nodeId = Array.isArray(edge) ? edge[0] : edge
        if (nodeId === undefined || nodeId === null) return
        if (typeof nodeId !== "string") nodeId = getImplicitNodeId(nodeId)
        inputs.push(nodeId)
        roots.delete(nodeId)
      }
      for (const inputKey of inputsModel.keys.current) {
        // remove anything from roots that's used as an input
        const data = inputsModel.resolve(inputKey)
        const value = data.resolve<Value<InputValue>>("value")
        const multiple = data.resolve<Value<boolean>>("multiple")
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
  type :"nodeView"
  editable :Spec<Value<boolean>>
}

export const NodeViewStyleScope = {id: "nodeView", states: ["normal", "hovered", "selected"]}

function isEmpty (iable :Iterable<any>) :boolean {
  for (const _ of iable) return false
  return true
}

export class NodeView extends VGroup {
  readonly id :string
  readonly contents :Element[] = []
  readonly hovered = Mutable.local(false)
  readonly position :Mutable<[number, number]>

  private readonly _state = Mutable.local("normal")
  private readonly _editable :Value<boolean>

  constructor (ctx :ElementContext, parent :Element, readonly config :NodeViewConfig) {
    super(ctx, parent, config)
    this.id = ctx.model.resolve<Value<string>>("id").current
    this._editable = ctx.model.resolve(this.config.editable)
    this.position = ctx.model.resolve<Mutable<[number, number]>>("position")
    this.disposer.add(this.position.onChange(position => {
      const constraints = parent.config.constraints as AbsConstraints
      constraints.position = position
      parent.invalidate()
    }))
    const updateState = () => this._state.update(this.computeState)
    this.disposer.add(this.hovered.onValue(updateState))
    this.disposer.add(getGraphViewer(this).selection.onValue(updateState))

    const bodyContents :ElementConfig[] = []
    if (ctx.model.resolve<Value<string>>("type").current === "subgraph") {
      bodyContents.push({
        type: "button",
        onClick: () => getGraphViewer(parent).push(this.id),
        contents: {
          type: "box",
          scopeId: "nodeButton",
          contents: {type: "label", text: Value.constant("Open")},
        },
      })
    }
    const propertiesModel = ctx.model.resolve<ElementsModel<string>>("propertiesModel")
    bodyContents.push({
      type: "propertyView",
      visible: Value.from(propertiesModel.keys.map(keys => !isEmpty(keys)), false),
      gap: 2,
      scopeId: "nodeProperties",
      offPolicy: "stretch",
      editable: this._editable,
      model: "propertiesModel",
    })
    const inputsModel = ctx.model.resolve<ElementsModel<string>>("inputsModel")
    const inputsVisible = Value.from(inputsModel.keys.map(keys => !isEmpty(keys)), false)
    const outputModel = ctx.model.resolve<ElementsModel<string>>("outputsModel")
    const outputsVisible = Value.from(outputModel.keys.map(keys => !isEmpty(keys)), false)
    const terminalsVisible = Value.join(inputsVisible, outputsVisible).map(
      ([inputs, outputs]) => inputs || outputs,
    )
    bodyContents.push({
      type: "row",
      visible: terminalsVisible,
      gap: 5,
      contents: [
        {
          type: "box",
          visible: inputsVisible,
          scopeId: "nodeEdges",
          constraints: {stretch: true},
          style: {halign: "left"},
          contents: {
            type: "vlist",
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
            model: "inputsModel",
          },
        },
        {
          type: "box",
          visible: outputsVisible,
          scopeId: "nodeEdges",
          constraints: {stretch: true},
          style: {halign: "right"},
          contents: {
            type: "vlist",
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
            model: "outputsModel",
          },
        }
      ],
    })
    const name = ctx.model.resolve<Value<string>>("name")
    this.contents.push(
      ctx.elem.create(ctx, this, {
        type: "box",
        scopeId: "nodeHeader",
        contents: name instanceof Mutable
          ? {
            type: "editableLabel",
            text: name,
            contents: {
              type: "box",
              contents: {type: "label", overrideParentState: "normal", scopeId: "nodeHeader"},
            },
          } : {type: "label", overrideParentState: "normal", text: name},
      }),
      ctx.elem.create(ctx, this, {
        type: "box",
        scopeId: "nodeBody",
        style: {halign: "stretch"},
        contents: {
          type: "column",
          overrideParentState: "normal",
          offPolicy: "stretch",
          gap: 5,
          contents: bodyContents,
        },
      }),
    )
  }

  get styleScope () { return NodeViewStyleScope }
  get state () :Value<string> { return this._state }

  handleMouseEnter (event :MouseEvent, pos :vec2) { this.hovered.update(true) }
  handleMouseLeave (event :MouseEvent, pos :vec2) { this.hovered.update(false) }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    // move node to end of view
    const graphView = getGraphView(this)
    const parent = this.requireParent
    const index = graphView.contents.lastIndexOf(parent)
    const lastIndex = graphView.contents.length - 1
    if (index !== lastIndex) {
      const tmp = graphView.contents[lastIndex]
      graphView.contents[lastIndex] = parent
      graphView.contents[index] = tmp
      parent.dirty()
      tmp.dirty()
    }
    const interaction = super.handlePointerDown(event, pos)
    if (interaction || !this._editable.current) return interaction
    const basePos = vec2.clone(pos)
    const graphViewer = getGraphViewer(graphView)
    if (event.ctrlKey) {
      if (graphViewer.selection.has(this.id)) graphViewer.selection.delete(this.id)
      else graphViewer.selection.add(this.id)

    } else if (!graphViewer.selection.has(this.id)) {
      graphViewer.selection.clear()
      graphViewer.selection.add(this.id)
    }
    const origins = new Map<string, number[]>()
    for (const key of graphViewer.selection) {
      const constraints = graphView.elements.get(key)!.node.config.constraints as AbsConstraints
      const position = constraints.position!
      origins.set(key, position.slice())
    }
    this.root.focus.update(undefined)
    const cancel = () => this.clearCursor(this)
    return {
      type: "node",
      move: (event, pos) => {
        this.setCursor(this, "move")
        const dx = pos[0] - basePos[0]
        const dy = pos[1] - basePos[1]
        for (const [key, origin] of origins) {
          const node = graphView.elements.get(key)!.node.contents as NodeView
          node.position.update([origin[0] + dx, origin[1] + dy])
        }
      },
      release: cancel,
      cancel,
    }
  }

  protected get computeState () :string {
    return getGraphViewer(this).selection.has(this.id)
      ? "selected"
      : this.hovered.current ? "hovered" : "normal"
  }
}

function getGraphViewer (element :Element) :GraphViewer {
  for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor instanceof GraphViewer) return ancestor
  }
  throw new Error("Element used outside GraphViewer")
}

function getGraphView (element :Element) :GraphView {
  for (let ancestor = element.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor instanceof GraphView) return ancestor
  }
  throw new Error("Element used outside GraphView")
}

/** Visualizes a node's input edges. */
export interface EdgeViewConfig extends ElementConfig {
  type :"edgeView"
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

export const EdgeViewStyleScope = {id: "edgeView", states: ["normal", "hovered"]}

const offsetFrom = vec2.create()
const offsetTo = vec2.create()

type EdgeKeys = [string, string, string]
type OutputTo = [EdgeKeys, vec2, vec2|undefined, Value<string>]

const nodesUsed = new Set<Element>()
const stylesUsed = new Set<Value<string>>()

const PICK_EXPANSION = 3
const DEFAULT_CONTROL_POINT_OFFSET = 30

export class EdgeView extends Element {
  private _nodeId :Value<string>
  private _editable :Value<boolean>
  private _defaultOutputKey :Value<string>
  private _inputsModel :ReadableElementsModel<string>
  private _inputs :Value<InputValue[]>
  private _outputsModel :ElementsModel<string>
  private _edges :{from :vec2, to :OutputTo[]}[] = []
  private readonly _state = Mutable.local("normal")
  private readonly _lineWidth = this.observe(1)
  private readonly _controlPointOffset = this.observe(DEFAULT_CONTROL_POINT_OFFSET)
  private readonly _outlineWidth = this.observe(0)
  private readonly _outlineAlpha = this.observe(1)
  private _hoverKeys :Observer<EdgeKeys|undefined> = this.observe(undefined)
  private _nodeRemovers :Map<Element, Remover> = new Map()
  private _styleRemovers :Map<Value<string>, Remover> = new Map()

  constructor (ctx :ElementContext, parent :Element, readonly config :EdgeViewConfig) {
    super(ctx, parent, config)
    this._nodeId = ctx.model.resolve<Value<string>>("id")
    this._editable = ctx.model.resolve(this.config.editable)
    this._defaultOutputKey = ctx.model.resolve<Value<string>>("defaultOutputKey")
    this._inputsModel = ctx.model.resolve<ReadableElementsModel<string>>("inputsModel")
    this._outputsModel = ctx.model.resolve<ElementsModel<string>>("outputsModel")
    this.invalidateOnChange(this._inputs = this._inputsModel.keys.switchMap(inputKeys => {
      return Value.join(...Array.from(inputKeys).map(
        inputKey => this._inputsModel.resolve(inputKey).resolve<Value<InputValue>>("value")
      ))
    }))
    this.disposer.add(this.state.onValue(state => {
      const style = this.style
      this._lineWidth.update(style.lineWidth === undefined ? 1 : style.lineWidth)
      this._controlPointOffset.update(
        style.controlPointOffset === undefined
          ? DEFAULT_CONTROL_POINT_OFFSET
          : style.controlPointOffset,
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
    return this._outputsModel.resolve(key).resolve<Value<string>>("style")
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    if (!(rect.contains(this.bounds, pos) && this.visible.current &&
          this._edges.length)) return false
    const view = this.requireParent as GraphView
    canvas.translate(view.x, view.y)
    const lineWidth = this._lineWidth.current * PICK_EXPANSION
    canvas.lineWidth = lineWidth
    canvas.globalAlpha = 0
    const outlineWidth = this._outlineWidth.current * PICK_EXPANSION
    const controlPointOffset = this._controlPointOffset.current
    let hoverKeys :EdgeKeys|undefined
    outerLoop: for (const edge of this._edges) {
      for (const [keys, to, mid] of edge.to) {
        canvas.beginPath()
        canvas.moveTo(edge.from[0], edge.from[1])
        const off = Math.min(Math.abs(edge.from[0] - to[0]), controlPointOffset)
        const offsetStartX = edge.from[0] - off
        const offsetEndX = to[0] + off
        if (mid) {
          canvas.bezierCurveTo(offsetStartX, edge.from[1], offsetStartX, mid[1], mid[0], mid[1])
          canvas.bezierCurveTo(offsetEndX, mid[1], offsetEndX, to[1], to[0], to[1])
        } else {
          canvas.bezierCurveTo(offsetStartX, edge.from[1], offsetEndX, to[1], to[0], to[1])
        }
        if (outlineWidth && dataEquals(keys, this._hoverKeys.current)) {
          canvas.lineWidth = outlineWidth
          canvas.stroke()
          canvas.lineWidth = lineWidth
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
    return true
  }

  handleMouseLeave (event :MouseEvent, pos :vec2) { this._hoverKeys.update(undefined) }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) {
    const keys = this._hoverKeys.current
    if (keys === undefined || !this._editable.current) return undefined
    const [inputKey, targetId, outputKey] = keys
    // sever the connection
    const input = this._inputsModel.resolve(inputKey)
    const multiple = input.resolve<Value<boolean>>("multiple")
    const value = input.resolve<Mutable<InputValue>>("value")
    if (multiple.current) {
      for (let ii = 0; ii < value.current.length; ii++) {
        let element = value.current[ii]
        let elementOutputKey :string|undefined
        if (Array.isArray(element)) [element, elementOutputKey] = element
        if (element === undefined || element === null) continue
        if (typeof element !== "string") element = getImplicitNodeId(element)
        if (
          element === targetId &&
          (elementOutputKey === undefined || elementOutputKey === outputKey)
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
    const outputs = node.findTaggedChild("outputs") as VList
    const terminal = outputs.elements.get(outputKey)!.findChild("terminal") as Terminal
    return terminal.handlePointerDown(event, pos)
  }

  protected get computeState () :string {
    return this._hoverKeys.current === undefined ? "normal" : "hovered"
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    // find corresponding node
    const node = this._getValidatedNode(this._nodeId.current)!
    const inputList = node.findTaggedChild("inputs") as VList

    this._edges.length = 0
    const min = vec2.fromValues(Infinity, Infinity)
    const max = vec2.fromValues(-Infinity, -Infinity)

    const view = this.requireParent as GraphView
    const offset = this._controlPointOffset.current
    nodesUsed.clear()
    nodesUsed.add(node)
    stylesUsed.clear()
    const inputKeys = Array.from(this._inputsModel.keys.current)
    const inputs = this._inputs.current
    for (let ii = 0; ii < inputKeys.length; ii++) {
      const input = inputs[ii]
      if (input === undefined || input === null) continue
      const inputKey = inputKeys[ii]
      const sourceList = inputList.contents[ii]
      const source = sourceList.findChild("terminal") as Terminal
      const from = vec2.fromValues(source.x - source.radius - view.x, source.y - view.y)
      vec2.set(offsetFrom, from[0] - offset, from[1])
      vec2.min(min, min, offsetFrom)
      vec2.max(max, max, from)
      const to :OutputTo[] = []
      const addEdge = (input :InputEdge<any>) => {
        let targetId :string
        let outputKey :string|undefined
        if (Array.isArray(input)) [input, outputKey] = input
        if (typeof input === "string") {
          targetId = input
        } else if (input !== undefined && input !== null) {
          targetId = getImplicitNodeId(input)
        } else {
          return true
        }
        const targetNode = this._getValidatedNode(targetId)
        if (!targetNode) return false
        nodesUsed.add(targetNode)
        const outputList = targetNode.findTaggedChild("outputs") as VList
        const targetEdges = this._requireEdges(targetId) as EdgeView
        if (!outputKey) outputKey = targetEdges.getDefaultOutputKey()
        const targetList = outputList.elements.get(outputKey)
        const target = targetList && targetList.findChild("terminal") as Terminal
        if (target) {
          const toPos = vec2.fromValues(target.x + target.radius - view.x, target.y - view.y)
          let midPos :vec2|undefined
          if (toPos[0] > from[0]) {
            midPos = vec2.fromValues(
              (from[0] + toPos[0]) / 2 - view.x,
              Math.max(rect.bottom(targetNode.bounds), rect.bottom(node.bounds)) + offset - view.y,
            )
            vec2.min(min, min, midPos)
            vec2.max(max, max, midPos)
          }
          const style = targetEdges.getOutputStyle(outputKey)
          stylesUsed.add(style)
          if (!this._styleRemovers.has(style)) {
            const remover = style.onValue(() => this.dirty())
            this._styleRemovers.set(style, remover)
            this.disposer.add(remover)
          }
          to.push([[inputKey, targetId, outputKey], toPos, midPos, style])
          vec2.set(offsetTo, toPos[0] + offset, toPos[1])
          vec2.min(min, min, toPos)
          vec2.max(max, max, offsetTo)
        }
        return true
      }
      const inputsModel = this._inputsModel.resolve(inputKey)
      const multiple = inputsModel.resolve<Value<boolean>>("multiple")
      const value = inputsModel.resolve<Mutable<InputValue>>("value")
      if (multiple.current) {
        if (Array.isArray(input)) {
          let newInput = input
          for (let ii = 0; ii < newInput.length; ii++) {
            if (!addEdge(newInput[ii])) {
              if (newInput === input) newInput = input.slice()
              newInput.splice(ii, 1)
              ii--
            }
          }
          if (newInput !== input) value.update(newInput)
        }
      } else if (!addEdge(input)) {
        value.update(undefined)
      }
      this._edges.push({from, to})
    }
    // remove any unused removers
    for (const [node, remover] of this._nodeRemovers) {
      if (!nodesUsed.has(node)) {
        remover()
        this.disposer.remove(remover)
        this._nodeRemovers.delete(node)
      }
    }
    // same with style removers
    for (const [style, remover] of this._styleRemovers) {
      if (!stylesUsed.has(style)) {
        remover()
        this.disposer.remove(remover)
        this._styleRemovers.delete(style)
      }
    }
    if (min[0] <= max[0] && min[1] <= max[1]) {
      const expand = Math.ceil(
        PICK_EXPANSION * Math.max(this._lineWidth.current, this._outlineWidth.current) / 2,
      )
      dim2.set(into, max[0] - min[0] + expand * 2, max[1] - min[1] + expand * 2)
      this.config.constraints = {position: [min[0] - expand, min[1] - expand]}
    } else {
      dim2.set(into, 0, 0)
    }
  }

  private _getValidatedNode (nodeId :string) :Element|undefined {
    const view = this.requireParent as GraphView
    const element = view.elements.get(nodeId)
    if (!element) return
    const node = element.node
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
    const controlPointOffset = this._controlPointOffset.current
    for (const edge of this._edges) {
      for (const [keys, to, mid, style] of edge.to) {
        canvas.strokeStyle = style.current
        canvas.beginPath()
        canvas.moveTo(edge.from[0], edge.from[1])
        const off = Math.min(Math.abs(edge.from[0] - to[0]), controlPointOffset)
        const offsetStartX = edge.from[0] - off
        const offsetEndX = to[0] + off
        if (mid) {
          canvas.bezierCurveTo(offsetStartX, edge.from[1], offsetStartX, mid[1], mid[0], mid[1])
          canvas.bezierCurveTo(offsetEndX, mid[1], offsetEndX, to[1], to[0], to[1])
        } else {
          canvas.bezierCurveTo(offsetStartX, edge.from[1], offsetEndX, to[1], to[0], to[1])
        }
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
    this._name = ctx.model.resolve<Value<string>>("name")
    this._value = ctx.model.resolve(config.value)
    this._editable = ctx.model.resolve(config.editable)
    if (config.direction === "input") {
      this._multiple = ctx.model.resolve<Value<boolean>>("multiple")
      this._connections = ctx.model.resolve<Mutable<InputValue>>("value")
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

  get radius () { return this._radius.current }
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
      : DEFAULT_CONTROL_POINT_OFFSET
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

  maybeHandlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) {
    return rect.contains(this.expandBounds(this.bounds), pos)
      ? this.handlePointerDown(event, pos)
      : undefined
  }
  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) {
    if (!this._editable.current) return
    this.root.focus.update(undefined)
    const endpoint = this._endpoint = vec2.clone(pos)
    this.dirty()
    const graphView = getGraphView(this)
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
      move: (event :MouseEvent|TouchEvent, pos :vec2) => {
        this.setCursor(this, "move")
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

  expandBounds (bounds :rect) :rect {
    const radius = this._radius.current
    const hoveredOutlineWidth = this.getStyle(this.config.style, "hovered").outlineWidth
    const outlineWidth = this._outlineWidth.current + getValue(hoveredOutlineWidth, 0) * 2
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
    const addControlPoint = (x :number, y :number) => {
      rect.union(
        expandedBounds,
        expandedBounds,
        rect.set(endpointBounds, x, y, radiusWidth, radiusWidth),
      )
    }
    const startX = bounds[0] + radius * this.sign
    const offsetStartX = startX + controlPointOffset * this.sign - halfLineWidth
    addControlPoint(offsetStartX, this.y - halfLineWidth)
    const offsetEndX = this._endpoint[0] - controlPointOffset * this.sign - halfLineWidth
    addControlPoint(offsetEndX, this._endpoint[1] - halfLineWidth)
    addControlPoint(this._endpoint[0] - halfRadiusWidth, this._endpoint[1] - halfRadiusWidth)
    if (this.sign !== Math.sign(this._endpoint[0] - startX)) {
      const offsetY =
        Math.max(rect.bottom(getNodeView(this.parent).bounds), this._endpoint[1]) +
        controlPointOffset
      addControlPoint(offsetStartX, offsetY)
      addControlPoint(offsetEndX, offsetY)
    }
    return expandedBounds
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
    const startX = this.x + this._radius.current * this.sign
    if (this._endpoint) {
      const controlPointOffset = Math.min(
        Math.abs(startX - this._endpoint[0]),
        this.edgeControlPointOffset,
      )
      canvas.beginPath()
      canvas.moveTo(startX, this.y)
      const offsetStartX = startX + controlPointOffset * this.sign
      const offsetEndX = this._endpoint[0] - controlPointOffset * this.sign
      if (this.sign === Math.sign(this._endpoint[0] - startX)) {
        canvas.bezierCurveTo(
          offsetStartX,
          this.y,
          offsetEndX,
          this._endpoint[1],
          this._endpoint[0],
          this._endpoint[1],
        )
      } else {
        const offsetY =
          Math.max(rect.bottom(getNodeView(this.parent).bounds), this._endpoint[1]) +
          controlPointOffset
        canvas.bezierCurveTo(
          offsetStartX,
          this.y,
          offsetStartX,
          offsetY,
          (offsetStartX + offsetEndX) / 2,
          offsetY,
        )
        canvas.bezierCurveTo(
          offsetEndX,
          offsetY,
          offsetEndX,
          this._endpoint[1],
          this._endpoint[0],
          this._endpoint[1],
        )
      }
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
    this._drawTerminal(canvas, startX, this.y)
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

function getNodeView (parent :Element|undefined) {
  for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor instanceof NodeView) return ancestor
  }
  throw new Error("Element used outside NodeView")
}
