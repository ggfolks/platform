import {Color, Euler, Math as M, Vector3} from "three"

import {vec3} from "../core/math"
import {Mutable, Value} from "../core/react"
import {PMap, toLimitedString} from "../core/util"
import {EnumMeta, NumberConstraints, getEnumMeta} from "../graph/meta"
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
            ctx.remodel(model),
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

const NumberBox = {type: "box", contents: {type: "label"}, style: {halign: "right"}}

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
  number: (model, editable) => {
    const constraints = model.resolve<Value<NumberConstraints>>("constraints").current
    return createPropertyRowConfig(model, {
      type: "numbertext",
      constraints: {stretch: true},
      number: "value",
      enabled: editable,
      contents: NumberBox,
      ...constraints,
    })
  },
  boolean: (model, editable) => {
    const value = model.resolve<Mutable<boolean>>("value")
    return createPropertyRowConfig(model, {
      type: "toggle",
      checked: value,
      onClick: () => value.update(!value.current),
      enabled: editable,
      contents: {
        type: "box",
        scopeId: "checkBox",
        contents: {type: "label", text: Value.constant(" ")},
      },
      checkedContents: {
        type: "box",
        scopeId: "checkBoxChecked",
        contents: {type: "label", text: Value.constant("✔︎")},
      },
    })
  },
  vec3: (model, editable) => {
    const value = model.resolve<Mutable<vec3>>("value")
    return createPropertyRowConfig(model, {
      type: "row",
      constraints: {stretch: true},
      contents: [
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(v => v[0], (v, x) => vec3.fromValues(x, v[1], v[2])),
          contents: NumberBox,
        },
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(v => v[1], (v, y) => vec3.fromValues(v[0], y, v[2])),
          contents: NumberBox,
        },
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(v => v[2], (v, z) => vec3.fromValues(v[0], v[1], z)),
          contents: NumberBox,
        },
      ],
    })
  },
  Vector3: (model, editable) => {
    const value = model.resolve<Mutable<Vector3>>("value")
    return createPropertyRowConfig(model, {
      type: "row",
      constraints: {stretch: true},
      contents: [
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(v => v.x, (v, x) => new Vector3(x, v.y, v.z)),
          contents: NumberBox,
        },
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(v => v.y, (v, y) => new Vector3(v.x, y, v.z)),
          contents: NumberBox,
        },
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(v => v.z, (v, z) => new Vector3(v.x, v.y, z)),
          contents: NumberBox,
        },
      ],
    })
  },
  Euler: (model, editable) => {
    const value = model.resolve<Mutable<Euler>>("value")
    return createPropertyRowConfig(model, {
      type: "row",
      contents: [
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(e => M.radToDeg(e.x), (e, x) => new Euler(M.degToRad(x), e.y, e.z)),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
        },
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(e => M.radToDeg(e.y), (e, y) => new Euler(e.x, M.degToRad(y), e.z)),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
        },
        {
          type: "numbertext",
          constraints: {stretch: true},
          number: value.bimap(e => M.radToDeg(e.z), (e, z) => new Euler(e.x, e.y, M.degToRad(z))),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
        },
      ],
    })
  },
  Color: (model, editable) => {
    const value = model.resolve<Mutable<Color>>("value")
    return createPropertyRowConfig(model, {
      type: "colortext",
      constraints: {stretch: true},
      color: value.bimap(c => c.getHexString(), (c, s) => new Color("#" + s)),
      enabled: editable,
      contents: {
        type: "box",
        contents: {type: "label"},
        style: {halign: "left"},
      },
    })
  },
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
