import {log} from "../core/util"
import {Clock} from "../core/clock"
import {refEquals} from "../core/data"
import {BitSet, Disposable, PMap, Remover} from "../core/util"
import {vec2} from "../core/math"
import {ChangeFn, Eq, Subject, Stream, Emitter, Value} from "../core/react"
import {Graph} from "../graph/graph"
import {NodeContext} from "../graph/node"
import {EntityNodeContext} from "./node"

export type ID = number

export type LifecycleType = "added" | "enabled" | "disabled" | "deleted"
export type LifecycleEvent = {type :LifecycleType, id :ID}

export type DomainConfig = {
  // TODO
}

export type EntityConfig = {
  /** The components used by this entity, mapped to config for each component. */
  components :Object
  /** Tags assigned to this entity. */
  tags? :Set<string>
}

/** A handle on an entity that allows the caller to check whether it has become invalid. */
export interface Ref extends Disposable {
  /** The id of the entity being referenced. */
  id :ID
  /** Whether or not the entity still exists. */
  exists :boolean
}

/** A collection of entities and their configuration records. Entity ids are only unique within a
  * single domain, and systems operate in a single domain. A game can safely use a single domain for
  * all of its entities, at the cost of some memory and/or performance overhead. If a game contains
  * multiple separate entity domains, it can opt to use separate `Domain` instances for those
  * domains to achieve better memory locality and more compact component data arrays within each
  * domain, but must simply be careful never to mix entity ids from separate domains. */
export class Domain {
  private _enabled = new BitSet()
  private _configs :EntityConfig[] = []
  private _nextID = 0
  private _endID = 0

  /** Emits events when entities are added, enabled, disabled or deleted. */
  readonly events :Stream<LifecycleEvent> = new Emitter<LifecycleEvent>()

  constructor (readonly config :DomainConfig,
               readonly components :PMap<Component<any>>) {}

  /** Checks whether entity `id` exists in the domain. */
  entityExists (id :ID) {
    return Boolean(this._configs[id])
  }

  /** Returns the configuration for entity `id`.
    * @throws Error if no entity exists with `id`. */
  entityConfig (id :ID) :EntityConfig {
    const config = this._configs[id]
    if (!config) throw new Error(`Requested config for missing entity ${id}`)
    return config
  }

  /** Returns the component with the specified `id`.
    * @throw Error if this domain contains no component with `id`. */
  component<T> (id :string) :Component<T> {
    const comp = this.components[id]
    if (comp) return comp
    throw new Error(`No component with id '${id}'`)
  }

  /** Adds an entity with the specified `config`.
    * @param enabled if true, the entity will be enabled immediately after adding. */
  add (config :EntityConfig, enabled = true) :ID {
    const id = this.nextID()
    this._configs[id] = config
    // initialize components for this entity based on its config
    for (let cid in config.components) {
      const ccfg = config.components[cid]
      const comp = this.components[cid]
      if (comp) comp.added(id, ccfg)
      else throw new Error(`Unknown component for entity '${cid}' ` +
                           `(have: ${Object.keys(this.components)})`)
    }
    this.emit("added", id)
    // TODO: it's possible that an `added` signal listener will manipulate this entity's enabled
    // state, in which case we'll override that change on the next line... maybe that's OK?
    if (enabled) this.enable(id)
    return id
  }

  /** Returns `true` if entity `id` is enabled, false otherwise. */
  enabled (id :ID) :boolean {
    return this._enabled.has(id)
  }

  /** Enables entity `id`. Does nothing if entity is already enabled. */
  enable (id :ID) {
    if (this._enabled.add(id)) this.emit("enabled", id)
  }

  /** Disables entity `id`. Does nothing if entity is already disabled. */
  disable (id :ID) {
    if (this._enabled.delete(id)) this.emit("disabled", id)
  }

  /** Deletes entity `id`.
    * @throws Error if no entity exists with `id`. */
  delete (id :ID) {
    if (this._configs[id] === undefined) throw new Error(`Deleted non-existent entity ${id}`)
    this.disable(id)
    this.emit("deleted", id)
    delete this._configs[id]
    if (id < this._nextID) this._nextID = id
  }

