import {rect} from "../core/math"
import {Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {Element, ElementContext} from "./element"
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

/** Contains an expandable tree view. */
export class TreeView extends VGroup implements AbstractList {
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :TreeViewConfig) {
    super(ctx, parent, config)
    const selectedKeys = ctx.model.resolve(config.selectedKeys)
    const updateParentOrder = ctx.model.resolveOpt(config.updateParentOrder)
    this.disposer.add(syncListContents(ctx, this, {
      type: "row",
      contents: [
        {
          type: "toggle",
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
        {
          type: "column",
          offPolicy: "stretch",
          contents: [
            {
              type: "treeViewNode",
              contents: config.element,
              key: config.key,
              selectedKeys,
              updateParentOrder,
            },
            {
              type: "treeView",
              visible: "expanded",
              element: config.element,
              keys: "childKeys",
              data: "childData",
              selectedKeys,
              updateParentOrder,
            },
          ],
        },
      ],
    }))
  }

  visitNodeKeys (op :(key :ModelKey) => void) {
    for (const element of this.contents) {
      const node = element.findChild("treeViewNode") as TreeViewNode
      op(node.key)
      const treeView = element.findChild("treeView") as TreeView
      treeView.visitNodeKeys(op)
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
      this._root.visitNodeKeys(key => {
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

  private get _root () :TreeView {
    let lastTreeView :TreeView|undefined
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor instanceof TreeView) lastTreeView = ancestor
    }
    if (!lastTreeView) throw new Error("TreeViewNode used outside TreeView")
    return lastTreeView
  }

  get canReorder () :boolean {
    return !!this._parentOrderUpdater
  }

  reorder (data :any) :void {
    const [parent, index] :[ModelKey|undefined, number] = data
    this._parentOrderUpdater!(this._key.current, parent, index)
  }

  protected _updateDropPosition () {
  }
}
