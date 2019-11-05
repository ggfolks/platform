import {dim2, rect, vec2} from "../core/math"
import {Mutable, Value, falseValue, trueValue} from "../core/react"
import {AbstractButton, ButtonStates} from "./button"
import {VGroup} from "./group"
import {AbstractList, AbstractListConfig, syncListContents} from "./list"
import {ControlConfig, Element, ElementConfig, ElementContext, Root} from "./element"
import {Action, ModelKey, ElementsModel, Spec} from "./model"

/** The available drop directions. */
export type DropDirection = "down" | "right" | "left"

/** Base configuration for dropdowns, menus, menu items. */
export interface AbstractDropdownConfig extends ControlConfig {
  dropLeft? :boolean
  element? :ElementConfig
  model? :Spec<ElementsModel<ModelKey>>
}

export interface DropdownHost {
  openChild :Mutable<Element|undefined>
  autoActivate :boolean
}

function findDropdownHost (elem :Element) :DropdownHost|undefined {
  const rawElem = elem as any
  if (rawElem.openChild instanceof Mutable) return rawElem
  else return elem.parent && findDropdownHost(elem.parent)
}

export interface DropdownListConfig extends AbstractListConfig {
  type :"dropdownList"
}

export class DropdownList extends VGroup implements AbstractList, DropdownHost {
  readonly elements = new Map<ModelKey, Element>()
  readonly contents :Element[] = []

  readonly openChild = Mutable.local<Element|undefined>(undefined)
  get autoActivate () { return true}

  constructor (ctx :ElementContext, parent :Element, readonly config :DropdownListConfig) {
    super(ctx, parent, config)
    this.disposer.add(syncListContents(ctx, this))
  }
}

/** Base class for Dropdown, Menu, and MenuItem. */
export abstract class AbstractDropdown extends AbstractButton {
  protected _listRoot :Root

  constructor (ctx :ElementContext, parent :Element, readonly config :AbstractDropdownConfig) {
    super(ctx, parent, config)
    this._listRoot = this.root.createPopup(ctx, {
      type: "root",
      autoSize: true,
      contents: {
        type: "dropdownList",
        offPolicy: "stretch",
        element: config.element,
        model: config.model,
      }
    })

    // if our parent maintains a list of dropdowns (it is a menu bar or a dropdown of nested
    // dropdowns), then coordinate with our siblings via `openChild`
    const dhost = findDropdownHost(parent)
    if (dhost) {
      // no need to dispose these connections because all the lifecycles are the same
      this._listRoot.host.onValue(host => {
        if (host) dhost.openChild.update(this)
        else dhost.openChild.updateIf(c => c === this, undefined)
      })
      dhost.openChild.onValue(open => {
        if (open !== undefined && open !== this) this.setOpen(false)
      })
      this._hovered.onValue(hovered => {
        if (hovered && dhost.autoActivate) this.setOpen(true)
      })
    }
  }

  get isOpen () :boolean { return this._listRoot.host.current !== undefined }

  setOpen (open :boolean) {
    const lroot = this._listRoot
    if (this.isOpen && !open) {
      this.root.menuPopup.updateIf(r => r === lroot, undefined)
    } else if (open && !this.isOpen) {
      const lsize = lroot.sizeToFit()
      const pos = rect.pos(this.bounds)
      switch (this._dropDirection) {
      case "left":
        pos[0] -= lsize[0] + 1
        break
      case "right":
        pos[0] += this.width + 1
        break
      case "down":
        if (this.config.dropLeft) pos[0] += this.width - lsize[0]
        pos[1] += this.height + 1
        break
      }
      lroot.setOrigin(vec2.add(pos, pos, this.root.origin))
      this.root.menuPopup.update(lroot)
    }
  }

  protected onClick () { this.setOpen(true) }

  protected get _dropDirection () :DropDirection { return "down" }

  dispose () {
    this.setOpen(false)
    this._listRoot.dispose()
    super.dispose()
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
    this._separator = ctx.model.resolve(config.separator, falseValue)
    this.disposer.add(this._separator.onValue(() => this._state.update(this.computeState)))
    this._action = ctx.model.resolveActionOpt(config.action)
  }

  protected actionSpec (config :ControlConfig) {
    return (config as AbstractDropdownItemConfig).action
  }

  protected get computeState () {
    return this._separator && this._separator.current ? "separator" : super.computeState
  }

  protected get _dropDirection () :DropDirection {
    return this.config.dropLeft ? "left" : "right"
  }

  protected computePreferredSize (hintX :number, hintY :number, into :dim2) {
    if (this._separator.current) dim2.set(into, 1, 1)
    else super.computePreferredSize(hintX, hintY, into)
  }

  protected onClick () {
    if (this._action) {
      this.root.clearMenuPopups()
      this._action()
    } else super.onClick()
  }
}

/** Defines configuration for [[DropdownItem]] elements. */
export interface DropdownItemConfig extends AbstractDropdownItemConfig {
  type :"dropdownItem"
}

const DropdownItemStyleScope = {id: "dropdownItem", states: [...ButtonStates, "separator"]}

/** An item in a dropdown menu. */
export class DropdownItem extends AbstractDropdownItem {

  constructor (ctx :ElementContext, parent :Element, readonly config :DropdownItemConfig) {
    super(ctx, parent, config)
  }

  get styleScope () { return DropdownItemStyleScope }
}

/** Creates and returns a generic dropdown item config with support for submenus and separators.
  * @param maxDepth the maximum submenu depth.
  * @param [type="dropdownItem"] the item type ("dropdownItem" or "menuItem").
  * @param [dropLeft=false] if true, drop left rather than right.
  * @param [scopeId] a replacement scope id to use. */
export function createDropdownItemConfig (
  maxDepth :number,
  type = "dropdownItem",
  dropLeft = false,
  scopeId? :string,
  checkable = false,
) :AbstractDropdownItemConfig {
  let element :AbstractDropdownItemConfig = {
    type,
    dropLeft,
    contents: {
      type: "box",
      scopeId,
      contents: {type: "label", text: "name"},
      style: {halign: "left"},
    },
    action: "action",
    style: {},
  }
  const toggle = (type === "menuItem") ? [
    {
      type: "box",
      scopeId: "menuItemCheckBoxContainer",
      contents: {
        type: "toggle",
        visible: "checkable",
        checked: "checked",
        onClick: "action",
        contents: {
          type: "box",
          scopeId: "menuItemCheckBox",
          contents: {type: "label", text: Value.constant(" ")},
        },
        checkedContents: {
          type: "box",
          scopeId: "menuItemCheckBoxChecked",
          contents: {type: "label", text: Value.constant("✔︎")},
        },
      },
    },
  ] : []
  for (; maxDepth > 0; maxDepth--) {
    element = {
      type,
      dropLeft,
      contents: {
        type: "box",
        scopeId,
        contents: {
          type: "row",
          offPolicy: "stretch",
          contents: dropLeft ? [
            {type: "shortcut", command: "shortcut"},
            {type: "label", text: Value.constant("◂"), visible: "submenu"},
            {type: "spacer", width: 15, constraints: {stretch: true}},
            {type: "label", text: "name"},
            ...toggle,
          ] : [
            ...toggle,
            {type: "label", text: "name"},
            {type: "spacer", width: 15, constraints: {stretch: true}},
            {type: "label", text: Value.constant("▸"), visible: "submenu"},
            {type: "shortcut", command: "shortcut"},
          ],
        },
        style: {halign: "stretch"},
      },
      element,
      model: "model",
      action: "action",
      separator: "separator",
      style: {},
    }
  }
  return element
}