  /** Returns a reference to entity `id` which also indicates when the entity has been deleted. The
    * caller should call the `dispose` thunk on the returned ref when they no longer need to observe
    * this entity. If the entity is deleted, the ref will be automatically disposed. */
  ref (id :ID) :Ref {
    let exists = true
    const dispose = this.events.onValue(ev => {
      if (ev.type === "deleted" && ev.id === id) {
        exists = false
        dispose()
      }
    })
    return {id, exists, dispose}
  }

  /** Creates an entity reference set. Entity ids can be added to or removed from the set manually;
    * any entities that are deleted will automatically be removed from the set.
    * @return the id set and a thunk that must be called to stop managing the set when it is no
    * longer needed. */
  refSet () :[Set<ID>, Remover] {
    const ids = new Set<ID>()
    return [ids, this.events.onValue(ev => {
      if (ev.type === "deleted") ids.delete(ev.id)
    })]
  }

  private nextID () :number {
    // for now we just linearly search for the next available id; if we ever want to support so many
    // entities that this becomes expensive, we can do something fancier to speed up this process
    let id = this._nextID, eid = this._endID, config = this._configs
    for (let nid = id+1; nid < eid; nid += 1) {
      if (config[nid] === undefined) {
        this._nextID = nid
        return id
      }
    }
    this._nextID = eid+1
    this._endID = eid+1
    return id
  }

  private emit (type :LifecycleType, id :ID) {
    (this.events as Emitter<LifecycleEvent>).emit({type, id})
  }
}

export interface ComponentConfig<T> {}

type ComponentObserver<T> = (id :ID, value :T, oldValue :T) => void

class ValueObserver<T> {
  private _values :Map<ID, Value<T>> = new Map()
  private _changeFns :Map<ID, ChangeFn<T>> = new Map()

  constructor (readonly comp :Component<T>, readonly eq :Eq<T>) {}

  getValue (id :ID) {
    let value = this._values.get(id)
    if (!value) this._values.set(id, value = Value.deriveValue(
      this.eq,
      changeFn => {
        this._changeFns.set(id, changeFn)
        return () => { this._changeFns.delete(id) }
      },
      () => this.comp.read(id),
    ))
    return value
  }

  onChange (id :ID, value :T, oldValue :T) {
    const changeFn = this._changeFns.get(id)
    if (changeFn && !this.eq(value, oldValue)) changeFn(value, oldValue)
  }
}

/** Maintains the values (numbers, strings, objects, typed arrays) for a particular component, for
  * all entities in a single domain. */
export abstract class Component<T> {
  private _observers :ComponentObserver<T>[] = []
  private _valueobs? :ValueObserver<T>

  /** Creates a component that returns `value` for all entities. Calls to `update` will throw an
    * error. */
  static constant<T> (id :string, value :T) :Component<T> {
    class CC extends Component<T> {
      get id () { return id }
      read (id :ID) { return value }
      update (id :ID, value :T) { throw new Error(`Cannot update constant component '${id}'`) }
      added (id :ID, config? :ComponentConfig<T>) {}
      removed (id :ID) {}
    }
    return new CC()
  }

  /** An identifer for this component that distinguishes it from all other components used on a
    * collection of entities (e.g. `trans` or `hp` or `texture`). This is used to reference this
    * component in entity configuration metadata. */
  abstract get id () :string

  /** Returns the value of this component for entity `id`. If entity `id` does not have this
    * component, the return value is undefined (as in, it can be anything, not that it is
    * `undefined`) and the component may throw an error. Correct code must not read component values
    * for invalid components. */
  abstract read (id :ID) :T

  /** Returns a reactive view of the value for entity `id`. */
  getValue (id :ID) {
    let vobs = this._valueobs
    if (!vobs) {
      vobs = this._valueobs = new ValueObserver<T>(this, this._eq)
      this.addObserver(vobs.onChange.bind(vobs))
    }
    return vobs.getValue(id)
  }

