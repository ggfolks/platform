import {vec2} from "../core/math"
import {Mutable, Source, Value} from "../core/react"
import {Noop} from "../core/util"
import {
  Control, ControlConfig, ControlStates, Element, ElementConfig, ElementContext, PointerInteraction,
} from "./element"
import {AxisConfig, OffAxisPolicy, VGroup} from "./group"
import {ModelKey, ModelProvider, Spec} from "./model"

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
}

/** Contains a row of tabs and corresponding content pane. */
export class TabbedPane extends VGroup {
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :TabbedPaneConfig) {
    super(ctx, parent, config)
    const activeKey = ctx.model.resolve(config.activeKey)
    const hlistConfig = {
      type: "hlist",
      element: {
        type: "tab",
        contents: config.tabElement,
        key: config.key,
        activeKey,
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
}

const TabStyleScope = {id: "tab", states: [...ControlStates, "selected"]}

/** A single tab in a row. */
export class Tab extends Control {
  private readonly _key :Value<string>
  private readonly _activeKey :Mutable<ModelKey>

  constructor (ctx :ElementContext, parent :Element, readonly config :TabConfig) {
    super(ctx, parent, config)
    this._key = ctx.model.resolve<Value<string>>(config.key)
    this._activeKey = ctx.model.resolve(config.activeKey)
    this.disposer.add(this._activeKey.onValue(_ => this._state.update(this.computeState)))
  }

  get styleScope () { return TabStyleScope }

  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2) :PointerInteraction|undefined {
    if (
      event instanceof MouseEvent && event.button !== 0 ||
      !this.visible.current ||
      !this.enabled.current
    ) {
      return undefined
    }
    this._activeKey.update(this._key.current)
    return {move: Noop, release: Noop, cancel: Noop}
  }

  protected get computeState () {
    // meh, this can be called before our constructor runs...
    const selected = (this._key && this._activeKey && this._activeKey.current === this._key.current)
    return this.enabled.current && selected ? "selected" : super.computeState
  }
}
