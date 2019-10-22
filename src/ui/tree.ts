import {MutableSet} from "../core/rcollect"
import {Control, ControlConfig, ControlStates, Element, ElementContext} from "./element"
import {VGroup} from "./group"
import {AbstractList, AbstractListConfig, syncListContents} from "./list"
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
    this.disposer.add(syncListContents(ctx, this))
  }
}

/** Defines configuration for [[TreeViewNode]] elements. */
export interface TreeViewNodeConfig extends ControlConfig {
  type :"treeviewnode"
}

const TreeViewNodeStyleScope = {id: "treeviewnode", states: [...ControlStates, "selected"]}

/** Represents a single node in a tree view. */
export class TreeViewNode extends Control {

  constructor (ctx :ElementContext, parent :Element, readonly config :TreeViewNodeConfig) {
    super(ctx, parent, config)
  }

  get styleScope () { return TreeViewNodeStyleScope }
}
