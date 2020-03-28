import {Noop} from "../core/util"
import {Source, Value, Mutable} from "../core/react"
import {RMap, MutableMap} from "../core/rcollect"

/** Implemented by things that can be resolved from models. */
export interface ModelValue {}

/** Model actions executed in response to user actions (like button clicks). */
export type Action = (...args :any) => void

/** An action that carries its enabled state with it. */
export class Command implements ModelValue {
  static Noop = new Command(Noop, Value.true)
  constructor (readonly action :Action, readonly enabled :Value<boolean> = Value.true) {}
}

/** An action that does nothing. */
export const NoopAction :Action = () => Noop

/** Defines the allowed values in a model. */
export type Resolvable = Source<unknown> | Action | ModelValue

type ModelElem = Resolvable | ModelData

/** Defines a POJO that contains model values. */
export interface ModelData { [key :string] :ModelElem }

export class MissingModelElem extends Error {
  constructor (readonly path :string[], readonly pos :number) {
    super(`Missing model element '${path[pos]}'`)
  }
}

export class MissingConfig extends Error {
  constructor (name :string) { super(`Missing config '${name}'`) }
}

function find<V extends Resolvable> (data :ModelData, path :string[], pos :number, defval? :V) :V {
  const value = findOpt(data, path, pos)
  if (!value) {
    if (defval) return defval
    console.log(`Missing model elem '${path}' @ ${pos}`)
    throw new MissingModelElem(path, pos)
  }
  else return value as V
}

