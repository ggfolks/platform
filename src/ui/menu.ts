import {Value} from "../core/react"
import {Noop, Remover} from "../core/util"
import {ButtonStates} from "./button"
import {
  AbstractDropdown, AbstractDropdownConfig, AbstractDropdownItem,
  AbstractDropdownItemConfig,
} from "./dropdown"
import {Element, ElementContext, trueValue, blankValue} from "./element"
import {HGroup} from "./group"
import {AbstractList, AbstractListConfig, syncListContents} from "./list"
import {Action, ElementsModel, Spec} from "./model"
import {
  AbstractLabel, AbstractLabelConfig, AltMask, CtrlMask,
  MetaMask, ShiftMask, getCommandKeys, modMask,
} from "./text"

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
  shortcutsModel? :Spec<ElementsModel<string>>
}

const MenuStyleScope = {id: "menu", states: ButtonStates}

/** A menu within a menu bar. */
export class Menu extends AbstractDropdown {
  private readonly _shortcutsModel? :ElementsModel<string>
  private readonly _shortcutRemovers = new Map<string, Remover>()

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
    this._shortcutsModel = ctx.model.resolveOpt(config.shortcutsModel)
    if (!this._shortcutsModel) return
    let latestKeys :Iterable<string> = []
    this.disposer.add(this._shortcutsModel.keys.onValue(keys => {
      // subscribe to enabled states so that they're up-to-date when we want to sample them
      const kset = new Set(keys)
      latestKeys = keys
      for (const [key, remover] of this._shortcutRemovers) {
        if (!kset.has(key)) {
          remover()
          this._shortcutRemovers.delete(key)
          this.disposer.remove(remover)
        }
      }
      for (const key of keys) {
        if (!this._shortcutRemovers.has(key)) {
          const remover = this.getShortcutEnabled(key).onValue(Noop)
          this._shortcutRemovers.set(key, remover)
          this.disposer.add(remover)
        }
      }
    }))
    this.disposer.add(this.root.unclaimedKeyEvent.onEmit(event => {
      if (event.type !== "keydown") return
      for (const key of latestKeys) {
        for (const [flags, code] of getCommandKeys(key)) {
          if (flags === modMask(event) && code === event.code && this.activateShortcut(key)) {
            event.preventDefault()
            return
          }
        }
      }
    }))
  }

  /** Returns the enabled state for the shortcut with the supplied key. */
  getShortcutEnabled (key :string) :Value<boolean> {
    const data = this._requireShortcutsModel.resolve(key)
    return data.resolve<Value<boolean>>("enabled", trueValue)
  }

  /** Activates the shortcut identified by the supplied key. */
  activateShortcut (key :string) :boolean {
    const data = this._requireShortcutsModel.resolve(key)
    const enabled = data.resolve<Value<boolean>>("enabled", trueValue)
    if (!enabled.current) return false
    data.resolve<Action>("action")()
    return true
  }

  get styleScope () { return MenuStyleScope }

  private get _requireShortcutsModel () {
    if (!this._shortcutsModel) throw new Error("Missing shortcut model")
    return this._shortcutsModel
  }
}

/** Defines configuration for [[MenuItem]] elements. */
export interface MenuItemConfig extends AbstractDropdownItemConfig {
  type :"menuItem"
  shortcut? :Spec<Value<string>>
}

const MenuItemStyleScope = {id: "menuItem", states: [...ButtonStates, "separator"]}

/** A menu item within a menu. */
export class MenuItem extends AbstractDropdownItem {

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuItemConfig) {
    super(
      ctx,
      parent,
      {
        ...config,
        enabled: getMenuItemEnabled(ctx, parent, config),
      },
    )
    if (this._action) return
    const shortcut = ctx.model.resolveOpt(config.shortcut)
    if (!shortcut) return
    this._action = () => getMenu(parent).activateShortcut(shortcut.current)
  }

  get styleScope () { return MenuItemStyleScope }
}

function getMenuItemEnabled (
  ctx :ElementContext,
  parent :Element,
  config :MenuItemConfig,
) :Value<boolean> {
  const shortcut = ctx.model.resolveOpt(config.shortcut)
  if (shortcut) return shortcut.switchMap(key => getMenu(parent).getShortcutEnabled(key))
  return ctx.model.resolve(config.enabled, trueValue)
}

function getMenu (parent :Element|undefined) :Menu {
  for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor instanceof Menu) {
      return ancestor
    }
  }
  throw new Error("Element used outside Menu")
}

export type KeyCombo = [string, string]

/** Defines configuration for [[MenuItem]] elements. */
export interface ShortcutConfig extends AbstractLabelConfig {
  type :"shortcut"
  command? :Spec<Value<string>>
}

const codeReplacements = {Delete: "Del", Escape: "Esc", Equal: "=", Minus: "-"}

export class Shortcut extends AbstractLabel {

  constructor (ctx :ElementContext, parent :Element, readonly config :ShortcutConfig) {
    super(ctx, parent, config)
  }

  protected resolveText (ctx :ElementContext, config :ShortcutConfig) {
    return ctx.model.resolve(config.command, blankValue).map((command :string) => {
      const commandKeys = getCommandKeys(command)
      if (commandKeys.length === 0) return ""
      const [flags, code] = commandKeys[0]
      let str = ""
      if (flags & CtrlMask) str += "Ctrl+"
      if (flags & AltMask) str += "Alt+"
      if (flags & ShiftMask) str += "Shift+"
      if (flags & MetaMask) str += "Meta+"
      // only show the first mapping
      return str + (
        code.startsWith("Key")
        ? code.substring(3)
        : code.startsWith("Digit")
        ? code.substring(5)
        : codeReplacements[code] || code
      )
    })
  }
}
