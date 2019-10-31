import {Color as ThreeColor, Euler as ThreeEuler, Math as M, Vector3} from "three"

import {refEquals} from "../core/data"
import {Euler, quat, vec3} from "../core/math"
import {Mutable, Value} from "../core/react"
import {PMap, toLimitedString} from "../core/util"
import {NumberConstraints, SelectConstraints, getEnumMeta} from "../graph/meta"
import {Element, ElementConfig, ElementContext} from "./element"
import {AxisConfig, VGroup} from "./group"
import {Model, ElementsModel, Spec} from "./model"

/** Configuration for [[PropertyView]]. */
export interface PropertyViewConfig extends AxisConfig {
  type :"propertyView"
  editable :Spec<Value<boolean>>
  model :Spec<ElementsModel<string>>
}

/** Depicts a node's editable/viewable properties. */
export class PropertyView extends VGroup {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :ElementContext, parent :Element, readonly config :PropertyViewConfig) {
    super(ctx, parent, config)
    const editable = ctx.model.resolve(config.editable)
    const model = ctx.model.resolve(config.model)
    this.disposer.add(model.keys.onValue(keys => {
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
          const elemModel = model.resolve(key)
          elem = ctx.elem.create(
            ctx.remodel(elemModel),
            this,
            createPropertyElementConfig(elemModel, editable),
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
  url: (model, editable) => {
    const value = model.resolve<Mutable<string>>("value")
    return createPropertyRowConfig(model, {
      type: "row",
      constraints: {stretch: true},
      offPolicy: "stretch",
      contents: [
        {
          type: "text",
          constraints: {stretch: true},
          text: "value",
          enabled: editable,
          contents: {
            type: "box",
            contents: {type: "label", text: "value"},
            style: {halign: "left"},
          },
        },
        {
          type: "button",
          visible: editable,
          contents: {
            type: "box",
            scopeId: "propertyButton",
            contents: {type: "label", text: Value.constant("⋮")},
          },
          onClick: () => {
            const input = document.createElement("input")
            input.setAttribute("type", "file")
            input.addEventListener("change", event => {
              if (!input.files || input.files.length === 0) return
              const url = URL.createObjectURL(input.files[0])
              value.update(url.toString())
              // TODO: call revokeObjectURL when finished
            })
            input.click()
          },
        },
      ],
    })
  },
  number: (model, editable) => {
    const constraints = model.resolve<Value<NumberConstraints>>("constraints").current
    return createPropertyRowConfig(model, {
      type: "numberText",
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
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(v => v[0], (v, x) => vec3.fromValues(x, v[1], v[2])),
          contents: NumberBox,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(v => v[1], (v, y) => vec3.fromValues(v[0], y, v[2])),
          contents: NumberBox,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(v => v[2], (v, z) => vec3.fromValues(v[0], v[1], z)),
          contents: NumberBox,
        },
      ],
    })
  },
  quat: (model, editable) => {
    const quatValue = model.resolve<Mutable<quat>>("value")
    let euler = Euler.fromQuat(Euler.create(), quatValue.current)
    const eulerValue = Mutable.deriveMutable(
      dispatch => quatValue.onChange((value :quat, oldValue :quat) => {
        const eulerQuat = quat.fromEuler(quat.create(), euler[0], euler[1], euler[2])
        if (!quat.equals(eulerQuat, value)) euler = Euler.fromQuat(Euler.create(), value)
        dispatch(euler, Euler.fromQuat(Euler.create(), oldValue))
      }),
      () => euler,
      (newEuler :Euler) => {
        euler = newEuler
        quatValue.update(quat.fromEuler(quat.create(), euler[0], euler[1], euler[2]))
      },
      refEquals,
    )
    return createPropertyRowConfig(model, {
      type: "row",
      constraints: {stretch: true},
      contents: [
        {
          type: "numberText",
          constraints: {stretch: true},
          number: eulerValue.bimap(e => e[0], (e, x) => Euler.fromValues(x, e[1], e[2])),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: eulerValue.bimap(e => e[1], (e, y) => Euler.fromValues(e[0], y, e[2])),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: eulerValue.bimap(e => e[2], (e, z) => Euler.fromValues(e[0], e[1], z)),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
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
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(v => v.x, (v, x) => new Vector3(x, v.y, v.z)),
          contents: NumberBox,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(v => v.y, (v, y) => new Vector3(v.x, y, v.z)),
          contents: NumberBox,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(v => v.z, (v, z) => new Vector3(v.x, v.y, z)),
          contents: NumberBox,
        },
      ],
    })
  },
  Euler: (model, editable) => {
    const value = model.resolve<Mutable<ThreeEuler>>("value")
    return createPropertyRowConfig(model, {
      type: "row",
      contents: [
        {
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(
            e => M.radToDeg(e.x),
            (e, x) => new ThreeEuler(M.degToRad(x), e.y, e.z),
          ),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(
            e => M.radToDeg(e.y),
            (e, y) => new ThreeEuler(e.x, M.degToRad(y), e.z),
          ),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: value.bimap(
            e => M.radToDeg(e.z),
            (e, z) => new ThreeEuler(e.x, e.y, M.degToRad(z)),
          ),
          contents: NumberBox,
          min: -180,
          max: 180,
          maxDecimals: 0,
        },
      ],
    })
  },
  Color: (model, editable) => {
    const value = model.resolve<Mutable<ThreeColor>>("value")
    return createPropertyRowConfig(model, {
      type: "colorText",
      constraints: {stretch: true},
      color: value.bimap(c => c.getHexString(), (c, s) => new ThreeColor("#" + s)),
      enabled: editable,
      contents: {
        type: "box",
        contents: {type: "label"},
        style: {halign: "left"},
      },
    })
  },
  select: (model, editable) => {
    const constraints = model.resolve<Value<SelectConstraints<any>>>("constraints")
    return createSelectPropertyConfig(model, editable, constraints)
  },
}

function createPropertyElementConfig (model :Model, editable :Value<boolean>) {
  const type = model.resolve<Value<string>>("type")
  const creator = propertyConfigCreators[type.current]
  if (creator) return creator(model, editable)
  const enumMeta = getEnumMeta(type.current)
  if (enumMeta) return createSelectPropertyConfig(
    model, editable, Value.constant({options: enumMeta.values}))
  return createPropertyRowConfig(model, {
    type: "label",
    constraints: {stretch: true},
    text: model.resolve<Value<any>>("value").map(toLimitedString),
  })
}

function createSelectPropertyConfig<K> (
  model :Model, editable :Value<boolean>, constraints :Value<SelectConstraints<K>>
) {
  const labeler = constraints.map(c => c.labeler ? c.labeler : (v :K) => String(v))
  const value = model.resolve<Mutable<any>>("value")
  const label = labeler.switchMap(fn => value.map(fn))
  return createPropertyRowConfig(model, {
    type: "dropdown",
    enabled: editable,
    contents: {
      type: "box",
      contents: {type: "label", text: label},
    },
    element: {
      type: "dropdownItem",
      contents: {
        type: "box",
        contents: {type: "label", text: "name"},
        style: {halign: "left"},
      },
      action: "action",
    },
    model: {
      keys: constraints.map(c => c.options),
      resolve: (key :K) => new Model({
        name: labeler.map(fn => fn(key)),
        action: () => value.update(key)
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
