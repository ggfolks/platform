import {Value} from "../core/react"
import {ButtonStates} from "./button"
import {
  AbstractDropdown, AbstractDropdownConfig, AbstractDropdownItem,
  AbstractDropdownItemConfig,
} from "./dropdown"
import {Element, ElementContext, blankValue} from "./element"
import {HGroup} from "./group"
import {AbstractList, AbstractListConfig, syncListContents} from "./list"
import {Spec} from "./model"
import {formatBinding} from "./keymap"
import {AbstractLabel, AbstractLabelConfig} from "./text"

/** Defines configuration for [[MenuBar]] elements. */
export interface MenuBarConfig extends AbstractListConfig {
  type :"menuBar"
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
export interface MenuConfig extends AbstractDropdownConfig {
  type :"menu"
}

const MenuStyleScope = {id: "menu", states: ButtonStates}

/** A menu within a menu bar. */
export class Menu extends AbstractDropdown {

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuConfig) {
    super(ctx, parent, config)
    const keys = ctx.model.resolveOpt(config.keys)
    this.disposer.add(this._hovered.onValue(hovered => {
      if (!hovered) return
      for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor instanceof MenuBar) {
          for (const element of ancestor.contents) {
            const menu = element as Menu
            if (menu._list && element !== this) {
              menu.toggle()
              if (!this._list) this.toggle()
              return
            }
          }
          return
        } else if (ancestor instanceof AbstractDropdown) {
          if (!ancestor.list) return
          for (const element of ancestor.list.contents) {
            const menu = element as AbstractDropdown
            if (menu.list && menu !== this) {
              menu.toggle()
            }
          }
          if (keys && !this._list) this.toggle()
          return
        }
      }
    }))
  }

  get styleScope () { return MenuStyleScope }
}

/** Defines configuration for [[MenuItem]] elements. */
export interface MenuItemConfig extends AbstractDropdownItemConfig {
  type :"menuItem"
  // shortcut? :Spec<Value<string>>
}

const MenuItemStyleScope = {id: "menuItem", states: [...ButtonStates, "separator"]}

/** A menu item within a menu. */
export class MenuItem extends AbstractDropdownItem {

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuItemConfig) {
    super(ctx, parent, config)
  }

  get styleScope () { return MenuItemStyleScope }
}

/** Defines configuration for [[MenuItem]] elements. */
export interface ShortcutConfig extends AbstractLabelConfig {
  type :"shortcut"
  command? :Spec<Value<string>>
}

export class Shortcut extends AbstractLabel {

  constructor (ctx :ElementContext, parent :Element, readonly config :ShortcutConfig) {
    super(ctx, parent, config)
  }

  protected resolveText (ctx :ElementContext, config :ShortcutConfig) {
    return ctx.model.resolve(config.command, blankValue).map((command :string) => {
      const commandKeys = this.root.keymap.getCommandBindings(command)
      return (commandKeys.length === 0) ? "" : formatBinding(commandKeys[0])
    })
  }
}
