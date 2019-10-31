import {rect, vec2} from "../core/math"
import {Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {Element, ElementContext, PointerInteraction, RootStates} from "./element"
import {OffAxisPolicy, VGroup} from "./group"
import {
  AbstractList, AbstractListConfig, DragElement, DragElementConfig,
  DragElementStates, syncListContents,
} from "./list"
import {ModelKey, Spec} from "./model"

type ParentOrderUpdater = (key :ModelKey, parent :ModelKey|undefined, index :number) => void

/** Defines configuration for [[TreeView]] elements. */
export interface TreeViewConfig extends AbstractListConfig {
  type :"treeView"
  key :Spec<Value<ModelKey>>
  selectedKeys :Spec<MutableSet<ModelKey>>
  updateParentOrder? :Spec<ParentOrderUpdater>
}

const TreeViewStyleScope = {id: "treeView", states: RootStates}

/** Contains an expandable tree view. */
export class TreeView extends VGroup implements AbstractList {
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []

  private readonly _selectedKeys :MutableSet<ModelKey>

  constructor (ctx :ElementContext, parent :Element, readonly config :TreeViewConfig) {
    super(ctx, parent, config)
    this._selectedKeys = ctx.model.resolve(config.selectedKeys)
    const updateParentOrder = ctx.model.resolveOpt(config.updateParentOrder)
    this.disposer.add(syncListContents(ctx, this, {
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
              key: config.key,
              selectedKeys: this._selectedKeys,
              updateParentOrder,
            },
            {
              type: "treeView",
              visible: "expanded",
              element: config.element,
              model: "childModel",
              key: config.key,
              selectedKeys: this._selectedKeys,
              updateParentOrder,
            },
          ],
        },
      ],
    }))
  }

  get styleScope () { return TreeViewStyleScope }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const interaction = super.handlePointerDown(event, pos)
    if (interaction) return interaction
    this._selectedKeys.clear()
    return undefined
  }

  visitNodes (
    op :(node :TreeViewNode, parentKey :ModelKey|undefined, index :number) => void,
    parentKey? :ModelKey,
  ) {
    for (let ii = 0; ii < this.contents.length; ii++) {
      const element = this.contents[ii]
      const node = element.findChild("treeViewNode") as TreeViewNode
      op(node, parentKey, ii)
      const treeView = element.findChild("treeView") as TreeView
      treeView.visitNodes(op, node.key)
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
      const treeView = element.findChild("treeView") as TreeView
      if (treeView.visible.current) treeView.visitVisibleNodes(op, node.key)
    }
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    for (const element of this.contents) {
      const treeViewNode = element.findChild("treeViewNode") as TreeViewNode
      treeViewNode.maybeRenderDrag(canvas, region)
    }
  }
}

/** Defines configuration for [[TreeViewNode]] elements. */
export interface TreeViewNodeConfig extends DragElementConfig {
  type :"treeViewNode"
  key :Spec<Value<ModelKey>>
  selectedKeys :Spec<MutableSet<ModelKey>>
  updateParentOrder? :Spec<ParentOrderUpdater>
}

const TreeViewNodeStyleScope = {id: "treeViewNode", states: DragElementStates}

/** Represents a single node in a tree view. */
export class TreeViewNode extends DragElement {
  private readonly _key :Value<ModelKey>
  private readonly _selectedKeys :MutableSet<ModelKey>
  private readonly _parentOrderUpdater? :ParentOrderUpdater

  private _dropNode? :TreeViewNode

  get key () :ModelKey { return this._key.current }

  constructor (ctx :ElementContext, parent :Element, readonly config :TreeViewNodeConfig) {
    super(ctx, parent, config)
    this._key = ctx.model.resolve(config.key)
    this._selectedKeys = ctx.model.resolve(config.selectedKeys)
    this.disposer.add(this._selectedKeys.onValue(_ => this._state.update(this.computeState)))
    if (config.updateParentOrder) {
      this._parentOrderUpdater = ctx.model.resolve(config.updateParentOrder)
    }
  }

  isDescendedFrom (node :TreeViewNode) {
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor === node) return true
    }
    return false
  }

  get styleScope () { return TreeViewNodeStyleScope }

  get constrain () :boolean { return false }

  get selected () :boolean {
    // can be called before constructor is complete
    return this._key && this._selectedKeys && this._selectedKeys.has(this._key.current)
  }

  select (event :MouseEvent|TouchEvent) :void {
    if (event.ctrlKey) {
      if (this._selectedKeys.has(this._key.current)) this._selectedKeys.delete(this._key.current)
      else this._selectedKeys.add(this._key.current)

    } else if (event.shiftKey) {
      let select = this._selectedKeys.size === 0
      this._root.visitNodes(node => {
        const key = node.key
        if (select) {
          if (this._selectedKeys.has(key)) select = false
          else {
            this._selectedKeys.add(key)
            if (key === this.key) select = false
          }
        } else if (this._selectedKeys.has(key)) {
          select = true

        } else if (key === this.key) {
          this._selectedKeys.add(key)
          select = true
        }
      })
    } else {
      this._selectedKeys.clear()
      this._selectedKeys.add(this._key.current)
    }
  }

  get canReorder () :boolean {
    return !!this._parentOrderUpdater
  }

  reorder (data :any) :void {
    const [parent, index] :[ModelKey|undefined, number] = data
    this._parentOrderUpdater!(this._key.current, parent, index)
  }

  protected _updateDropPosition () {
    this._dropStart = undefined
    this._dropEnd = undefined
    this._dropData = undefined

    let dropPosX = 0, dropPosY = 0, dropWidth = 0
    let dropDistance = Infinity
    const center = this._dragPos![1] + this.height / 2
    this._root.visitVisibleNodes((node, parentKey, index) => {
      const startPos = node.y
      const startDistance = Math.abs(startPos - center)
      if (startDistance < dropDistance) {
        dropDistance = startDistance
        dropPosX = node.x
        dropPosY = startPos
        dropWidth = node.width
        this._setDropNode(undefined)
        this._dropData = [parentKey, index]
      }
      const midPos = startPos + node.height / 2
      const midDistance = Math.abs(midPos - center)
      if (midDistance < dropDistance && node !== this && !node.isDescendedFrom(this)) {
        dropDistance = midDistance
        dropWidth = 0
        this._setDropNode(node)
        const tree = node.requireParent.findChild("treeView") as TreeView
        this._dropData = [node.key, tree.contents.length]
      }
      const endPos = startPos + node.height
      const endDistance = Math.abs(endPos - center)
      if (endDistance < dropDistance) {
        dropDistance = endDistance
        dropPosX = node.x
        dropPosY = endPos
        dropWidth = node.width
        this._setDropNode(undefined)
        this._dropData = [parentKey, index + 1]
      }
    })
    if (dropWidth === 0) return
    this._dropStart = vec2.fromValues(dropPosX, dropPosY)
    this._dropEnd = vec2.fromValues(dropPosX + dropWidth, dropPosY)
  }

  protected _clearDropPosition () {
    super._clearDropPosition()
    this._setDropNode(undefined)
  }

  private _setDropNode (node :TreeViewNode|undefined) {
    if (this._dropNode === node) return
    if (this._dropNode) this._dropNode._hovered.update(false)
    this._dropNode = node
    if (node) node._hovered.update(true)
  }

  private get _root () :TreeView {
    let lastTreeView :TreeView|undefined
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor instanceof TreeView) lastTreeView = ancestor
    }
    if (!lastTreeView) throw new Error("TreeViewNode used outside TreeView")
    return lastTreeView
  }
}
