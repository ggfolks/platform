import {Mutable, Value} from "../core/react"
import {PMap} from "../core/util"
import {EnumMeta, getEnumMeta} from "../graph/meta"
import {Element, ElementConfig, ElementContext} from "./element"
import {AxisConfig, VGroup} from "./group"
import {Model, ModelKey, ModelProvider, Spec} from "./model"

/** Configuration for [[PropertyView]]. */
export interface PropertyViewConfig extends AxisConfig {
  type :"propertyview"
  editable :Spec<Value<boolean>>
  keys :Spec<Value<string[]>>
  data :Spec<ModelProvider>
}

/** Depicts a node's editable/viewable properties. */
export class PropertyView extends VGroup {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :PropertyViewConfig) {
    super(ctx, parent, config)
    const propertyData = ctx.model.resolve(config.data)
    const editable = ctx.model.resolve(config.editable)
    this.disposer.add(ctx.model.resolve(config.keys).onValue(keys => {
      const {contents, elements} = this
      // first dispose no longer used elements
      const kset = new Set(keys)
      for (const [ekey, elem] of elements.entries()) {
        if (!kset.has(ekey)) {
          elements.delete(ekey)
          elem.dispose()
        }
      }
      // now create/reuse elements for the new keys
      contents.length = 0
      for (const key of kset) {
        let elem = this.elements.get(key)
        if (!elem) {
          const model = propertyData.resolve(key)
          elem = ctx.elem.create(
            {...ctx, model},
            this,
            createPropertyElementConfig(model, editable),
          )
          this.elements.set(key, elem)
        }
        contents.push(elem)
      }
      this.invalidate()
    }))
  }
}

type PropertyConfigCreator = (model :Model, editable :Value<boolean>) => ElementConfig

const propertyConfigCreators :PMap<PropertyConfigCreator> = {
  string: (model, editable) => createPropertyRowConfig(model, {
    type: "text",
    constraints: {stretch: true},
    text: "value",
    enabled: editable,
    contents: {
      type: "box",
      contents: {type: "label", text: "value"},
      style: {halign: "left"},
    },
  }),
}

function createPropertyElementConfig (model :Model, editable :Value<boolean>) {
  const type = model.resolve<Value<string>>("type")
  const creator = propertyConfigCreators[type.current]
  if (creator) return creator(model, editable)
  const enumMeta = getEnumMeta(type.current)
  if (enumMeta) return createEnumPropertyConfig(model, editable, enumMeta)
  return createPropertyRowConfig(model, {
    type: "label",
    constraints: {stretch: true},
    text: model.resolve<Value<any>>("value").map(toLimitedString),
  })
}

function createEnumPropertyConfig (model :Model, editable :Value<boolean>, enumMeta :EnumMeta) {
  const value = model.resolve<Mutable<string>>("value")
  return createPropertyRowConfig(model, {
    type: "dropdown",
    enabled: editable,
    contents: {
      type: "box",
      contents: {type: "label", text: "value"},
    },
    element: {
      type: "dropdownitem",
      contents: {
        type: "box",
        contents: {type: "label", text: "name"},
        style: {halign: "left"},
      },
      action: "action",
    },
    keys: Value.constant(enumMeta.values),
    data: {
      resolve: (key :ModelKey) => new Model({
        name: Value.constant(key as string),
        action: () => value.update(key as string),
      }),
    },
  })
}

function createPropertyRowConfig (model :Model, valueConfig :ElementConfig) {
  return {
    type: "row",
    gap: 2,
    contents: [
      {
        type: "box",
        constraints: {stretch: true},
        style: {halign: "left"},
        contents: {
          type: "label",
          text: model.resolve<Value<string>>("name").map(name => name + ":"),
        },
      },
      valueConfig,
    ],
  }
}

function toLimitedString (value :any) {
  // round numbers to six digits after decimal
  if (typeof value === "number") return String(Math.round(value * 1000000) / 1000000)
  const string = String(value)
  return string.length > 30 ? string.substring(0, 27) + "..." : string
}
