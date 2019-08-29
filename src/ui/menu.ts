import {Noop} from "../core/util"
import {AbstractButton, ButtonStates} from "./button"
import {ControlConfig, Element, ElementContext} from "./element"
import {HGroup} from "./group"
import {AbstractList, AbstractListConfig, syncListContents} from "./list"

/** Defines configuration for [[MenuBar]] elements. */
export interface MenuBarConfig extends AbstractListConfig {
  type :"menubar"
}

/** A horizontal menu bar. */
export class MenuBar extends HGroup implements AbstractList {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuBarConfig) {
    super(ctx, parent, config)
    this.disposer.add(syncListContents(ctx, this))
  }
}

/** Defines configuration for [[Menu]] elements. */
export interface MenuConfig extends ControlConfig, AbstractListConfig {
  type :"menu"
}

const MenuStyleScope = {id: "menu", states: ButtonStates}

/** A menu within a menu bar. */
export class Menu extends AbstractButton {
  private _list? :Element

  constructor (private _ctx :ElementContext, parent :Element, readonly config :MenuConfig) {
    super(_ctx, parent, config, () => this._toggle())
  }

  get styleScope () { return MenuStyleScope }

  private _toggle () {
    if (this._list) {
      this._list.dispose()
      this._list = undefined
      return
    }
    this._list = this._ctx.elem.create(this._ctx, this, {
      type: "list",
      element: this.config.element,
      data: this.config.data,
      keys: this.config.keys,
    })
  }

  dispose () {
    super.dispose()
    if (this._list) this._list.dispose()
  }
}

/** Defines configuration for [[MenuItem]] elements. */
export interface MenuItemConfig extends ControlConfig {
  type :"menuitem"
}

/** A menu item within a menu. */
export class MenuItem extends AbstractButton {

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuItemConfig) {
    super(ctx, parent, config, Noop)
  }
}
