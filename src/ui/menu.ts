import {dim2, rect, vec2} from "../core/math"
import {Source, Value} from "../core/react"
import {Noop, PMap, getValue} from "../core/util"
import {AbstractButton, ButtonStates} from "./button"
import {
  ControlConfig,
  Element,
  ElementConfig,
  ElementContext,
  MouseInteraction,
  trueValue,
  falseValue,
} from "./element"
import {HGroup} from "./group"
import {AbstractList, AbstractListConfig, List, syncListContents} from "./list"
import {Action, ModelKey, ModelProvider, Spec} from "./model"
import {
  AbstractLabel,
  AbstractLabelConfig,
  AltMask,
  CtrlMask,
  MetaMask,
  ShiftMask,
  getCommandKeys,
  modMask,
} from "./text"

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

/** Defines the styles that apply to [[Menu]]. */
export interface MenuStyle {
  minWidth? :number
}

export interface AbstractMenuConfig extends ControlConfig {
  element? :ElementConfig
  data? :Spec<ModelProvider>
  keys? :Spec<Source<ModelKey[]>>
  style :PMap<MenuStyle>
}

const preferredSize = dim2.create()
const listBounds = rect.create()

/** Base class for Menu and MenuItem. */
abstract class AbstractMenu extends AbstractButton {
  private _list? :List
  private readonly _combinedBounds = rect.create()

  constructor (private _ctx :ElementContext, parent :Element, readonly config :AbstractMenuConfig) {
    super(_ctx, parent, config, () => this._activate())
    const keys = _ctx.model.resolveOpt(config.keys)
    this.disposer.add(this._hovered.onValue(hovered => {
      if (!hovered) return
      for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor instanceof MenuBar) {
          for (const element of ancestor.contents) {
            const menu = element as Menu
            if (menu._list && element !== this) {
              menu._toggle()
              if (!this._list) this._toggle()
              return
            }
          }
          return
        } else if (ancestor instanceof AbstractMenu) {
          if (!ancestor._list) return
          for (const element of ancestor._list.contents) {
            const menu = element as AbstractMenu
            if (menu._list && menu !== this) {
              menu._toggle()
            }
          }
          if (keys && !this._list) this._toggle()
          return
        }
      }
    }))
  }

  findChild (type :string) :Element|undefined {
    return super.findChild(type) || (this._list && this._list.findChild(type))
  }
  findTaggedChild (tag :string) :Element|undefined {
    return super.findTaggedChild(tag) || (this._list && this._list.findTaggedChild(tag))
  }

  applyToContaining (canvas :CanvasRenderingContext2D, pos :vec2, op :(element :Element) => void) {
    super.applyToContaining(canvas, pos, op)
    this._list && this._list.applyToContaining(canvas, pos, op)
  }
  applyToIntersecting (region :rect, op :(element :Element) => void) {
    super.applyToIntersecting(region, op)
    this._list && this._list.applyToIntersecting(region, op)
  }

  maybeHandleMouseDown (event :MouseEvent, pos :vec2) {
    return rect.contains(this.expandBounds(this.bounds), pos)
      ? this.handleMouseDown(event, pos)
      : undefined
  }
  handleMouseDown (event :MouseEvent, pos :vec2) :MouseInteraction|undefined {
    if (!this._list) return super.handleMouseDown(event, pos)
    const interaction = this._list.handleMouseDown(event, pos)
    if (interaction) return interaction
    this._closeAncestors()
    // return a dummy interaction just to prevent others from handling the event
    return {move: Noop, release: Noop, cancel: Noop}
  }

  expandBounds (bounds :rect) :rect {
    // when the menu is showing, capture all events
    return this._list ? this.root.bounds : bounds
  }

  dirty (region :rect = this._combineBounds(this._bounds), fromChild :boolean = false) {
    super.dirty(region, fromChild)
  }

  private _combineBounds (bounds :rect) {
    if (!this._list) return bounds
    return rect.union(
      this._combinedBounds,
      bounds,
      this._list.bounds,
    )
  }

  protected _activate () {
    this._toggle()
  }

  protected _closeAncestors () {
    if (this._list) this._toggle()
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor instanceof AbstractMenu) {
        ancestor._toggle()
      }
    }
  }

  protected _toggle () {
    if (this._list) {
      this.dirty(this.expandBounds(this.bounds))
      this._list.dispose()
      this._list = undefined
      return
    }
    this._list = this._ctx.elem.create(this._ctx, this, {
      type: "list",
      offPolicy: "stretch",
      element: this.config.element,
      data: this.config.data,
      keys: this.config.keys,
    }) as List
    this.invalidate()
  }

  protected relayout () {
    super.relayout()
    if (this._list) {
      const style = this.getStyle(this.config.style, "normal")
      const minWidth = getValue(style.minWidth, 100)
      dim2.copy(preferredSize, this._list.preferredSize(minWidth, -1))
      let x = this.x, y = this.y
      if (this.parent instanceof MenuBar) y += this.height + 1
      else x += this.width + 1
      this._list.setBounds(rect.set(
        listBounds,
        x,
        y,
        Math.max(preferredSize[0], minWidth),
        preferredSize[1],
      ))
    }
  }

  protected revalidate () {
    super.revalidate()
    if (this._list) this._list.validate()
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    if (this._list) this._list.render(canvas, region)
  }

  dispose () {
    super.dispose()
    if (this._list) this._list.dispose()
  }
}

