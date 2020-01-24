import {rect, vec2} from "../core/math"
import {Mutable, Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {PointerInteraction} from "../input/interact"
import {Action, ElementsModel, Model, ModelKey, Spec} from "./model"
import {Element, Root, requireAncestor} from "./element"
import {OffAxisPolicy, VGroup} from "./group"
import {List} from "./list"
import {Drag} from "./drag"
import {CursorConfig, DefaultCursor, Cursor} from "./cursor"
import {Scroller} from "./scroll"

type ParentOrderUpdater = (keys :ModelKey[], parent :ModelKey|undefined, index :number) => void

interface AbstractTreeViewConfig extends List.AbstractConfig {
  dropCursor? :CursorConfig
}

const TreeViewStyleScope = {id: "treeView", states: Root.States}

type DropCoord = {parentKey :ModelKey|undefined, index :number, insert :boolean}

const dropCursorBounds = rect.create()

function cursorBounds (node :TreeViewNode, below :boolean, into :rect) :rect {
  const parent = node.parent!
  return rect.set(into, parent.x, parent.y + (below ? parent.height : 0), parent.width, 1)
}

abstract class AbstractTreeView extends VGroup implements List.Like {
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []
  readonly cursor :Cursor

  constructor (ctx :Element.Context, parent :Element, readonly config :AbstractTreeViewConfig,
               readonly key :ModelKey|undefined, readonly selectedKeys :MutableSet<ModelKey>,
               hoveredTreeView :Value<AbstractTreeView|undefined>) {
    super(ctx, parent, config)
    const cursorVisible = hoveredTreeView.map(view => view === this)
    const cursorConfig = {...(config.dropCursor || DefaultCursor), visible: cursorVisible}
    this.cursor = ctx.elem.create(ctx, this, cursorConfig) as Cursor
  }

  applyToChildren (op :Element.Op) {
    super.applyToChildren(op)
    op(this.cursor)
  }
  queryChildren<R> (query :Element.Query<R>) {
    return super.queryChildren(query) || query(this.cursor)
  }

  visitNodes (
    op :(node :TreeViewNode, parentKey :ModelKey|undefined, index :number) => void,
    parentKey? :ModelKey,
  ) {
    for (let ii = 0; ii < this.contents.length; ii++) {
      const element = this.contents[ii]
      const node = element.findChild("treeViewNode") as TreeViewNode
      op(node, parentKey, ii)
      node.treeViewList.visitNodes(op, node.key.current)
    }
  }

  visitVisibleNodes (
    op :(node :TreeViewNode, parentKey :ModelKey|undefined, index :number) => void,
    parentKey? :ModelKey,
  ) {
    for (let ii = 0; ii < this.contents.length; ii++) {
      const element = this.contents[ii]
      const node = element.findChild("treeViewNode") as TreeViewNode
      op(node, parentKey, ii)
      const treeView = node.treeViewList
      if (treeView.visible.current) treeView.visitVisibleNodes(op, node.key.current)
    }
  }

  setCursorBounds (bounds :rect) {
    bounds[3] = this.cursor.lineWidth
    this.cursor.setBounds(bounds)
    this.cursor.validate()
  }

  protected get customStyleScope () { return TreeViewStyleScope }
  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }

  // this is called from super constructors to avoid OOP constructor order pain
  protected syncContents (ctx :Element.Context, config :AbstractTreeViewConfig) {
    const model :ElementsModel<ModelKey> = ctx.model.resolveAs(config.model, "model")
    this.disposer.add(List.syncContents(ctx, this, model, (model, key) => ({
      type: "row",
      offPolicy: "stretch",
      contents: [
        {
          type: "box",
          scopeId: "treeViewToggleContainer",
          contents: {
            type: "toggle",
            visible: "hasChildren",
            checked: "expanded",
            onClick: "toggleExpanded",
            contents: {
              type: "box",
              scopeId: "treeViewToggle",
              contents: {type: "label", text: Value.constant("▸")},
            },
            checkedContents: {
              type: "box",
              scopeId: "treeViewToggle",
              contents: {type: "label", text: Value.constant("▾")},
            },
          },
          style: {valign: "top"},
        },
        {
          type: "column",
          constraints: {stretch: true},
          offPolicy: "stretch",
          contents: [
            {
              type: "treeViewNode",
              contents: config.element,
              key: Value.constant(key),
            },
            {
              type: "treeViewList",
              visible: "expanded",
              element: config.element,
              model: "childModel",
              key: Value.constant(key),
              dropCursor: config.dropCursor,
            },
          ],
        },
      ],
    })))
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    this.cursor.render(canvas, region)
  }
}

export interface TreeViewListConfig extends AbstractTreeViewConfig {
  type :"treeViewList"
  key :Spec<Value<ModelKey>>
}

