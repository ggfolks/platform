import {dim2, rect, vec2} from "../core/math"
import {Noop, PMap, getValue} from "../core/util"
import {AbstractButton, ButtonStates} from "./button"
import {ControlConfig, Element, ElementContext, MouseInteraction} from "./element"
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

/** Defines the styles that apply to [[Menu]]. */
export interface MenuStyle {
  width? :number
}

/** Defines configuration for [[Menu]] elements. */
export interface MenuConfig extends ControlConfig, AbstractListConfig {
  type :"menu"
  style :PMap<MenuStyle>
}

const MenuStyleScope = {id: "menu", states: ButtonStates}

const preferredSize = dim2.create()
const listBounds = rect.create()

/** A menu within a menu bar. */
export class Menu extends AbstractButton {
  private _list? :Element
  private readonly _expandedBounds = rect.create()

  constructor (private _ctx :ElementContext, parent :Element, readonly config :MenuConfig) {
    super(_ctx, parent, config, () => this._toggle())
    this.disposer.add(this._hovered.onValue(hovered => {
      if (!hovered) return
      const menuBar = parent as MenuBar
      for (const element of menuBar.contents) {
        const menu = element as Menu
        if (menu._list && menu !== this) {
          menu._toggle()
          this._toggle()
        }
      }
    }))
  }

  get styleScope () { return MenuStyleScope }

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
    this._toggle()
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
      this._expandedBounds,
      bounds,
      this._list.bounds,
    )
  }

  private _toggle () {
    if (this._list) {
      this.dirty()
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
    })
    this.invalidate()
  }

  protected relayout () {
    super.relayout()
    if (this._list) {
      const style = this.getStyle(this.config.style, "normal")
      const width = getValue(style.width, 100)
      dim2.copy(preferredSize, this.contents.preferredSize(width, -1))
      this._list.setBounds(rect.set(
        listBounds,
        this.x,
        this.y + this.height,
        Math.max(preferredSize[0], width),
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

/** Defines configuration for [[MenuItem]] elements. */
export interface MenuItemConfig extends ControlConfig {
  type :"menuitem"
}

const MenuItemStyleScope = {id: "menuitem", states: ButtonStates}

/** A menu item within a menu. */
export class MenuItem extends AbstractButton {

  constructor (ctx :ElementContext, parent :Element, readonly config :MenuItemConfig) {
    super(ctx, parent, config, Noop)
  }

  get styleScope () { return MenuItemStyleScope }
}
