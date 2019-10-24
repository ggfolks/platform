import {Value} from "../core/react"
import {MutableSet} from "../core/rcollect"
import {Element, ElementContext} from "./element"
import {VGroup} from "./group"
import {
  AbstractList, AbstractListConfig, DraggableElement, DraggableElementConfig,
  DraggableElementStates, syncListContents,
} from "./list"
import {ModelKey, Spec} from "./model"

type ParentOrderUpdater = (key :ModelKey, parent :ModelKey|undefined, index :number) => void

/** Defines configuration for [[TreeView]] elements. */
export interface TreeViewConfig extends AbstractListConfig {
  type :"treeview"
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
            contents: {type: "label", text: Value.constant("▶")},
          },
          checkedContents: {
            type: "box",
            contents: {type: "label", text: Value.constant("▼")},
          },
        },
        {
          type: "column",
          contents: [
            config.element,
            {
              type: "treeview",
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
}

/** Defines configuration for [[TreeViewNode]] elements. */
export interface TreeViewNodeConfig extends DraggableElementConfig {
  type :"treeviewnode"
  key :Spec<Value<ModelKey>>
  selectedKeys :Spec<MutableSet<ModelKey>>
  updateParentOrder? :Spec<ParentOrderUpdater>
}

const TreeViewNodeStyleScope = {id: "treeviewnode", states: DraggableElementStates}

/** Represents a single node in a tree view. */
export class TreeViewNode extends DraggableElement {
  private readonly _key :Value<ModelKey>
  private readonly _selectedKeys :MutableSet<ModelKey>
  private readonly _parentOrderUpdater? :ParentOrderUpdater

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

  select () :void {
    this._selectedKeys.add(this._key.current)
  }

  get canReorder () :boolean {
    return !!this._parentOrderUpdater
  }

  reorder (data :any) :void {
    const [parent, index] :[ModelKey|undefined, number] = data
    this._parentOrderUpdater!(this._key.current, parent, index)
  }

  protected _updateDropPosition () {
    super._updateDropPosition()
  }
}