  /** Adds an observer that is notified whenever a component value changes. */
  addObserver (obs :ComponentObserver<T>) :Remover {
    this._observers.push(obs)
    return () => {
      const idx = this._observers.indexOf(obs)
      if (idx >= 0) this._observers.splice(idx, 1)
    }
  }

  protected get _eq () :Eq<T> { return refEquals }

  /** Updates the value of this component for entity `id`. If entity `id` does not have this
    * component, the behavior of this method is undefined and may throw an error. Correct code must
    * not update component values for invalid components. */
  abstract update (id :ID, value :T) :void

  protected _noteUpdated (id :ID, value :T, oldValue :T) {
    const obs = this._observers
    for (let ii = 0, ll = obs.length; ii < ll; ii += 1) obs[ii](id, value, oldValue)
  }

  /** Called when an entity which has this component is added to the owning domain.
    * @param config any component configuration data supplied for the entity. */
  abstract added (id :ID, config? :ComponentConfig<T>) :void

  /** Called when an entity which has this component is deleted from the owning domain. */
  abstract removed (id :ID) :void
}

export interface ValueComponentConfig<T> extends ComponentConfig<T> {
  initial? :T
}

/** Provides a constant value for all entities. */
export class ConstantComponent<T> extends Component<T> {

  constructor (readonly id :string, readonly value :T) { super() }

  read (index :number) { return this.value }
  update (index :number, value :T) {
    throw new Error(`Cannot update constant component [id=${this.id}]`)
  }

  added (id :ID, config? :ValueComponentConfig<T>) {}
  removed (id :ID) {}
}

/** Provides a constant value for all entities, which is obtained from a [[Subject]]. The component
  * must not be used (i.e. entities must not be created which contain it) until the subject is known
  * to have completed. This component must also be disposed when it is no longer in use, this will
  * cause it to cease observing its subject so that it too may be disposed. */
export class DeferredComponent<T> extends Component<T> implements Disposable {
  private release :Remover
  private value! :T
  private gotValue = false

  constructor (readonly id :string, source :Subject<T>) {
    super()
    this.release = source.onValue(value => {
      this.value = value
      this.gotValue = true
    })
  }

  read (index :number) {
    if (this.gotValue) return this.value
    throw new Error(`Deferred component not ready [id=${this.id}]`)
  }
  update (index :number, value :T) {
    throw new Error(`Cannot update constant component [id=${this.id}]`)
  }

  added (id :ID, config? :ValueComponentConfig<T>) {}
  removed (id :ID) {}

  dispose () {
    this.release()
  }
}

/** Maintains simple JavaScript values in a single flat array.
  * Useful for components which will be used by the majority of entities */
export class DenseValueComponent<T> extends Component<T> {
  private values :T[] = []

  constructor (readonly id :string, private readonly defval? :T) { super() }

  read (index :number) :T { return this.values[index] }
  update (index :number, value :T) {
    const oldValue = this.values[index]
    this.values[index] = value
    this._noteUpdated(index, value, oldValue)
  }

  added (id :ID, config? :ValueComponentConfig<T>) {
    const init = config && 'initial' in config ? config.initial : this.defval
    if (init === undefined) throw new Error(
      log.format("Missing required initial value for entity", "comp", this.id, "id", id, "config", config))
    this.values[id] = init as T
  }
  removed (id :ID) { delete this.values[id] }
}

/** Maintains simple JavaScript values in a hash map. Useful for components that are sparsely
  * occupied. Note that `undefined` is handled specially in that updating a component to `undefined`
  * will remove its value mapping and revert its value back to the default. */
export class SparseValueComponent<T> extends Component<T> {
  private readonly values :Map<ID, T> = new Map()

  constructor (readonly id :string, private readonly defval :T) { super() }

  read (id :ID) :T {
    const value = this.values.get(id)
    return value === undefined ? this.defval : value
  }
  update (id :ID, value :T) {
    const oldValue = this.read(id)
    if (value === undefined) this.values.delete(id)
    else this.values.set(id, value)
    this._noteUpdated(id, value, oldValue)
  }

