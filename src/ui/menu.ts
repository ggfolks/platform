import {Mutable, Value} from "../core/react"
import {ButtonStates} from "./button"
import {
  AbstractDropdown, AbstractDropdownConfig, AbstractDropdownItem,
  AbstractDropdownItemConfig, DropdownHost
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
export class MenuBar extends HGroup implements AbstractList, DropdownHost {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  readonly activeChild = Mutable.local<AbstractDropdown|undefined>(undefined)
  get autoActivate () { return this.activeChild.current ? this.activeChild.current.isOpen : false }

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuBarConfig) {
    super(ctx, parent, config)
    this.disposer.add(syncListContents(ctx, this))

    // while we have an active menu, intercept all event handling from the root so that all other
    // elements are inactive until the menu is dismissed
    this.activeChild.onValue(child => {
      if (child) this.root.targetElem.update(this)
      else this.root.targetElem.updateIf(e => e === this, undefined)
    })
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
  }

  get styleScope () { return MenuStyleScope }
}

/** Defines configuration for [[MenuItem]] elements. */
export interface MenuItemConfig extends AbstractDropdownItemConfig {
  type :"menuItem"
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