export class TreeViewList extends AbstractTreeView {
  readonly expanded :Value<boolean>
  readonly toggleExpanded :Action

  constructor (ctx :Element.Context, parent :Element, config :AbstractTreeViewConfig) {
    super(ctx, parent, config, ctx.model.resolveAs(config.key, "key").current,
          requireAncestor(parent, TreeView).selectedKeys,
          requireAncestor(parent, TreeView).hoveredTreeView)
    this.syncContents(ctx, config)
    this.expanded = ctx.model.resolve("expanded")
    this.toggleExpanded = ctx.model.resolveAction("toggleExpanded")
  }

  expand () {
    if (!this.expanded.current) this.toggleExpanded()
  }
}

/** Defines configuration for [[TreeView]] elements. */
export interface TreeViewConfig extends AbstractTreeViewConfig {
  type :"treeView"
  selectedKeys :Spec<MutableSet<ModelKey>>
  updateParentOrder? :Spec<ParentOrderUpdater>
}

/** Contains an expandable tree view. */
export class TreeView extends AbstractTreeView implements Drag.Owner {
  private readonly _updateParentOrder? :ParentOrderUpdater
  readonly dropCoord = Mutable.local<DropCoord|undefined>(undefined)
  readonly nodes = new Map<ModelKey, TreeViewNode>()

  constructor (readonly ctx :Element.Context, parent :Element, readonly config :TreeViewConfig,
               readonly hoveredTreeView = Mutable.local<AbstractTreeView|undefined>(undefined)) {
    super(ctx, parent, config, undefined,
          ctx.model.resolveAs(config.selectedKeys, "selectedKeys"), hoveredTreeView)
    this._updateParentOrder = ctx.model.resolveOpt(config.updateParentOrder)
    this.syncContents(ctx, config)

    // if we're in a scroller, automatically expand and scroll to newly selected nodes
    const scroller = this.getAncestor(Scroller)
    if (scroller) {
      this.disposer.add(this.selectedKeys.onChange(change => {
        if (change.type === "added") {
          const node = this.nodes.get(change.elem)
          if (node) {
            for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
              if (ancestor instanceof TreeViewList) ancestor.expand()
            }
            this.root.validate()
            scroller.scrollUntilVisible(node, false)
          }
        }
      }))
    }
  }

  get dragConstraint () :Drag.Constraint { return "none" }
  get canStartDrag () { return !!this._updateParentOrder }

  handleDrag (elem :Drag.Elem, pos :vec2) {
    const center = pos[1]
    let dropCoord :DropCoord|undefined, dropNode :TreeViewNode|undefined
    const lastElement = this.contents[this.contents.length - 1]
    if (lastElement && center > lastElement.y + lastElement.height) {
      dropCoord = {parentKey: undefined, index: this.contents.length, insert: true}
      dropNode = lastElement.findChild("treeViewNode")! as TreeViewNode
      cursorBounds(dropNode, true, dropCursorBounds)

    } else {
      let dropDistance = Infinity
      this.visitVisibleNodes((node, parentKey, index) => {
        const startPos = node.y
        const startDistance = Math.abs(startPos - center)
        if (
          (center > startPos || index === 0) &&
          startDistance <= dropDistance &&
          this._canReparent(parentKey)
        ) {
          dropDistance = startDistance
          dropCoord = {parentKey, index, insert: true}
          dropNode = node
          cursorBounds(node, false, dropCursorBounds)
        }
        const midPos = startPos + node.height / 2
        const midDistance = Math.abs(midPos - center)
        if (midDistance <= dropDistance && this._canReparent(node.key.current)) {
          dropDistance = midDistance
          const tree = node.treeViewList
          dropCoord = {parentKey: node.key.current, index: tree.contents.length, insert: false}
          dropNode = undefined
        }
        const endPos = startPos + node.height
        const endDistance = Math.abs(endPos - center)
        if (endDistance <= dropDistance && this._canReparent(parentKey)) {
          dropDistance = endDistance
          dropCoord = {parentKey, index: index + 1, insert: true}
          dropNode = node
          cursorBounds(node, true, dropCursorBounds)
        }
      })
    }
    this.dropCoord.update(dropCoord)
    if (!dropNode) this.hoveredTreeView.update(undefined)
    else {
      const treeView = dropNode.parent!.parent!.parent! as AbstractTreeView
      treeView.setCursorBounds(dropCursorBounds)
      this.hoveredTreeView.update(treeView)
    }
  }

  handleDrop (elem :Drag.Elem) {
    const coord = this.dropCoord.current
    if (coord && this._updateParentOrder) {
      this._updateParentOrder(Array.from(this.selectedKeys), coord.parentKey, coord.index)
    }
    this.cancelDrag()
  }

  cancelDrag () {
    this.dropCoord.update(undefined)
    this.hoveredTreeView.update(undefined)
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    super.handlePointerDown(event, pos, into)
    if (into.length === 0) this.selectedKeys.clear()
  }

  private _canReparent (parentKey :ModelKey|undefined) :boolean {
    if (!parentKey) return true
    const parentNode = this.nodes.get(parentKey)
    if (!parentNode) return false
    for (const key of this.selectedKeys) {
      const selectedNode = this.nodes.get(key)
      if (selectedNode && parentNode.isDescendedFrom(selectedNode)) return false
    }
    return true
  }
}