  added (id :ID, config? :ValueComponentConfig<T>) {
    if (config && 'initial' in config) this.values.set(id, config.initial as T)
  }
  removed (id :ID) {
    this.values.delete(id)
  }
}

/** A component backed by a typed array where the component value takes up only a single array slot.
  * Predefined versions are provided for common use cases: [[Float32Component]] for float-valued
  * scalars, and [[IDComponent]] (for entity to entity mappings). */
export abstract class TypedArrayComponent<E, A> extends Component<E> {
  private readonly batches :A[] = []
  private readonly batchMask :number

  constructor (readonly id :string, private readonly defval :number,
               private readonly batchBits :number = 8) {
    super()
    this.batchMask = (1 << batchBits) - 1
  }

  read (id :ID) :E {
    return this.batches[id >> this.batchBits][id & this.batchMask]
  }
  update (id :ID, value :E) {
    const batch = this.batches[id >> this.batchBits]
    const index = id & this.batchMask
    const oldValue = batch[index]
    batch[index] = value
    this._noteUpdated(id, value, oldValue)
  }

  added (id :ID, config? :ValueComponentConfig<number>) {
    const init = config && 'initial' in config ? config.initial : this.defval
    const batix = id >> this.batchBits
    const array = this.batches[batix] || (
      this.batches[batix] = this.createArray(1 << this.batchBits))
    array[id & this.batchMask] = init as number
  }
  // could remove empty batches but that would require tracking batch occupancy; more trouble than
  // its worth
  removed (id :ID) {}

  protected abstract createArray (size :number) :A
}

/** A component providing a single 32-bit float per entity. */
export class Float32Component extends TypedArrayComponent<number, Float32Array> {
  protected createArray (size :number) { return new Float32Array(size) }
}

/** A component providing a single entity ID per entity (for entity to entity maps). */
export class IDComponent extends TypedArrayComponent<ID, Uint32Array> {
  protected createArray (size :number) { return new Uint32Array(size) }
}

/** Tracks membership in a small (relative to the domain entity count) set of entities. */
export class IDSetComponent extends Component<boolean> {
  private _ids :Set<ID> = new Set()

  constructor (readonly id :string) { super() }

  /** Updates the entire set so that it matches the argument. */
  updateAll (set :Set<ID>) {
    // remove anything not present in the new set
    for (const id of this._ids) {
      if (!set.has(id)) this.update(id, false)
    }

    // add anything not present in the old set
    for (const id of set) {
      this.update(id, true)
    }
  }

  read (id :number) :boolean { return this._ids.has(id) }
  update (id :number, value :boolean) {
    const oldValue = this._ids.has(id)
    if (oldValue !== value) {
      value ? this._ids.add(id) : this._ids.delete(id)
      this._noteUpdated(id, value, oldValue)
    }
  }

  added (id :ID, config? :ValueComponentConfig<boolean>) {
    if (config && config.initial) {
      this._ids.add(id)
    }
  }
  removed (id :ID) { this._ids.delete(id) }
}

/** Specializes [[Component]] for handling of array values. Mainly this is the addition of a
  * zero-allocation [[ArrayComponent.read]] method. */
export abstract class ArrayComponent<T> extends Component<T> {

  /** Returns the value of this component for entity `id`. If `into` is supplied, the value will be
    * copied into `into` and `into` will be returned. */
  abstract read (id :ID, into? :T) :T
}

const oldVec2 = vec2.create()

export class Vec2Component extends ArrayComponent<vec2> {
  private readonly batches :Float32Array[] = []
  private readonly batchMask :number

  constructor (readonly id :string, private readonly defval :vec2,
               private readonly batchBits :number = 8) {
    super()
    this.batchMask = (1 << batchBits) - 1
  }

