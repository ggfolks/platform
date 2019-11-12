import {rect, vec2} from "../core/math"
import {Mutable, Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {ModelKey, Spec} from "./model"
import {Element, ElementContext, ElementOp, ElementQuery, PointerInteraction, RootStates,
        requireAncestor} from "./element"
import {OffAxisPolicy, VGroup} from "./group"
import {ListLike, AbstractListConfig, syncListContents} from "./list"
import {DragConstraint, DragElement, DragElementConfig, DragElementStates, DragOwner} from "./drag"
import {CursorConfig, DefaultCursor, Cursor} from "./cursor"

type ParentOrderUpdater = (key :ModelKey, parent :ModelKey|undefined, index :number) => void

interface AbstractTreeViewConfig extends AbstractListConfig {
  dropCursor? :CursorConfig
}

const TreeViewStyleScope = {id: "treeView", states: RootStates}

type DropCoord = {parentKey :ModelKey|undefined, index :number, insert :boolean}

const dropCursorBounds = rect.create()

function cursorBounds (node :TreeViewNode, below :boolean, into :rect) :rect {
  return rect.set(into, node.x, node.y + (below ? node.height-1 : 0), node.width, 1)
}

abstract class AbstractTreeView extends VGroup implements ListLike {
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []
  readonly cursor :Cursor

  constructor (ctx :ElementContext, parent :Element, readonly config :AbstractTreeViewConfig,
               readonly key :ModelKey|undefined, readonly selectedKeys :MutableSet<ModelKey>,
               hoveredTreeView :Value<AbstractTreeView|undefined>) {
    super(ctx, parent, config)
    const cursorVisible = hoveredTreeView.map(view => view === this)
    const cursorConfig = {...(config.dropCursor || DefaultCursor), visible: cursorVisible}
    this.cursor = ctx.elem.create(ctx, this, cursorConfig) as Cursor
  }

  get styleScope () { return TreeViewStyleScope }

  applyToChildren (op :ElementOp) {
    super.applyToChildren(op)
    op(this.cursor)
  }
  queryChildren<R> (query :ElementQuery<R>) {
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

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }

  // this is called from super constructors to avoid OOP constructor order pain
  protected syncContents (ctx :ElementContext, config :AbstractTreeViewConfig) {
    this.disposer.add(syncListContents(ctx, this, (model, key) => ({
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

  constructor (ctx :ElementContext, parent :Element, config :AbstractTreeViewConfig) {
    super(ctx, parent, config, ctx.model.resolve(config.key).current,
          requireAncestor(parent, TreeView).selectedKeys,
          requireAncestor(parent, TreeView).hoveredTreeView)
    this.syncContents(ctx, config)
  }
}

/** Defines configuration for [[TreeView]] elements. */
export interface TreeViewConfig extends AbstractTreeViewConfig {
  type :"treeView"
  selectedKeys :Spec<MutableSet<ModelKey>>
  updateParentOrder? :Spec<ParentOrderUpdater>
}

/** Contains an expandable tree view. */
export class TreeView extends AbstractTreeView implements DragOwner {
  private readonly _updateParentOrder? :ParentOrderUpdater
  readonly dropCoord = Mutable.local<DropCoord|undefined>(undefined)

  constructor (ctx :ElementContext, parent :Element, readonly config :TreeViewConfig,
               readonly hoveredTreeView = Mutable.local<AbstractTreeView|undefined>(undefined)) {
    super(ctx, parent, config, undefined, ctx.model.resolve(config.selectedKeys), hoveredTreeView)
    this._updateParentOrder = ctx.model.resolveOpt(config.updateParentOrder)
    this.syncContents(ctx, config)
  }

  get dragConstraint () :DragConstraint { return "none" }
  get canStartDrag () { return !!this._updateParentOrder }

  handleDrag (elem :DragElement, pos :vec2) {
    const dragNode = elem as any as TreeViewNode, center = pos[1]
    let dropDistance = Infinity
    let dropCoord :DropCoord|undefined, dropNode :TreeViewNode|undefined
    this.visitVisibleNodes((node, parentKey, index) => {
      const startPos = node.y
      const startDistance = Math.abs(startPos - center)
      if (startDistance < dropDistance) {
        dropDistance = startDistance
        dropCoord = {parentKey, index, insert: true}
        dropNode = node
        cursorBounds(node, false, dropCursorBounds)
      }
      const midPos = startPos + node.height / 2
      const midDistance = Math.abs(midPos - center)
      if (midDistance < dropDistance && node !== dragNode && !node.isDescendedFrom(dragNode)) {
        dropDistance = midDistance
        const tree = node.treeViewList
        dropCoord = {parentKey: node.key.current, index: tree.contents.length, insert: false}
        dropNode = undefined
      }
      const endPos = startPos + node.height
      const endDistance = Math.abs(endPos - center)
      if (endDistance < dropDistance) {
        dropDistance = endDistance
        dropCoord = {parentKey, index: index + 1, insert: true}
        dropNode = node
        cursorBounds(node, true, dropCursorBounds)
      }
    })

    this.dropCoord.update(dropCoord)
    if (!dropNode) this.hoveredTreeView.update(undefined)
    else {
      const treeView = dropNode.parent!.parent!.parent! as AbstractTreeView
      treeView.setCursorBounds(dropCursorBounds)
      this.hoveredTreeView.update(treeView)
    }
  }

  handleDrop (elem :DragElement) {
    const coord = this.dropCoord.current
    if (coord && this._updateParentOrder) this._updateParentOrder(
      elem.key.current, coord.parentKey, coord.index)
    this.cancelDrag()
  }

  cancelDrag () {
    this.dropCoord.update(undefined)
    this.hoveredTreeView.update(undefined)
  }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) {
    super.handlePointerDown(event, pos, into)
    if (into.length > 0) this.selectedKeys.clear()
  }
}

/** Defines configuration for [[TreeViewNode]] elements. */
export interface TreeViewNodeConfig extends DragElementConfig {
  type :"treeViewNode"
}

const TreeViewNodeStyleScope = {id: "treeViewNode", states: DragElementStates}

/** Represents a single node in a tree view. */
export class TreeViewNode extends DragElement {
  private readonly _selectedKeys :MutableSet<ModelKey>

  constructor (ctx :ElementContext, parent :Element, readonly config :TreeViewNodeConfig) {
    super(ctx, parent, config)
    this._selectedKeys = this.requireAncestor(TreeView).selectedKeys
    this.recomputeStateOnChange(this._selectedKeys)

    this.disposer.add(this.requireAncestor(TreeView).dropCoord.onValue(c => {
      this.hovered.update(!!c && c.parentKey === this.key.current && !c.insert)
    }))
  }

  get styleScope () { return TreeViewNodeStyleScope }
  get treeViewList () { return this.requireParent.findChild("treeViewList") as TreeViewList }

  get selected () :boolean {
    // can be called before constructor is complete
    return this.key && this._selectedKeys && this._selectedKeys.has(this.key.current)
  }

  isDescendedFrom (node :TreeViewNode) {
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor === node) return true
    }
    return false
  }

  select (event :MouseEvent|TouchEvent) :void {
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

    } else {
      this._selectedKeys.clear()
      this._selectedKeys.add(this.key.current)
    }
  }

  protected get dragOwner () { return this.requireAncestor(TreeView) }
}
