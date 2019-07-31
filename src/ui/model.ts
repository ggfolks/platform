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

function find<V extends ModelValue> (data :ModelData, path :string[], pos :number) :V {
  const next = data[path[pos]]
  if (!next) throw new Error(`Missing model element at pos ${pos} in ${path}`)
  // TODO: would be nice if we could check the types here and freak out if we hit something
  // weird along the way
  else if (pos < path.length-1) return find(next as ModelData, path, pos+1)
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
    * desired type or be a path which will be resolved from this model's data. */
  resolve <V extends ModelValue> (spec :Spec<V>) :V {
    return (typeof spec !== "string") ? spec : find(this.data, spec.split("."), 0)
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
  map :RMap<K,V>, maker :(v:Value<V>) => ModelData
) :ModelProvider {
  const models = new Map<ModelKey,Model>()
  return {
    resolve: (key) => {
      const model = models.get(key)
      if (model) return model
      const nmodel = new Model(maker(map.getValue(key as K) as Value<V>))
      models.set(key, nmodel)
      return nmodel
    }
  }
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
  const models = new Map<ModelKey,Model>()
  return {
    resolve: (key) => {
      const model = models.get(key)
      if (model) return model
      const nmodel = new Model(maker(map.getMutable(key as K) as Mutable<V>))
      models.set(key, nmodel)
      return nmodel
    }
  }
}