  read (id :ID, into? :vec2) :vec2 {
    const batch = this.batch(id), start = this.start(id)
    if (into) {
      into[0] = batch[start+0]
      into[1] = batch[start+1]
      return into
    }
    else return batch.subarray(start, start+2) as vec2
  }
  update (id :ID, value :Float32Array|number[]) {
    const batch = this.batch(id), start = this.start(id)
    vec2.set(oldVec2, batch[start+0], batch[start+1])
    batch[start+0] = value[0]
    batch[start+1] = value[1]
    this._noteUpdated(id, value as vec2, oldVec2)
  }

  added (id :ID, config? :ValueComponentConfig<Float32Array>) {
    const init = config && 'initial' in config ? config.initial : this.defval
    const batix = id >> this.batchBits
    const batch = this.batches[batix] || (
      this.batches[batix] = new Float32Array((1 << this.batchBits) * 2))
    batch.set(init as Float32Array, (id & this.batchMask) * 2)
  }
  removed (id :ID) {}

  protected batch (id :ID) :Float32Array {
    return this.batches[id >> this.batchBits]
  }
  protected start (id :ID) :number {
    return (id & this.batchMask) * 2
  }
}

export class Float32ArrayComponent extends ArrayComponent<Float32Array> {
  private readonly batches :Float32Array[] = []
  private readonly batchMask :number
  private readonly oldValue :Float32Array

  constructor (readonly id :string, private readonly defval :Float32Array,
               private readonly batchBits :number = 8) {
    super()
    this.batchMask = (1 << batchBits) - 1
    this.oldValue = new Float32Array(defval.length)
  }

  read (id :ID, into? :Float32Array) :Float32Array {
    const batch = this.batch(id), size = this.defval.length, start = (id & this.batchMask) * size
    if (into) {
      for (let ii = 0; ii < size; ii += 1) into[ii] = batch[start+ii]
      return into
    }
    else return batch.subarray(start, start+size)
  }
  update (id :ID, value :Float32Array|number[]) {
    this.read(id, this.oldValue)
    this.batch(id).set(value, this.start(id))
    this._noteUpdated(id, value as Float32Array, this.oldValue)
  }

  added (id :ID, config? :ValueComponentConfig<Float32Array>) {
    const init = config && 'initial' in config ? config.initial : this.defval
    const size = this.defval.length, batix = id >> this.batchBits
    const batch = this.batches[batix] || (
      this.batches[batix] = new Float32Array((1 << this.batchBits) * size))
    batch.set(init as Float32Array, (id & this.batchMask) * size)
  }
  removed (id :ID) {
    // could remove empty batches but that would require tracking batch occupancy;
    // more trouble than its worth
  }

  /** Applies `fn` to every individual component in bulk. `fn` is called whether or not the
    * components are in use, so the caller must either determine on its own whether a component
    * should be operated upon, or function correctly even if called on uninitialized components. To
    * avoid creating unnecessary garbage, `fn` is called with the underlying bulk `Float32Array` and
    * an offset and size into that array which identifies the component data. */
  onComponents (fn :(id :ID, data :Float32Array, offset :number, size :number) => void) {
    const size = this.defval.length
    for (let bb = 0, bm = this.batches.length; bb < bm; bb += 1) {
      const batch = this.batches[bb]
      const bid = bb << this.batchBits
      for (let vv = 0, vm = batch.length; vv < vm; vv += 1) {
        const vid = bid | vv, offset = vv * size
        fn(vid, batch, offset, size)
      }
    }
  }

  protected batch (id :ID) :Float32Array {
    return this.batches[id >> this.batchBits]
  }
  protected start (id :ID) :number {
    const idx = id & this.batchMask, size = this.defval.length
    return idx * size
  }
}

/** Determines whether an entity should be operated upon by a system. */
type MatchFn = (cfg :EntityConfig) => boolean

/** Combinators for creating functions that match entities based on which tags and components they
  * contain. Used by systems to determine which entities on which to operate. */
export class Matcher {

  /** Matches an entity if it has a component with `id`. */
  static hasC (id :string) :MatchFn {
    return cfg => id in cfg.components
  }

