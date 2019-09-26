import {Source, Value, Mutable} from "../core/react"
import {RMap, MutableMap} from "../core/rcollect"

/** Model actions executed in response to user actions (like button clicks). */
export type Action = () => void

/** An action that does nothing. */
export const NoopAction :Action = () => {}

/** Defines the allowed values in a model. */
export type ModelValue = Source<unknown> | Action | ModelProvider

type ModelElem = ModelValue | ModelData

/** Defines a POJO that contains model values. */
export interface ModelData { [key :string] :ModelElem }

export class MissingModelElem extends Error {
  constructor (readonly path :string[], readonly pos :number) { super() }
  get message () { return `Missing model element '${this.path[this.pos]}'` }
}

function find<V extends ModelValue> (
  data :ModelData,
  path :string[],
  pos :number,
  defaultValue? :V,
) :V {
  const value = findOpt(data, path, pos)
  if (!value) {
    if (defaultValue) return defaultValue
    else throw new MissingModelElem(path, pos)
  }
  else return value as V
}

function findOpt<V extends ModelValue> (data :ModelData, path :string[], pos :number) :V|undefined {
  const next = data[path[pos]]
  if (!next) return
  // TODO: would be nice if we could check the types here and freak out if we hit something
  // weird along the way
  else if (pos < path.length-1) return findOpt(next as ModelData, path, pos+1)
  else return next as V
}

/** Defines a model component. It can either be an immediate value of the desired type or a path
  * into the model's data via which the value will be resolved. */
export type Spec<T> = string | T

/** Defines the reactive data model for a UI. This is a POJO with potentially nested objects whose
  * eventual leaf property values are reactive values which are displayed and/or updated by the UI
  * components and the game/application logic. */
export class Model {

  constructor (readonly data :ModelData) {}

  /** Resolves the model component identified by `spec`. The may be an immediate value of the
    * desired type or be a path which will be resolved from this model's data.
    * @throws Will throw an error if model elements are missing and no default value is given. */
  resolve <V extends ModelValue> (spec :Spec<V>|undefined, defaultValue? :V) :V {
    if (!spec && defaultValue) return defaultValue
    return (typeof spec !== "string")
      ? spec as V
      : find(this.data, spec.split("."), 0, defaultValue)
  }

  /** Resolves the model component identified by `spec`. The may be an immediate value of the
    * desired type or be a path which will be resolved from this model's data. Returns undefined
    * if 'spec' is undefined or any of its path's model elements are missing. */
  resolveOpt <V extends ModelValue> (spec :Spec<V>|undefined) :V|undefined {
    return (typeof spec !== "string") ? spec : findOpt(this.data, spec.split("."), 0)
  }
}

/** The allowed key types for models obtained via a [[ModelProvider]]. */
export type ModelKey = number|string

/** Provides sub-models based on a key. Used for dynamic interface elements (like `List`) which
  * create sub-elements on the fly. The dynamic element's data model will contain a model provider
  * along with a normal reactive model element that contains the keys to be resolved to create that
  * element's children. */
export interface ModelProvider {

  /** Resolves the model for `key`. */
  resolve (key :ModelKey) :Model

  // TODO: should model providers provide a way to remove no longer used models?
}

/** Creates a model provider that computes the model via a `fn` of its `key`. */
export function makeProvider<K extends ModelKey> (fn :(key :K) => ModelData) :ModelProvider {
  const models = new Map<ModelKey, Model>()
  return {
    resolve: (key :K) => {
      let model = models.get(key)
      if (!model) models.set(key, model = new Model(fn(key)))
      return model
    }
  }
}

/** Provides models from model data. */
export function dataProvider (data :ModelData) :ModelProvider {
  return makeProvider(key => data[key] as ModelData)
}

/** Creates a model provider from the supplied `map` and model data `maker` function. The `maker`
  * function should project the needed values from the map value using `Value.map`. For example:
  *
  * ```ts
  * const map :RMap<string, {name :string, age :number}> = ...
  * const provider = mapProvider(map, v => ({name: v.map(r => r.name), age: v.map(r => r.age)}))
  * ```
  *
  * Note: the maker function is passed a value that assumes the correct mapping always exists.
  * This is necessary to avoid a lot of painful checking for undefined values. But if you build a
  * component where the list of keys is not in sync with its associated map, things will blow up.
  * Be careful. */
export function mapProvider<K extends ModelKey, V> (
  map :RMap<K,V>, maker :(v :Value<V>, k :K) => ModelData
) :ModelProvider {
  return makeProvider(key => maker(map.getValue(key as K) as Value<V>, key as K))
}

/** Creates a model provider from the supplied `map` and model data `maker` function. The `maker`
  * function should project the needed values from the map value using `Value.map` and needed
  * mutable values using `Mutable.bimap`. For example:
  *
  * ```ts
  * const map :MutableMap<string, {name :string, age :number}> = ...
  * const provider = mapProvider(map, m => ({
  *   name: m.bimap(r => r.name, (r, name) => ({...r, name})), // editable
  *   age: m.map(r => r.age) // not editable
  * }))
  * ```
  *
  * Note: the maker function is passed a value that assumes the correct mapping always exists.
  * This is necessary to avoid a lot of painful checking for undefined values. But if you build a
  * component where the list of keys is not in sync with its associated map, things will blow up.
  * Be careful. */
export function mutableMapProvider<K extends ModelKey, V> (
  map :MutableMap<K,V>, maker :(m:Mutable<V>) => ModelData
) :ModelProvider {
  return makeProvider(key => maker(map.getMutable(key as K) as Mutable<V>))
}
