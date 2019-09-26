import {rect, vec2} from "../core/math"
import {Mutable, Source, Value} from "../core/react"
import {Noop} from "../core/util"
import {
  Control, ControlConfig, ControlStates, Element, ElementConfig, ElementContext, PointerInteraction,
} from "./element"
import {AxisConfig, OffAxisPolicy, VGroup} from "./group"
import {ModelKey, ModelProvider, Spec} from "./model"

type OrderUpdater = (key :string, index :number) => void

/** Defines configuration for [[TabbedPane]] elements. */
export interface TabbedPaneConfig extends AxisConfig {
  type :"tabbedpane"
  tabElement :ElementConfig
  addTabElement? :ElementConfig
  contentElement :ElementConfig
  data :Spec<ModelProvider>
  keys :Spec<Source<ModelKey[]>>
  key :string
  activeKey :Spec<Mutable<ModelKey>>
  updateOrder? :Spec<OrderUpdater>
}

/** Contains a row of tabs and corresponding content pane. */
export class TabbedPane extends VGroup {
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :TabbedPaneConfig) {
    super(ctx, parent, config)
    const activeKey = ctx.model.resolve(config.activeKey)
    const updateOrder = config.updateOrder && ctx.model.resolve(config.updateOrder)
    const hlistConfig = {
      type: "hlist",
      element: {
        type: "tab",
        contents: config.tabElement,
        key: config.key,
        activeKey,
        updateOrder,
      },
      data: config.data,
      keys: config.keys,
    }
    this.contents.push(
      ctx.elem.create(ctx, this, {
        type: "box",
        scopeId: "tabList",
        contents: config.addTabElement ? {
          type: "row",
          contents: [hlistConfig, config.addTabElement],
        } : hlistConfig,
        style: {halign: "left"},
      })
    )
    const data = ctx.model.resolve(config.data)
    this.disposer.add(activeKey.onValue(activeKey => {
      const oldElement = this.contents[1]
      if (oldElement) oldElement.dispose()
      const model = data.resolve(activeKey)
      this.contents[1] = ctx.elem.create(ctx.remodel(model), this, config.contentElement)
      this.invalidate()
    }))
  }

  protected get defaultOffPolicy () :OffAxisPolicy { return "stretch" }
}

/** Defines configuration for [[Tab]] elements. */
export interface TabConfig extends ControlConfig {
  type :"tab"
  key :string
  activeKey :Spec<Mutable<ModelKey>>
  updateOrder? :Spec<OrderUpdater>
}

const TabStyleScope = {id: "tab", states: [...ControlStates, "selected"]}

const tmpr = rect.create()

/** A single tab in a row. */
export class Tab extends Control {
  private readonly _key :Value<string>
  private readonly _activeKey :Mutable<ModelKey>
  private readonly _orderUpdater? :OrderUpdater
  private _dragX? :number

  constructor (ctx :ElementContext, parent :Element, readonly config :TabConfig) {
    super(ctx, parent, config)
    this._key = ctx.model.resolve<Value<string>>(config.key)
    this._activeKey = ctx.model.resolve(config.activeKey)
    this.disposer.add(this._activeKey.onValue(_ => this._state.update(this.computeState)))
    if (config.updateOrder) this._orderUpdater = ctx.model.resolve(config.updateOrder)
  }

  get styleScope () { return TabStyleScope }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    const interaction = this.contents.handlePointerDown(event, pos)
    if (interaction) return interaction
    if (
      event instanceof MouseEvent && event.button !== 0 ||
      !this.visible.current ||
      !this.enabled.current
    ) {
      return undefined
    }
    this._activeKey.update(this._key.current)
    if (!this._orderUpdater) return {move: Noop, release: Noop, cancel: Noop}
    const startPos = vec2.clone(pos)
    const offsetX = this.x - startPos[0]
    const DragHysteresis = 5
    const clear = () => {
      this.clearCursor(this)
      this.dirty()
      this._dragX = undefined
    }
    return {
      move: (moveEvent :MouseEvent|TouchEvent, pos :vec2) => {
        if (this._dragX === undefined && vec2.distance(startPos, pos) < DragHysteresis) return
        this.setCursor(this, "move")
        this.dirty()
        this._dragX = pos[0] + offsetX
        this.dirty()
      },
      release: (upEvent :MouseEvent|TouchEvent, pos :vec2) => {
        clear()
      },
      cancel: clear,
    }
  }

  handleDoubleClick (event :MouseEvent, pos :vec2) :boolean {
    return this.contents.handleDoubleClick(event, pos)
  }

  expandBounds (bounds :rect) :rect {
    if (this._dragX === undefined) return super.expandBounds(bounds)
    const cbounds = this.contents.expandBounds(this.contents.bounds)
    return rect.union(
      tmpr,
      cbounds,
      rect.set(tmpr, cbounds[0] + this._dragX - this.x, cbounds[1], cbounds[2], cbounds[3]),
    )
  }

  protected get computeState () {
    // meh, this can be called before our constructor runs...
    const selected = (this._key && this._activeKey && this._activeKey.current === this._key.current)
    return this.enabled.current && selected ? "selected" : super.computeState
  }

  protected rerender (canvas :CanvasRenderingContext2D, region :rect) {
    super.rerender(canvas, region)
    if (this._dragX === undefined) return
    canvas.globalAlpha = 0.5
    canvas.translate(this._dragX - this.x, 0)
    super.rerender(canvas, region)
    canvas.translate(this.x - this._dragX, 0)
    canvas.globalAlpha = 1
  }
}