/** Defines configuration for [[TreeViewNode]] elements. */
export interface TreeViewNodeConfig extends Drag.ElemConfig {
  type :"treeViewNode"
}

const TreeViewNodeStyleScope = {id: "treeViewNode", states: Drag.ElementStates}

/** Represents a single node in a tree view. */
export class TreeViewNode extends Drag.Elem {
  private readonly _selectedKeys :MutableSet<ModelKey>

  constructor (ctx :Element.Context, parent :Element, readonly config :TreeViewNodeConfig) {
    super(ctx, parent, config)
    const treeView = this.requireAncestor(TreeView)
    treeView.nodes.set(this.key.current, this)
    this.disposer.add(() => treeView.nodes.delete(this.key.current))
    this._selectedKeys = treeView.selectedKeys
    this.recomputeStateOnChange(this._selectedKeys)

    this.disposer.add(this.requireAncestor(TreeView).dropCoord.onValue(c => {
      this.hovered.update(!!c && c.parentKey === this.key.current && !c.insert)
    }))
  }

  get treeViewList () { return this.requireParent.findChild("treeViewList") as TreeViewList }

  get selected () :boolean {
    // can be called before constructor is complete
    return this.key && this._selectedKeys && this._selectedKeys.has(this.key.current)
  }

  isDescendedFrom (node :TreeViewNode) {
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor === node.parent) return true
    }
    return false
  }

  select (event :MouseEvent|TouchEvent) :boolean {
    if (event.ctrlKey) {
      if (this._selectedKeys.has(this.key.current)) this._selectedKeys.delete(this.key.current)
      else this._selectedKeys.add(this.key.current)

    } else if (event.shiftKey) {
      let select = this._selectedKeys.size === 0
      this.dragOwner.visitNodes(node => {
        const key = node.key.current
        if (select) {
          if (this._selectedKeys.has(key)) select = false
          else {
            this._selectedKeys.add(key)
            if (key === this.key.current) select = false
          }
        } else if (this._selectedKeys.has(key)) {
          select = true
        } else if (key === this.key.current) {
          this._selectedKeys.add(key)
          select = true
        }
      })

    } else if (!this._selectedKeys.has(this.key.current)) {
      this._selectedKeys.clear()
      this._selectedKeys.add(this.key.current)
    }
    return true
  }

  releaseSelect (event :MouseEvent|TouchEvent) {
    if (!(event.ctrlKey || event.shiftKey)) {
      this._selectedKeys.clear()
      this._selectedKeys.add(this.key.current)
    }
  }

  protected get customStyleScope () { return TreeViewNodeStyleScope }
  protected get dragOwner () { return this.requireAncestor(TreeView) }

  protected _createDragRoot () {
    const treeView = this.requireAncestor(TreeView)
    const model = treeView.ctx.model.resolveAs(treeView.config.model, "model")
    const root = this.root.createPopup(this.ctx, {
      type: "root",
      inert: true,
      contents: {
        type: "absList",
        element: (model :Model, key :ModelKey) => {
          const node = treeView.nodes.get(key)
          if (!(node && node.showing)) return {type: "spacer"}
          return {
            type: "box",
            constraints: {position: [node.x, node.y], size: [node.width, node.height]},
            contents: {
              type: "column",
              offPolicy: "stretch",
              scopeId: this.styleScope.id,
              overrideParentState: this.state.current,
              contents: [this.config.contents],
            },
            style: {halign: "stretch", valign: "stretch", alpha: 0.5},
          }
        },
        model: {keys: this._selectedKeys, resolve: model.resolve},
      },
    })
    root.sizeToFit()
    root.origin.update(vec2.fromValues(-this.x, -this.y))
    return root
  }
}

export const TreeCatalog :Element.Catalog = {
  "treeView": (ctx, parent, cfg) => new TreeView(ctx, parent, cfg as TreeViewConfig),
  "treeViewList": (ctx, parent, cfg) => new TreeViewList(ctx, parent, cfg as TreeViewListConfig),
  "treeViewNode": (ctx, parent, cfg) => new TreeViewNode(ctx, parent, cfg as TreeViewNodeConfig),
}
