import {dim2, rect} from "../core/math"
import {Noop} from "../core/util"
import {Mutable, Value} from "../core/react"
import {AbstractButton, ButtonStates} from "./button"
import {VGroup} from "./group"
import {List, List as ListX, ElementConfigMaker} from "./list"
import {Control, Element, Root} from "./element"
import {Action, ModelKey, ElementsModel, Spec} from "./model"

export namespace Dropdown {

  /** The available drop directions. */
  export type Direction = "down" | "right" | "left"

  export interface Host {
    activeChild :Mutable<Abstract|undefined>
    autoActivate :boolean
  }

  function findHost (elem :Element) :Host|undefined {
    const rawElem = elem as any
    if (rawElem.activeChild instanceof Mutable) return rawElem
    else return elem.parent && findHost(elem.parent)
  }

  export interface ListConfig extends List.AbstractConfig {
    type :"dropdownList"
  }

  export class List extends VGroup implements List.Like, Host {
    readonly elements = new Map<ModelKey, Element>()
    readonly contents :Element[] = []

    readonly activeChild = Mutable.local<Abstract|undefined>(undefined)
    get autoActivate () { return true }

    constructor (ctx :Element.Context, parent :Element, readonly config :ListConfig) {
      super(ctx, parent, config)
      const model = ctx.model.resolveAs(config.model, "model")
      this.disposer.add(ListX.syncContents(ctx, this, model))
    }
  }

  /** Base configuration for dropdowns, menus, menu items. */
  export interface AbstractConfig extends Control.Config {
    dropLeft? :boolean
    element? :Element.Config
    model? :Spec<ElementsModel<ModelKey>>
  }

  /** Base class for Dropdown, Menu, and MenuItem. */
  export abstract class Abstract extends AbstractButton {
    protected _listRoot :Root|undefined

    constructor (ctx :Element.Context, parent :Element, readonly config :AbstractConfig) {
      super(ctx, parent, config)

      // if our parent maintains a list of dropdowns (a menu bar or a dropdown of nested dropdowns),
      // then coordinate with our siblings via its `activeChild`
      const dhost = findHost(parent)
      const clearActive = dhost ?
        () => dhost.activeChild.updateIf(c => c === this, undefined) : Noop

      if (ctx.model.resolveOpt(config.model)) {
        this.disposer.add(this._listRoot = this.root.createPopup(ctx, {
          type: "root",
          autoSize: true,
          contents: {
            type: "dropdownList",
            offPolicy: "stretch",
            element: config.element,
            model: config.model,
          }
        }))
        this._listRoot.host.when(h => !h, clearActive)
      }

      if (dhost) {
        this.disposer.add(dhost.activeChild.onValue(child => {
          if (child !== undefined && child !== this) this.setOpen(false)
        }))
        this.hovered.onValue(hovered => {
          if (hovered) {
            if (dhost.autoActivate) this.setOpen(true)
            dhost.activeChild.update(this)
          }
          else if (!this.isOpen) clearActive()
        })
      }
    }

    get isOpen () :boolean {
      return this._listRoot ? this._listRoot.host.current !== undefined : false
    }

    get isOpenValue () :Value<boolean> {
      return this.root.menuPopup.map(pop => pop === this._listRoot)
    }

    setOpen (open :boolean) {
      const lroot = this._listRoot
      if (!lroot) return
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
        lroot.origin.update(this.toHostCoords(pos, false))
        this.root.menuPopup.update(lroot)
      }
    }

    dispose () {
      this.setOpen(false)
      super.dispose()
    }

    protected onClick () { this.setOpen(!this.isOpen) }

    protected get _dropDirection () :Direction { return "down" }
  }

  const StyleScope = {id: "dropdown", states: ButtonStates}

  /** Defines configuration for [[Dropdown]] elements. */
  export interface Config extends AbstractConfig {
    type :"dropdown"
  }

  /** A dropdown menu. */
  export class Dropdown extends Abstract {

    constructor (ctx :Element.Context, parent :Element, readonly config :Config) {
      super(ctx, parent, config)

      this.isOpenValue.onValue(open => {
        if (open) this.root.targetElem.update(this)
        else this.root.targetElem.updateIf(e => e === this, undefined)
      })
    }

    get styleScope () { return StyleScope }
  }

  export class Separator extends Element {

    constructor (ctx :Element.Context, parent :Element, readonly config :Element.Config) {
      super(ctx, parent, config)
    }

    protected computePreferredSize (hintX :number, hintY :number, into :dim2) { dim2.set(into, 1, 1) }
    protected relayout () {}
    protected rerender (canvas :CanvasRenderingContext2D, region :rect) {}
  }

  /** Base configuration for dropdown and menu items. */
  export interface AbstractItemConfig extends AbstractConfig {
    action? :Spec<Action>
  }

  /** Base class for dropdown and menu items. */
  export class AbstractItem extends Abstract {
    protected _action? :Action

    constructor (ctx :Element.Context, parent :Element, readonly config :AbstractItemConfig) {
      super(ctx, parent, config)
      this._action = ctx.model.resolveActionOpt(config.action)
    }

    protected actionSpec (config :Control.Config) {
      return (config as AbstractItemConfig).action
    }

    protected get _dropDirection () :Direction {
      return this.config.dropLeft ? "left" : "right"
    }

    protected onClick () {
      if (this._action) {
        this.root.clearMenuPopups()
        this._action()
      } else super.onClick()
    }
  }

  /** Defines configuration for [[Item]] elements. */
  export interface ItemConfig extends AbstractItemConfig {
    type :"dropdownItem"
  }

  const ItemStyleScope = {id: "dropdownItem", states: ButtonStates}

  /** An item in a dropdown menu. */
  export class Item extends AbstractItem {
    get styleScope () { return ItemStyleScope }
  }

  /** Creates and returns a generic dropdown item config with support for submenus and separators.
    * @param maxDepth the maximum submenu depth.
    * @param [type="dropdownItem"] the item type ("dropdownItem" or "menuItem").
    * @param [dropLeft=false] if true, drop left rather than right.
    * @param [scopeId] a replacement scope id to use. */
  export function createItemConfig (
    type = "dropdownItem",
    dropLeft = false,
    scopeId? :string,
    checkable = false,
  ) :ElementConfigMaker {
    return (model, key) => {
      if (typeof key === "string" && key.startsWith("separator")) return {type: "separator"}

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

      return {
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
        element: createItemConfig(type, dropLeft, scopeId, checkable),
        model: "model",
        enabled: "enabled",
        action: "action",
        style: {},
      }
    }
  }

  export const Catalog :Element.Catalog = {
    "dropdown": (ctx, parent, config) => new Dropdown(ctx, parent, config as Config),
    "dropdownList": (ctx, parent, config) => new List(ctx, parent, config as ListConfig),
    "dropdownItem": (ctx, parent, config) => new Item(ctx, parent, config as ItemConfig),
    "separator": (ctx, parent, config) => new Separator(ctx, parent, config),
  }
}
