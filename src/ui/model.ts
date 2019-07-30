import {Source} from "../core/react"

/** Model actions executed in response to user actions (like button clicks). */
export type Action = () => void

/** Defines the allowed values in a model. */
export type ModelValue = Source<unknown> | Action | ModelProvider

type ModelElem = ModelValue | ModelData

/** Defines a POJO that contains model values. */
export interface ModelData { [key :string] :ModelElem }

/** Defines a model component. It can either be an immediate value of the desired type or a path
  * into the model's data via which the value will be resolved. */
export type Spec<T> = string | T

/** Defines the reactive data model for a UI. This is a POJO with potentially nested objects whose
  * eventual leaf property values are reactive values which are displayed and/or updated by the UI
  * components and the game/application logic. */
export abstract class Model {

  /** Creates a model from the supplied POJO that contains model values. */
  static fromData (data :ModelData) :Model { return new DataModel(data) }

  /** Resolves the model component identified by `spec`. The may be an immediate value of the
    * desired type or be a path which will be resolved from this model's data. */
  abstract resolve <V extends ModelValue> (spec :Spec<V>) :V
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

class DataModel extends Model {

  constructor (readonly data :ModelData) { super() }

  resolve <V extends ModelValue> (spec :Spec<V>) :V {
    function find (data :ModelData, path :string[], pos :number) :V {
      const next = data[path[pos]]
      if (!next) throw new Error(`Missing model element at pos ${pos} in ${path}`)
      // TODO: would be nice if we could check the types here and freak out if we hit something
      // weird along the way
      else if (pos < path.length-1) return find(next as ModelData, path, pos+1)
      else return next as V
    }
    return (typeof spec !== "string") ? spec : find(this.data, spec.split("."), 0)
  }

}