/** Defines configuration for [[Menu]] elements. */
export interface MenuConfig extends AbstractMenuConfig {
  type :"menu"
  shortcutKeys? :Spec<Value<string[]>>
  shortcutData? :Spec<ModelProvider>
}

const MenuStyleScope = {id: "menu", states: ButtonStates}

/** A menu within a menu bar. */
export class Menu extends AbstractMenu {
  private readonly _shortcutData? :ModelProvider

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuConfig) {
    super(ctx, parent, config)
    const shortcutKeys = ctx.model.resolveOpt(config.shortcutKeys)
    this._shortcutData = ctx.model.resolveOpt(config.shortcutData)
    if (!(shortcutKeys && this._shortcutData)) return
    this.disposer.add(this.root.unclaimedKeyEvent.onEmit(event => {
      for (const key of shortcutKeys.current) {
        for (const [flags, code] of getCommandKeys(key)) {
          if (flags === modMask(event) && code === event.code && this.activateShortcut(key)) {
            event.preventDefault()
            return
          }
        }
      }
    }))
  }

  /** Activates the shortcut identified by the supplied key. */
  activateShortcut (key :string) :boolean {
    if (!this._shortcutData) throw new Error("Missing shortcut data")
    const data = this._shortcutData.resolve(key)
    const enabled = data.resolve<Value<boolean>>("enabled", trueValue)
    if (enabled.current) {
      data.resolve<Action>("action")()
      return true
    }
    return false
  }

  get styleScope () { return MenuStyleScope }
}

/** Defines configuration for [[MenuItem]] elements. */
export interface MenuItemConfig extends AbstractMenuConfig {
  type :"menuitem"
  action? :Spec<Action>
  shortcut? :Spec<Value<string>>
  separator? :Spec<Value<boolean>>
}

const MenuItemStyleScope = {id: "menuitem", states: [...ButtonStates, "separator"]}

/** A menu item within a menu. */
export class MenuItem extends AbstractMenu {
  private readonly _separator :Value<boolean>
  private readonly _action? :Action

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuItemConfig) {
    super(
      ctx,
      parent,
      {
        ...config,
        enabled: Value.join(
          ctx.model.resolve(config.enabled, trueValue),
          ctx.model.resolve(config.separator, falseValue),
        ).map(([enabled, separator]) => enabled && !separator),
      },
    )
    this._separator = ctx.model.resolve(config.separator, falseValue)
    this.disposer.add(this._separator.onValue(() => this._state.update(this.computeState)))
    this._action = ctx.model.resolveOpt(config.action)
    if (this._action) return
    const shortcut = ctx.model.resolveOpt(config.shortcut)
    if (!shortcut) return
    this._action = () => {
      for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor instanceof Menu) {
          ancestor.activateShortcut(shortcut.current)
          return
        }
      }
    }
  }

  get styleScope () { return MenuItemStyleScope }

  protected get computeState () {
    return this._separator && this._separator.current ? "separator" : super.computeState
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    if (this._separator.current) dim2.set(into, hintX, 1)
    else super.computePreferredSize(hintX, hintY, into)
  }

  protected _activate () {
    if (this._action) {
      this._closeAncestors()
      this._action()
    } else this._toggle()
  }
}

export type KeyCombo = [string, string]

/** Defines configuration for [[MenuItem]] elements. */
export interface ShortcutConfig extends AbstractLabelConfig {
  type :"shortcut"
  command? :Spec<Value<string>>
}

const codeReplacements = {Escape: "Esc", Equal: "=", Minus: "-"}

export class Shortcut extends AbstractLabel {

  constructor (ctx :ElementContext, parent :Element, readonly config :ShortcutConfig) {
    super(
      ctx,
      parent,
      config,
      ctx.model.resolve(config.command, Value.constant("")).map((command :string) => {
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
      }),
    )
  }
}
