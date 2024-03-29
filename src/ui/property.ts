import {Color as ThreeColor, Euler as ThreeEuler, MathUtils as M, Vector3} from "three"

import {Color} from "../core/color"
import {refEquals} from "../core/data"
import {Euler, quat, vec2, vec3} from "../core/math"
import {ChangeFn, Mutable, Value} from "../core/react"
import {RMap} from "../core/rcollect"
import {Noop, PMap, filteredIterable, toLimitedString} from "../core/util"
import {NumberConstraints, PropertyMeta, SelectConstraints, getEnumMeta} from "../graph/meta"
import {Element} from "./element"
import {AxisConfig, VGroup} from "./group"
import {Action, Model, ElementsModel, Spec, mapModel} from "./model"

/** Depicts a node's editable/viewable properties. */
export class PropertyView extends VGroup {
  readonly elements = new Map<string, Element>()
  readonly contents :Element[] = []

  constructor (ctx :Element.Context, parent :Element, readonly config :Property.ViewConfig) {
    super(ctx, parent, config)
    const editable = ctx.model.resolveAs(config.editable, "editable")
    const model = ctx.model.resolveAs(config.model, "model")
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
            Property.createElementConfig(elemModel, editable),
          )
          this.elements.set(key, elem)
        }
        contents.push(elem)
      }
      this.invalidate()
    }))
  }
}

export namespace Property {

  /** Configuration for [[PropertyView]]. */
  export interface ViewConfig extends AxisConfig {
    type :"propertyView"
    editable :Spec<Value<boolean>>
    model :Spec<ElementsModel<string>>
  }

  export type ConfigCreator = (model :Model, editable :Value<boolean>) => Element.Config

  const NumberBox = {type: "box", contents: {type: "label"}, style: {halign: "right"}}