function findOpt<V extends Resolvable> (data :ModelData, path :string[], pos :number) :V|undefined {
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

  /** Creates an elements model that computes each element model via a `fn` of its `key`. */
  static make<K extends ModelKey> (
    keys :Source<Iterable<K>>, fn :(key :K) => ModelData
  ) :ElementsModel<K> {
    return {keys, resolve: resolver(fn)}
  }

  /** Provides element models from a model data object. The keys default to the keys of the data
    * object in iteration order, but a custom keys value can be provided. */
  static fromData (
    data :ModelData,
    keys :Value<string[]> = Value.constant(Object.keys(data))
  ) :ReadableElementsModel<string> {
    return {
      keys: keys as any as Value<Iterable<string>>,
      resolve: resolver(key => data[key] as ModelData)
    }
  }

  /** Creates an elements model from the supplied `map` and model data `maker` function. The `maker`
    * function should project the needed values from the map value using `Value.map`. For example:
    *
    * ```ts
    * const map :RMap<string, {name :string, age :number}> = ...
    * const keys = map.keysValue // could opt to sort or filter or whatnot
    * const model = Model.fromMap(keys, map, v => ({
    *   name: v.map(r => r.name), age: v.map(r => r.age)
    * }))
    * ```
    *
    * Note: the maker function is passed a value that assumes the correct mapping always exists.
    * This is necessary to avoid a lot of painful checking for undefined values. But if you build a
    * component where the list of keys is not in sync with its associated map, things will blow up.
    * Be careful. */
  static fromMap<K extends ModelKey, V> (
    keys :Source<Iterable<K>>, map :RMap<K,V>, maker :(v :Value<V>, k :K) => ModelData
  ) :ElementsModel<K> {
    return {keys, resolve: resolver(key => maker(map.getValue(key as K) as Value<V>, key as K))}
  }

  /** Creates an elements model from the supplied `map` and model data `maker` function. The `maker`
    * function should project the needed values from the map value using `Value.map` and needed
    * mutable values using `Mutable.bimap`. For example:
    *
    * ```ts
    * const map :MutableMap<string, {name :string, age :number}> = ...
    * const keys = map.keysValue // could opt to sort or filter or whatnot
    * const model = Model.fromMap(keys, map, m => ({
    *   name: m.bimap(r => r.name, (r, name) => ({...r, name})), // editable
    *   age: m.map(r => r.age) // not editable
    * }))
    * ```
    *
    * Note: the maker function is passed a value that assumes the correct mapping always exists.
    * This is necessary to avoid a lot of painful checking for undefined values. But if you build a
    * component where the list of keys is not in sync with its associated map, things will blow up.
    * Be careful. */
  static fromMutableMap<K extends ModelKey, V> (
    keys :Source<Iterable<K>>, map :MutableMap<K,V>, maker :(m:Mutable<V>) => ModelData
  ) :ElementsModel<K> {
    return {keys, resolve: resolver(key => maker(map.getMutable(key as K) as Mutable<V>))}
  }

  /** Creates an elements model from the supplied `source` array and model data `maker` function.
    * The keys default to the indices of the array in their natural order, but can be customized if
    * desired. */
  static fromArray<A> (
    source :Value<A[]>, maker :(v :Value<A>, idx :number) => ModelData,
    keys = source.map(a => a.map((_, ii) => ii))
  ) :ElementsModel<number>{
    return {keys, resolve: resolver(idx => maker(source.map(a => a[idx]), idx))}
  }

  constructor (readonly data :ModelData) {}

  /** Resolves the model component at `path`.
    * @throws `Error` if no component exists at that path. */
  resolve<V extends Resolvable> (path :string) :V {
    return find(this.data, path.split("."), 0)
  }

  /** Resolves the model component identified by `spec`. This may be an immediate value of the
    * desired type or be a path which will be resolved from this model's data.
    * @throws `Error` if `spec` is a model component path and no component exists at that path. */
  resolveAs<V extends Resolvable> (spec :Spec<V>, name :string) :V {
    if (spec === undefined) throw new MissingConfig(name)
    return (typeof spec !== "string") ? spec : find(this.data, spec.split("."), 0)
  }

  /** Resolves the model component identified by `spec`. This may be an immediate value of the
    * desired type or be a path which will be resolved from this model's data. If `spec` is
    * undefined or references a missing model element, `defval` will be returned. */
  resolveOr<V extends Resolvable> (spec :Spec<V>|undefined, defval :V) :V {
    if (spec === undefined) return defval
    return (typeof spec !== "string") ? spec : find(this.data, spec.split("."), 0, defval)
  }

  /** Resolves the model component identified by `spec`. The may be an immediate value of the
    * desired type or be a path which will be resolved from this model's data. Returns `undefined`
    * if 'spec' is undefined or any of its path's model elements are missing. */
  resolveOpt<V extends Resolvable> (spec :Spec<V>|undefined) :V|undefined {
    return (typeof spec !== "string") ? spec : findOpt(this.data, spec.split("."), 0)
  }

  /** Resolves the model action at `path`.
    * @throws `Error` if no action exists at that path. */
  resolveAction<F extends Action> (path :string) :F {
    const value = this.resolve<F>(path)
    return (value instanceof Command) ? value.action as F : value
  }

  /** Resolves the action identified by `spec`. This follows the normal resolution process and
    * additionally handles actions that are bound to commands (combinations of action function and
    * enabled value). If `spec` resolves to a command, the action function is extracted and
    * returned.
    *
    * Note: if the caller supports being bound to a command, it is responsible for checking whether
    * the command is enabled before invoking it. The main UI framework takes care of this for
    * elements that trigger actions by binding the enabled state of the element to the enabled state
    * of the command. */
  resolveActionOr<F extends Action> (spec :Spec<F>|undefined, defaultAction :F) :F {
    const value = this.resolveOr(spec, defaultAction)
    return (value instanceof Command) ? value.action as F : value
  }

  /** Resolves the action identified by `spec`, returning `undefined` if spec is undefined or if it
    * is not bound to any model value. This does the same unwrapping that [[resolveAction]] does and
    * comes with the same caveats re: enabledness. */
  resolveActionOpt<F extends Action> (spec :Spec<F>|undefined) :F|undefined {
    const value = this.resolveOpt(spec)
    return (value instanceof Command) ? value.action as F : value
  }
}

/** The allowed key types for models obtained via an [[ElementsModel]]. */
export type ModelKey = number|string

/** Defines the model for a dynamic UI component (like `List`). The component will display some
  * dynamic list of elements which are identified by the `keys` array, and the data models for each
  * individual element are fetched via `resolve`. */
