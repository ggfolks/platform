import {dim2, rect, vec2} from "../core/math"
import {Source, Value} from "../core/react"
import {Noop, PMap, getValue} from "../core/util"
import {AbstractButton, ButtonStates} from "./button"
import {
  ControlConfig, Element, ElementConfig, ElementContext,
  MouseInteraction, falseValue, trueValue,
} from "./element"
import {List} from "./list"
import {Action, ModelKey, ModelProvider, Spec} from "./model"

/** Defines the styles that apply to [[Dropdown]]. */
export interface DropdownStyle {
  minWidth? :number
}

/** Base configuration for dropdowns, menus, menu items. */
export interface AbstractDropdownConfig extends ControlConfig {
  element? :ElementConfig
  keys? :Spec<Source<ModelKey[]>>
  data? :Spec<ModelProvider>
  style :PMap<DropdownStyle>
}

const preferredSize = dim2.create()
const listBounds = rect.create()

/** Base class for Dropdown, Menu, and MenuItem. */
export abstract class AbstractDropdown extends AbstractButton {
  protected _list? :List
  private readonly _combinedBounds = rect.create()

  get list () { return this._list }

  constructor (
    private _ctx :ElementContext,
    parent :Element,
    readonly config :AbstractDropdownConfig,
  ) {
    super(_ctx, parent, config, () => this._activate())
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
    this._closeAll()
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

  toggle () {
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

  private _combineBounds (bounds :rect) {
    if (!this._list) return bounds
    return rect.union(this._combinedBounds, bounds, this._list.bounds)
  }

  protected _activate () {
    this.toggle()
  }

  protected _closeAll () {
    if (this._list) this.toggle()
    for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor instanceof AbstractDropdown) ancestor.toggle()
    }
  }

  protected relayout () {
    super.relayout()
    if (this._list) {
      const style = this.getStyle(this.config.style, "normal")
      const minWidth = getValue(style.minWidth, 100)
      dim2.copy(preferredSize, this._list.preferredSize(minWidth, -1))
      let x = this.x, y = this.y
      if (this._dropRight) x += this.width + 1
      else y += this.height + 1
      this._list.setBounds(rect.set(
        listBounds,
        x,
        y,
        Math.max(preferredSize[0], minWidth),
        preferredSize[1],
      ))
    }
  }

  protected get _dropRight () { return false }

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

/** Defines configuration for [[Dropdown]] elements. */
export interface DropdownConfig extends AbstractDropdownConfig {
  type :"dropdown"
}

const DropdownStyleScope = {id: "dropdown", states: ButtonStates}

/** A dropdown menu. */
export class Dropdown extends AbstractDropdown {

  constructor (ctx :ElementContext, parent :Element, readonly config :DropdownConfig) {
    super(ctx, parent, config)
  }

  get styleScope () { return DropdownStyleScope }
}

/** Base configuration for dropdown and menu items. */
export interface AbstractDropdownItemConfig extends AbstractDropdownConfig {
  action? :Spec<Action>
  separator? :Spec<Value<boolean>>
}

/** Base class for dropdown and menu items. */
export class AbstractDropdownItem extends AbstractDropdown {
  private readonly _separator :Value<boolean>
  protected _action? :Action

  constructor (ctx :ElementContext, parent :Element, readonly config :AbstractDropdownItemConfig) {
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
    const keys = ctx.model.resolveOpt(config.keys)
    this.disposer.add(this._hovered.onValue(hovered => {
      if (!hovered) return
      for (let ancestor = this.parent; ancestor; ancestor = ancestor.parent) {
        if (ancestor instanceof AbstractDropdown) {
          if (!ancestor.list) return
          for (const element of ancestor.list.contents) {
            const dropdown = element as AbstractDropdown
            if (dropdown.list && dropdown !== this) {
              dropdown.toggle()
            }
          }
          if (keys && !this.list) this.toggle()
          return
        }
      }
    }))
    this._separator = ctx.model.resolve(config.separator, falseValue)
    this.disposer.add(this._separator.onValue(() => this._state.update(this.computeState)))
    this._action = ctx.model.resolveOpt(config.action)
  }

  protected get computeState () {
    return this._separator && this._separator.current ? "separator" : super.computeState
  }

  protected get _dropRight () { return true }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    if (this._separator.current) dim2.set(into, hintX, 1)
    else super.computePreferredSize(hintX, hintY, into)
  }

  protected _activate () {
    if (this._action) {
      this._closeAll()
      this._action()
    } else this.toggle()
  }
}

/** Defines configuration for [[DropdownItem]] elements. */
export interface DropdownItemConfig extends AbstractDropdownItemConfig {
  type :"dropdownitem"
}

const DropdownItemStyleScope = {id: "dropdownitem", states: [...ButtonStates, "separator"]}

/** An item in a dropdown menu. */
export class DropdownItem extends AbstractDropdownItem {

  constructor (ctx :ElementContext, parent :Element, readonly config :DropdownItemConfig) {
    super(ctx, parent, config)
  }

  get styleScope () { return DropdownItemStyleScope }
}
