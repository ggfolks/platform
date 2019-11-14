import {Color as ThreeColor, Euler as ThreeEuler, Math as M, Vector3} from "three"

import {Color} from "../core/color"
import {refEquals} from "../core/data"
import {Euler, quat, vec3} from "../core/math"
import {Mutable, Value} from "../core/react"
import {RMap} from "../core/rcollect"
import {PMap, filteredIterable, toLimitedString} from "../core/util"
import {NumberConstraints, PropertyMeta, SelectConstraints, getEnumMeta} from "../graph/meta"
import {Element} from "./element"
import {AxisConfig, VGroup} from "./group"
import {Action, Model, ElementsModel, Spec, mapModel} from "./model"

/** Depicts a node's editable/viewable properties. */
export class PropertyView extends VGroup {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :Element.Context, parent :Element, readonly config :PropertyView.Config) {
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

export namespace PropertyView {

  /** Configuration for [[PropertyView]]. */
  export interface Config extends AxisConfig {
    type :"propertyView"
    editable :Spec<Value<boolean>>
    model :Spec<ElementsModel<string>>
  }
}

type PropertyConfigCreator = (model :Model, editable :Value<boolean>) => Element.Config

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
    return createEllipsisConfig(model, editable, () => urlSelector(value))
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
    const rawValue = model.resolve<Mutable<vec3>>("value")
    const maxDecimals = 3
    let currentValue = truncateVec3(rawValue.current, maxDecimals)
    const truncatedValue = Mutable.deriveMutable(
      dispatch => rawValue.onChange((value :vec3, oldValue :vec3) => {
        const truncated = truncateVec3(value, maxDecimals)
        if (!vec3.equals(currentValue, truncated)) {
          const oldValue = currentValue
          dispatch(currentValue = truncated, oldValue)
        }
      }),
      () => currentValue,
      (newValue :vec3) => {
        if (!vec3.equals(currentValue, newValue)) {
          rawValue.update(newValue)
        }
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
          maxDecimals,
          wheelStep: 0.1,
          number: truncatedValue.bimap(v => v[0], (v, x) => vec3.fromValues(x, v[1], v[2])),
          contents: NumberBox,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          maxDecimals,
          wheelStep: 0.1,
          number: truncatedValue.bimap(v => v[1], (v, y) => vec3.fromValues(v[0], y, v[2])),
          contents: NumberBox,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          maxDecimals,
          wheelStep: 0.1,
          number: truncatedValue.bimap(v => v[2], (v, z) => vec3.fromValues(v[0], v[1], z)),
          contents: NumberBox,
        },
      ],
    })
  },
  quat: (model, editable) => {
    const rawValue = model.resolve<Mutable<quat>>("value")
    let currentValue = truncateEuler(rawValue.current)
    const truncatedValue = Mutable.deriveMutable(
      dispatch => rawValue.onChange((value :quat, oldValue :quat) => {
        const truncated = truncateEuler(value)
        if (!Euler.equals(currentValue, truncated)) {
          const oldValue = currentValue
          dispatch(currentValue = truncated, oldValue)
        }
      }),
      () => currentValue,
      (newValue :Euler) => {
        if (!Euler.equals(currentValue, newValue)) {
          rawValue.update(quat.fromEuler(quat.create(), newValue[0], newValue[1], newValue[2]))
        }
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
          number: truncatedValue.bimap(e => e[0], (e, x) => Euler.fromValues(x, e[1], e[2])),
          contents: NumberBox,
          maxDecimals: 0,
          wheelStep: 10,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: truncatedValue.bimap(e => e[1], (e, y) => Euler.fromValues(e[0], y, e[2])),
          contents: NumberBox,
          maxDecimals: 0,
          wheelStep: 10,
        },
        {
          type: "numberText",
          constraints: {stretch: true},
          number: truncatedValue.bimap(e => e[2], (e, z) => Euler.fromValues(e[0], e[1], z)),
          contents: NumberBox,
          maxDecimals: 0,
          wheelStep: 10,
        },
      ],
    })
  },
  Color: (model, editable) => {
    const value = model.resolve<Mutable<Color>>("value")
    return createPropertyRowConfig(model, {
      type: "colorText",
      constraints: {stretch: true},
      color: value.bimap(c => Color.toHex(c), (c, s) => Color.fromHex(s)),
      enabled: editable,
      contents: {
        type: "box",
        contents: {type: "label"},
        style: {halign: "left"},
      },
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
  ThreeColor: (model, editable) => {
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

/** Sets the element config creator to use for editing properties of the specified type. */
export function setPropertyConfigCreator (type :string, creator :PropertyConfigCreator) {
  propertyConfigCreators[type] = creator
}

type UrlSelector = (value :Mutable<string>) => void
const defaultUrlSelector :UrlSelector = value => {
  const input = document.createElement("input")
  input.setAttribute("type", "file")
  // We need to keep a reference to the input or everything might GC and we'll never get the
  // change event. Holding onto it for 30s is hacky but should be enough for a user to select
  // a file, and it seems to (in my browser) greatly increase the chances of success even
  // over 30s.
  const timeoutHandle = setTimeout(() => {
    input.setAttribute("bogus", "bogus") // reference the input element
  }, 30 * 1000)
  input.addEventListener("change", event => {
    clearTimeout(timeoutHandle)
    if (!input.files || input.files.length === 0) return
    const url = URL.createObjectURL(input.files[0])
    value.update(url.toString())
    // TODO: call revokeObjectURL when finished
  })
  input.click()
}
let urlSelector = defaultUrlSelector

/** Sets the function to invoke when we want to select an URL.
  * @param selector the custom URL selector, or undefined to use the default. */
export function setCustomUrlSelector (selector :UrlSelector|undefined) {
  urlSelector = selector || defaultUrlSelector
}

function truncateVec3 (vector :vec3, maxDecimals :number) :vec3 {
  const result = vec3.create()
  const scale = 10 ** maxDecimals
  return vec3.scale(result, vec3.round(result, vec3.scale(result, vector, scale)), 1.0 / scale)
}

function truncateEuler (rotation :quat) :Euler {
  const euler = Euler.fromQuat(Euler.create(), rotation)
  return Euler.round(euler, euler)
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
    constraints: {stretch: true},
    enabled: editable,
    contents: {
      type: "box",
      contents: {type: "label", text: label},
      style: {halign: "left"},
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

/** Creates a property edit config consisting of a string value field and an ellipsis button that
  * brings up a dialog. */
export function createEllipsisConfig (model :Model, editable :Value<boolean>, ellipsis :Action) {
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
        onClick: ellipsis,
      },
    ],
  })
}

/** Creates the element configuration for a property row with the supplied value editor.  This is
  * broken out into a separate function because some property editors will want to use a different
  * (wider) layout. */
export function createPropertyRowConfig (model :Model, valueConfig :Element.Config) {
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

/** Creates a model for the supplied properties.
  * @param propertiesMeta the property metadata map.
  * @param getProperty the function to use to get the property values.
  * @return the model instance. */
export function makePropertiesModel (
  propertiesMeta :RMap<string, PropertyMeta>,
  getProperty :(name :string, meta :Value<PropertyMeta>) => Value<any>,
) {
  return mapModel(
    propertiesMeta.keysValue.map(keys => filteredIterable(
      keys,
      key => propertiesMeta.require(key).constraints.editable !== false,
    )),
    propertiesMeta,
    (value, key) => {
      const propertyName = key as string
      return {
        name: Value.constant(propertyName),
        type: value.map(value => value.type),
        constraints: value.map(value => value.constraints),
        value: getProperty(propertyName, value),
      }
    },
  )
}

export const PropertyCatalog :Element.Catalog = {
  "propertyView": (ctx, parent, cfg) => new PropertyView(ctx, parent, cfg as PropertyView.Config),
}