export interface ElementsModel<K> extends ModelValue {

  /** The keys identifying the elements in this model. */
  keys :Source<Iterable<K>>

  /** Resolves the model for `key`. */
  resolve (key :K) :Model

  // TODO: do we want a way to tell the model that an element model is no longer in use?
  // in theory it knows this because the key was removed from the keys array so maybe not...
}

/** A refinment of `ElementsModel` that allows the current value of the keys to be read. */
export interface ReadableElementsModel<K extends ModelKey> extends ElementsModel<K> {
  keys :Value<Iterable<K>>
}

function resolver<K extends ModelKey> (fn :(key :K) => ModelData) {
  const models = new Map<K, Model>()
  return (key :K) => {
    let model = models.get(key)
    if (!model) models.set(key, model = new Model(fn(key)))
    return model
  }
}

/** Creates an elements model that computes each element model via a `fn` of its `key`. */
export function makeModel<K extends ModelKey> (
  keys :Source<Iterable<K>>, fn :(key :K) => ModelData
) :ElementsModel<K> {
  return {keys, resolve: resolver(fn)}
}

/** Provides element models from a model data object. The keys default to the keys of the data
  * object in iteration order, but a custom keys value can be provided. */
export function dataModel (
  data :ModelData,
  keys :Value<string[]> = Value.constant(Object.keys(data))
) :ReadableElementsModel<string> {
  return {
    keys: keys as any as Value<Iterable<string>>,
    resolve: resolver(key => data[key] as ModelData)
  }
}

/** Creates an elements model from the supplied `map` and model data `maker` function. The `maker`
  * function should project the needed values from the map value using `Value.map`. For example:
  *
  * ```ts
  * const map :RMap<string, {name :string, age :number}> = ...
  * const keys = map.keysValue // could opt to sort or filter or whatnot
  * const model = mapModel(keys, map, v => ({name: v.map(r => r.name), age: v.map(r => r.age)}))
  * ```
  *
  * Note: the maker function is passed a value that assumes the correct mapping always exists.
  * This is necessary to avoid a lot of painful checking for undefined values. But if you build a
  * component where the list of keys is not in sync with its associated map, things will blow up.
  * Be careful. */
export function mapModel<K extends ModelKey, V> (
  keys :Source<Iterable<K>>, map :RMap<K,V>, maker :(v :Value<V>, k :K) => ModelData
) :ElementsModel<K> {
  return {keys, resolve: resolver(key => maker(map.getValue(key as K) as Value<V>, key as K))}
}

/** Creates an elements model from the supplied `map` and model data `maker` function. The `maker`
  * function should project the needed values from the map value using `Value.map` and needed
  * mutable values using `Mutable.bimap`. For example:
  *
  * ```ts
  * const map :MutableMap<string, {name :string, age :number}> = ...
  * const keys = map.keysValue // could opt to sort or filter or whatnot
  * const model = mapModel(keys, map, m => ({
  *   name: m.bimap(r => r.name, (r, name) => ({...r, name})), // editable
  *   age: m.map(r => r.age) // not editable
  * }))
  * ```
  *
  * Note: the maker function is passed a value that assumes the correct mapping always exists.
  * This is necessary to avoid a lot of painful checking for undefined values. But if you build a
  * component where the list of keys is not in sync with its associated map, things will blow up.
  * Be careful. */
export function mutableMapModel<K extends ModelKey, V> (
  keys :Source<Iterable<K>>, map :MutableMap<K,V>, maker :(m:Mutable<V>) => ModelData
) :ElementsModel<K> {
  return {keys, resolve: resolver(key => maker(map.getMutable(key as K) as Mutable<V>))}
}

/** Creates an elements model from the supplied `source` array and model data `maker` function. The
  * keys default to the indices of the array in their natural order, but can be customized if
  * desired. */
export function arrayModel<A> (
  source :Value<A[]>, maker :(v :Value<A>, idx :number) => ModelData,
  keys = source.map(a => a.map((_, ii) => ii))
) :ElementsModel<number>{
  return {keys, resolve: resolver(idx => maker(source.map(a => a[idx]), idx))}
}
