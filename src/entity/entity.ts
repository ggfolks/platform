import {BitSet} from "../core/util"
import {Record} from "../core/data"
import {Stream, Emitter} from "../core/react"

export type ID = number

export type EntityEventType = "added" | "enabled" | "disabled" | "deleted"
export type EntityEvent = {type :EntityEventType, id :ID}

export type DomainConfig = {
  /** The components available to entities in this domain, mapped by instance. */
  components :{[key :string] :Component<any>}
}

export type EntityConfig = {
  /** The components used by this entity and their configuration. */
  components :{[key :string]: Record}
}

/** A collection of entities and their configuration records. Entity ids are only unique within a single domain, and
  * systems operate in a single domain. A game can safely use a single domain for all of its entities, at the cost of
  * some memory and/or performance overhead. If a game contains multiple separate entity domains, it can opt to use
  * separate `Domain` instances for those domains to achieve better memory locality and more compact component data
  * arrays within each domain, but must simply be careful never to mix entity ids from separate domains. */
export class Domain {
  private _enabled = new BitSet()
  private _configs :EntityConfig[] = []
  private _nextID = 0
  private _endID = 0

  /** Emits events when entities are added, enabled, disabled or deleted. */
  readonly events :Stream<EntityEvent> = new Emitter<EntityEvent>()

  constructor (readonly config :DomainConfig) {}

  /** Returns the configuration for entity `id`.
    * @throws Error if no entity exists with `id`. */
  entityConfig (id :ID) :EntityConfig {
    const config = this._configs[id]
    if (!config) throw new Error(`Requested config for missing entity ${id}`)
    return config
  }

  /** Adds an entity with the specified `config`.
    * @param enabled if true, the entity will be enabled immediately after adding. */
  add (config :EntityConfig, enabled = true) :ID {
    const id = this.nextID()
    this._configs[id] = config
    // initialize components for this entity based on its config
    for (let cid in config.components) {
      const ccfg = config.components[cid]
      const comp = this.config.components[cid]
      if (comp) comp.added(id, ccfg)
      else throw new Error(`Unknown component for entity '${cid}' (have: ${Object.keys(this.config.components)})`)
    }
    this.emit("added", id)
    // TODO: it's possible that an `added` signal listener will manipulate this entity's enabled state, in which
    // case we'll override that change on the next line... maybe that's OK?
    enabled && this.enable(id)
    return id
  }

  /** Enables entity `id`. Does nothing if entity is already enabled. */
  enable (id :ID) {
    this._enabled.add(id) && this.emit("enabled", id)
  }

  /** Disables entity `id`. Does nothing if entity is already disabled. */
  disable (id :ID) {
    this._enabled.delete(id) && this.emit("disabled", id)
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

  private emit (type :EntityEventType, id :ID) {
    (this.events as Emitter<EntityEvent>).emit({type, id})
  }
}

export interface ComponentConfig<T> {}

/** Maintains the values (numbers, strings, objects, typed arrays) for a particular component. */
export abstract class Component<T> {

  /** An identifer for this component that distinguishes it from all other components used on a collection of
    * entities (e.g. `trans` or `hp` or `texture`). This is used to reference this component in entity
    * configuration metadata. */
  abstract get id () :string

  abstract read (id :ID) :T

  abstract update (id :ID, value :T) :void

  abstract added (id :ID, config? :ComponentConfig<T>) :void

  abstract removed (id :ID) :void
}

export interface ValueComponentConfig<T> extends ComponentConfig<T> {
  initial? :T
}

/** Maintains simple JavaScript values in a single flat array. This is useful for components which will be used by
  * the majority of entities */
export class FlatValueComponent<T> extends Component<T> {
  private values :T[] = []

  constructor (readonly id :string, private readonly defval :T) { super() }

  read (index :number) :T { return this.values[index] }
  update (index :number, value :T) { this.values[index] = value }

  added (id :ID, config? :ValueComponentConfig<T>) {
    const vconfig = config as ValueComponentConfig<T>
    // typescript doesn't treat ('initial' in config) as proof that config.initial contains a value of T, but we need
    // to `in` because we want to allow configs to explicitly express that the initial value is something falsey
    const init = vconfig && 'initial' in vconfig ? vconfig.initial : this.defval
    this.values[id] = init as T
  }

  removed (id :ID) { delete this.values[id] }
}

/** A component that remaps */
export abstract class BatchedComponent<T> extends Component<T> {
}

/** Maintains a "batch" of component values. The values for a component are stored in batches in contiguous
  * arrays, so as to maintain good memory locality. A mapping is maintained from component id to batch index (and
  * vice versa), to allow dense packing of values even for a sparse component array. */
export abstract class Batch<T> {
  abstract read (index :number) :T
  abstract update (index :number, value :T) :void
}

export abstract class System {

  constructor (readonly domain :Domain) {}

}