  const configCreators :PMap<ConfigCreator> = {
    string: (model, editable) => createRowConfig(model, {
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
      return createRowConfig(model, {
        type: "numberText",
        constraints: {stretch: true},
        number: "value",
        enabled: editable,
        contents: NumberBox,
        inputMode: "numeric",
        ...constraints,
      })
    },
    boolean: (model, editable) => {
      const value = model.resolve<Mutable<boolean>>("value")
      return createRowConfig(model, {
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
    vec2: createVecConfigCreator(vec2, 2),
    vec3: createVecConfigCreator(vec3, 3),
    quat: (model, editable) => {
      const rawValue = model.resolve<Mutable<quat>>("value")
      let quatValue = quat.clone(rawValue.current)
      let currentValue = truncateEuler(rawValue.current)
      let changeFn :ChangeFn<Euler> = Noop
      const truncatedValue = Mutable.deriveMutable(
        dispatch => {
          changeFn = dispatch
          const rawValueRemover = rawValue.onChange((value :quat, oldValue :quat) => {
            if (!quat.equals(value, quatValue)) {
              const oldValue = currentValue
              quat.copy(quatValue, value)
              changeFn(currentValue = truncateEuler(value), oldValue)
            }
          })
          return () => {
            rawValueRemover()
            changeFn = Noop
          }
        },
        () => currentValue,
        (newValue :Euler) => {
          const oldValue = currentValue
          changeFn(currentValue = newValue, oldValue)
          const newQuatValue = quat.fromEuler(quat.create(), newValue[0], newValue[1], newValue[2])
          if (!quat.equals(quatValue, newQuatValue)) rawValue.update(quatValue = newQuatValue)
        },
        refEquals,
      )
      const createElementConfig = (index :number) => ({
        type: "numberText",
        constraints: {stretch: true},
        number: truncatedValue.bimap(e => e[index], (e, value) => {
          const newEuler = Euler.clone(e)
          newEuler[index] = value
          return newEuler
        }),
        contents: NumberBox,
        min: -180,
        max: 180,
        wrap: true,
        maxDecimals: 0,
        wheelStep: 10,
      })
      return createRowConfig(model, {
        type: "row",
        constraints: {stretch: true},
        contents: [
          createElementConfig(0),
          createElementConfig(1),
          createElementConfig(2),
        ],
      })
    },
    Color: (model, editable) => {
      const value = model.resolve<Mutable<Color>>("value")
      const hexValue = value.bimap(c => Color.toHex(c), (c, s) => Color.fromHex(s))
      return createRowConfig(model, {
        type: "row",
        constraints: {stretch: true},
        offPolicy: "stretch",
        contents: [
          {
            type: "colorText",
            constraints: {stretch: true},
            color: hexValue,
            enabled: editable,
            contents: {
              type: "box",
              contents: {type: "label"},
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
              const listener = (input :HTMLInputElement) => hexValue.update(input.value.substring(1))
              clickTempInput("color", listener, "#" + hexValue.current, listener)
            },
          },
        ],
      })
    },
    Vector3: (model, editable) => {
      const value = model.resolve<Mutable<Vector3>>("value")
      return createRowConfig(model, {
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
      return createRowConfig(model, {
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
      return createRowConfig(model, {
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
      return createSelectConfig(model, editable, constraints)
    },
  }

  interface vec<T> {
    create () :T
    scale (out :T, a :T, b :number) :T
    round (out :T, a :T) :T
    clone (a :T) :T
    equals (a :T, b :T) :boolean
  }

  function createVecConfigCreator<T> (type :vec<T>, length :number) :ConfigCreator {
    const maxDecimals = 2
    const truncateVec = (vector :T) => {
      const result = type.create()
      const scale = 10 ** maxDecimals
      return type.scale(result, type.round(result, type.scale(result, vector, scale)), 1.0 / scale)
    }
    return (model, editable) => {
      const rawValue = model.resolve<Mutable<T>>("value")
      let currentValue = truncateVec(rawValue.current)
      const truncatedValue = Mutable.deriveMutable(
        dispatch => rawValue.onChange((value :T, oldValue :T) => {
          const truncated = truncateVec(value)
          if (!type.equals(currentValue, truncated)) {
            const oldValue = currentValue
            dispatch(currentValue = truncated, oldValue)
          }
        }),
        () => currentValue,
        (newValue :T) => {
          if (!type.equals(currentValue, newValue)) rawValue.update(newValue)
        },
        refEquals,
      )
      const contents :Element.Config[] = []
      for (let ii = 0; ii < length; ii++) {
        contents.push({
          type: "numberText",
          constraints: {stretch: true},
          maxDecimals,
          wheelStep: 0.1,
          number: truncatedValue.bimap(v => v[ii], (v, value) => {
            const newVector = type.clone(v)
            newVector[ii] = value
            return newVector
          }),
          contents: NumberBox,
        })
      }
      return createRowConfig(model, {
        type: "row",
        constraints: {stretch: true},
        contents,
      })
    }
  }

  /** Sets the element config creator to use for editing properties of the specified type. */
  export function setConfigCreator (type :string, creator :ConfigCreator) {
    configCreators[type] = creator
  }

  type UrlSelector = (value :Mutable<string>) => void
  const defaultUrlSelector :UrlSelector = value => {
    clickTempInput("file", input => {
      if (!input.files || input.files.length === 0) return
      const url = URL.createObjectURL(input.files[0])
      value.update(url.toString())
      // TODO: call revokeObjectURL when finished
    })
  }
  let urlSelector = defaultUrlSelector

  /** Sets the function to invoke when we want to select an URL.
    * @param selector the custom URL selector, or undefined to use the default. */
  export function setCustomUrlSelector (selector :UrlSelector|undefined) {
    urlSelector = selector || defaultUrlSelector
  }

  function clickTempInput (
    type :string,
    changeListener :(input :HTMLInputElement) => void,
    value? :string,
    inputListener? :(input :HTMLInputElement) => void,
  ) {
    const input = document.createElement("input")
    input.setAttribute("type", type)
    if (value) input.setAttribute("value", value)
    // We need to keep a reference to the input or everything might GC and we'll never get the
    // change event. Holding onto it for 30s is hacky but should be enough for a user to select
    // a file, and it seems to (in my browser) greatly increase the chances of success even
    // over 30s.
    const timeoutHandle = setTimeout(() => {
      input.setAttribute("bogus", "bogus") // reference the input element
    }, 30 * 1000)
    input.addEventListener("change", () => {
      clearTimeout(timeoutHandle)
      changeListener(input)
    })
    if (inputListener) input.addEventListener("input", () => inputListener(input))
    input.click()
  }

  function truncateEuler (rotation :quat) :Euler {
    const euler = Euler.fromQuat(Euler.create(), rotation)
    return Euler.round(euler, euler)
  }

  export function createElementConfig (model :Model, editable :Value<boolean>) {
    const type = model.resolve<Value<string>>("type")
    const creator = configCreators[type.current]
    if (creator) return creator(model, editable)
    const enumMeta = getEnumMeta(type.current)
    if (enumMeta) return createSelectConfig(
      model, editable, Value.constant({options: enumMeta.values}))
    return createRowConfig(model, {
      type: "label",
      constraints: {stretch: true},
      text: model.resolve<Value<any>>("value").map(toLimitedString),
    })
  }

  function createSelectConfig<K> (
    model :Model, editable :Value<boolean>, constraints :Value<SelectConstraints<K>>
  ) {
    const labeler = constraints.map(c => c.labeler ? c.labeler : (v :K) => String(v))
    const value = model.resolve<Mutable<any>>("value")
    const label = labeler.switchMap(fn => value.map(fn))
    return createRowConfig(model, {
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
    return createRowConfig(model, {
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

  /** Creates the element configuration for a property row with the supplied value editor. This is
    * broken out into a separate function because some property editors will want to use a different
    * (wider) layout. */
  export function createRowConfig (model :Model, valueConfig :Element.Config) {
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
  export function makeModel (
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

  export const Catalog :Element.Catalog = {
    "propertyView": (ctx, parent, cfg) => new PropertyView(ctx, parent, cfg as ViewConfig),
  }
}
