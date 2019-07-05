import {BitSet} from "../core/util"
import {Record} from "../core/data"
import {Stream, Emitter} from "../core/react"

export type ID = number

export type LifecycleType = "added" | "enabled" | "disabled" | "deleted"
export type LifecycleEvent = {type :LifecycleType, id :ID}

export type DomainConfig = {
  // TODO
}

export type EntityConfig = {
  /** The components used by this entity, mapped to config for each component. */
  components :{[key :string]: Record}
  /** Tags assigned to this entity. */
  tags? :Set<string>
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
               readonly components :{[key :string] :Component<any>}) {}

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

/** Maintains the values (numbers, strings, objects, typed arrays) for a particular component, for
  * all entities in a single domain. */
export abstract class Component<T> {

  /** An identifer for this component that distinguishes it from all other components used on a
    * collection of entities (e.g. `trans` or `hp` or `texture`). This is used to reference this
    * component in entity configuration metadata. */
  abstract get id () :string

  /** Returns the value of this component for entity `id`. If entity `id` does not have this
    * component, the return value is undefined (as in, it can be anything, not that it is
    * `undefined`) and the component may throw an error. Correct code must not read component values
    * for invalid components. */
  abstract read (id :ID) :T

  /** Updates the value of this component for entity `id`. If entity `id` does not have this
    * component, the behavior of this method is undefined and may throw an error. Correct code must
    * not update component values for invalid components. */
  abstract update (id :ID, value :T) :void

  /** Called when an entity which has this component is added to the owning domain.
    * @param config any component configuration data supplied for the entity. */
  abstract added (id :ID, config? :ComponentConfig<T>) :void

  /** Called when an entity which has this component is deleted from the owning domain. */
  abstract removed (id :ID) :void
}

export interface ValueComponentConfig<T> extends ComponentConfig<T> {
  initial? :T
}

/** Maintains simple JavaScript values in a single flat array.
  * Useful for components which will be used by the majority of entities */
export class DenseValueComponent<T> extends Component<T> {
  private values :T[] = []

  constructor (readonly id :string, private readonly defval :T) { super() }

  read (index :number) :T { return this.values[index] }
  update (index :number, value :T) { this.values[index] = value }

  added (id :ID, config? :ValueComponentConfig<T>) {
    const init = config && 'initial' in config ? config.initial : this.defval
    this.values[id] = init as T
  }
  removed (id :ID) { delete this.values[id] }
}

/** Maintains simple JavaScript values in a hash map. Useful for components that are sparsely
  * occupied. */
export class SparseValueComponent<T> extends Component<T> {
  private readonly values :Map<ID, T> = new Map()

  constructor (readonly id :string, private readonly defval :T) { super() }

  read (id :ID) :T {
    return this.values.get(id) as T
  }
  update (id :ID, value :T) {
    this.values.set(id, value)
  }

  added (id :ID, config? :ValueComponentConfig<T>) {
    const init = config && 'initial' in config ? config.initial : this.defval
    this.values.set(id, init as T)
  }
  removed (id :ID) {
    this.values.delete(id)
  }
}

export class Float32Component extends Component<number> {
  private readonly values :Float32Array[] = []
  private readonly batchMask :number

  constructor (readonly id :string, private readonly batchBits :number,
               private readonly defval :number) {
    super()
    this.batchMask = (1 << batchBits) - 1
  }

  read (id :ID) :number {
    return this.values[id >> this.batchBits][id & this.batchMask]
  }
  update (id :ID, value :number) {
    this.values[id >> this.batchBits][id & this.batchMask] = value
  }

  added (id :ID, config? :ValueComponentConfig<number>) {
    const init = config && 'initial' in config ? config.initial : this.defval
    const arrix = id >> this.batchBits
    const array = this.values[arrix] || (this.values[arrix] = new Float32Array(1 << this.batchBits))
    array[id & this.batchMask] = init as number
  }
  // could remove empty batches but that would require tracking batch occupancy; more trouble than
  // its worth
  removed (id :ID) {}
}

export class Float32ArrayComponent extends Component<Float32Array> {
  private readonly values :Float32Array[] = []
  private readonly batchMask :number

  constructor (readonly id :string, private readonly batchBits :number,
               private readonly defval :Float32Array) {
    super()
    this.batchMask = (1 << batchBits) - 1
  }

  read (id :ID) :Float32Array {
    const idx = id & this.batchMask, size = this.defval.length, start = idx * size
    // TODO: how expensive is it to make subarrays? maybe we want to cache them?
    return this.values[id >> this.batchBits].subarray(start, start + size)
  }
  update (id :ID, value :Float32Array|number[]) {
    const idx = id & this.batchMask, size = this.defval.length
    this.values[id >> this.batchBits].set(value, idx * size)
  }

  added (id :ID, config? :ValueComponentConfig<Float32Array>) {
    const init = config && 'initial' in config ? config.initial : this.defval
    const arrix = id >> this.batchBits
    const array = this.values[arrix] || (this.values[arrix] = new Float32Array(1 << this.batchBits))
    const idx = id & this.batchMask, size = this.defval.length
    array.set(init as Float32Array, idx * size)
  }
  // could remove empty batches but that would require tracking batch occupancy; more trouble than
  // its worth
  removed (id :ID) {}

  /** Applies `fn` to every individual component in bulk. `fn` is called whether or not the
    * components are in use, so the caller must either determine on its own whether a component
    * should be operated upon, or function correctly even if called on uninitialized components. To
    * avoid creating unnecessary garbage, `fn` is called with the underlying bulk `Float32Array` and
    * an offset and size into that array which identifies the component data. */
  onComponents (fn :(id :ID, data :Float32Array, offset :number, size :number) => void) {
    const size = this.defval.length
    for (let bb = 0, bm = this.values.length; bb < bm; bb += 1) {
      const batch = this.values[bb]
      const bid = bb << this.batchBits
      for (let vv = 0, vm = batch.length; vv < vm; vv += 1) {
        const vid = bid | vv, offset = vv * size
        fn(vid, batch, offset, size)
      }
    }
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
  private _ids = new BitSet()

  /** Creates a system in `domain` that operates on entites that match `matchFn`. */
  constructor (readonly domain :Domain, matchFn :MatchFn) {
    domain.events.onEmit(event => {
      const id = event.id, config = domain.entityConfig(id)
      switch (event.type) {
      case   "added": if (matchFn(config)) this.added(id, config) ; break
      case "deleted": if (this._ids.has(id)) this.deleted(id) ; break
      }
    })
  }

  /** Applies `fn` to all (enabled) entities matched by this system. */
  onEntities (fn :(id :ID) => any) {
    // TODO: if we have a "primary" component, use that to determine iteration order
    this._ids.forEach(fn)
  }

  protected added (id :ID, config :EntityConfig) {
    this._ids.add(id)
  }

  protected deleted (id :ID) {
    this._ids.delete(id)
  }
}