  /** Matches an entity if it has all components with `ids`. */
  static hasAllC (...ids :string[]) :MatchFn {
    return cfg => {
      for (const id of ids) if (!(id in cfg.components)) return false
      return true
    }
  }

  /** Matches an entity if it has any component with `ids`. */
  static hasAnyC (...ids :string[]) :MatchFn {
    return cfg => {
      for (const id of ids) if (id in cfg.components) return true
      return false
    }
  }

  /** Matches an entity if it has `tag`. */
  static hasT (tag :string) :MatchFn {
    return cfg => cfg.tags ? cfg.tags.has(tag) : false
  }

  /** Matches an entity if it has all `tags`. */
  static hasAllT (...tags :string[]) :MatchFn {
    return cfg => {
      if (!cfg.tags) return false
      for (const tag of tags) if (!cfg.tags.has(tag)) return false
      return true
    }
  }

  /** Matches an entity if it has any tag in `tags`. */
  static hasAnyT (...tags :string[]) :MatchFn {
    return cfg => {
      if (!cfg.tags) return false
      for (const tag of tags) if (cfg.tags.has(tag)) return true
      return false
    }
  }

  /** Matches an entity if all `fns` match the entity. */
  static and (...fns :MatchFn[]) :MatchFn {
    return cfg => fns.every(fn => fn(cfg))
  }

  /** Matches an entity if any fn in `fns` matches the entity. */
  static or (...fns :MatchFn[]) :MatchFn {
    return cfg => fns.findIndex(fn => fn(cfg)) >= 0
  }
}

/** Defines a subset of entities (based on a supplied matching function) and enables bulk operation
  * on them. */
export class System {
  private readonly _ids = new BitSet()
  private readonly _enabled = new BitSet()

  /** Creates a system in `domain` that operates on entites that match `matchFn`. */
  constructor (readonly domain :Domain, matchFn :MatchFn) {
    domain.events.onEmit(event => {
      const id = event.id, config = domain.entityConfig(id)
      switch (event.type) {
      case    "added": if (matchFn(config)) this.added(id, config) ; break
      case  "deleted": if (this._ids.has(id)) this.deleted(id) ; break
      case  "enabled": if (this._ids.has(id)) this._enabled.add(id) ; break
      case "disabled": if (this._ids.has(id)) this._enabled.delete(id) ; break
      }
    })
  }

  /** Applies `fn` to all (enabled) entities matched by this system. */
  onEntities (fn :(id :ID) => any) {
    // TODO: if we have a "primary" component, use that to determine iteration order
    this._enabled.forEach(fn)
  }

  /** Returns the ID of the first entity that matches `pred`, or `-1` if no entity matches. */
  findEntity (pred :(id :ID) => boolean) :ID {
    // TODO: if we have a "primary" component, use that to determine iteration order
    return this._enabled.find(pred)
  }

  protected added (id :ID, config :EntityConfig) {
    this._ids.add(id)
  }

  protected deleted (id :ID) {
    this._ids.delete(id)
  }
}

/** The canonical id of the graph component. */
export const CanonicalGraphId = "graph"

/** Handles entities with behavior graphs. */
export class GraphSystem extends System {
  private _ctx :EntityNodeContext

  constructor (ctx :NodeContext, domain :Domain, readonly graph :Component<Graph>) {
    super(domain, Matcher.hasC(graph.id))
    this._ctx = Object.create(ctx)
    this._ctx.domain = domain
  }

  /** Updates the state of the graph system.  Should be called once per frame. */
  update (clock :Clock) {
    this.onEntities(id => this.graph.read(id).update(clock))
  }

  protected added (id :ID, config :EntityConfig) {
    super.added(id, config)
    const subctx = Object.create(this._ctx)
    subctx.entityId = id
    const graph = new Graph(subctx, config.components[this.graph.id])
    this.graph.update(id, graph)
    graph.connect()
  }

  protected deleted (id :ID) {
    this.graph.read(id).dispose()
    super.deleted(id)
  }
}
