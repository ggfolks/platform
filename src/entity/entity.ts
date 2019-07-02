import {BitSet} from "../core/util"
import {Record} from "../core/data"
import {Stream, Emitter} from "../core/react"

export type ID = number

export type EntityEventType = "added" | "enabled" | "disabled" | "deleted"
export type EntityEvent = {type :EntityEventType, id :ID}

export type DomainConfig = {
  // TODO
}

export type EntityConfig = {
  /** The components used by this entity, mapped to config for each component. */
  components :{[key :string]: Record}
  /** Tags assigned to this entity. */
  tags? :Set<string>
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

  constructor (readonly config :DomainConfig, readonly components :{[key :string] :Component<any>}) {}

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
      else throw new Error(`Unknown component for entity '${cid}' (have: ${Object.keys(this.components)})`)
    }
    this.emit("added", id)
    // TODO: it's possible that an `added` signal listener will manipulate this entity's enabled state, in which
    // case we'll override that change on the next line... maybe that's OK?
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

  private emit (type :EntityEventType, id :ID) {
    (this.events as Emitter<EntityEvent>).emit({type, id})
  }
}

export interface ComponentConfig<T> {}

/** Maintains the values (numbers, strings, objects, typed arrays) for a particular component, for all entities in a
  * signle domain. */
export abstract class Component<T> {

  /** An identifer for this component that distinguishes it from all other components used on a collection of
    * entities (e.g. `trans` or `hp` or `texture`). This is used to reference this component in entity
    * configuration metadata. */
  abstract get id () :string

  /** Returns the value of this component for entity `id`. If entity `id` does not have this component, the return
    * value is undefined (as in, it can be anything, not that it is `undefined`) and the component may throw an
    * error. Correct code must not read component values for invalid components. */
  abstract read (id :ID) :T

  /** Updates the value of this component for entity `id`. If entity `id` does not have this component, the behavior
    * of this method is undefined and may throw an error. Correct code must not update component values for invalid
    * components. */
  abstract update (id :ID, value :T) :void

  /** Called when an entity which has this component is added to this component's owning domain.
    * @param config any component configuration data supplied for the entity. */
  abstract added (id :ID, config? :ComponentConfig<T>) :void

  /** Called when an entity which has this component is deleted from this component's owning domain. */
  abstract removed (id :ID) :void

  /** Applies `fn` to the ids of all entities with this component. The component controls the iteration order so that
    * it can do so efficiently based on its data layout. */
  abstract onEntities (fn :(id :ID) => any) :void
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
    // typescript doesn't treat ('initial' in config) as proof that config.initial contains a value of T, but we need
    // to `in` because we want to allow configs to explicitly express that the initial value is something falsey
    const init = config && 'initial' in config ? config.initial : this.defval
    this.values[id] = init as T
  }

  removed (id :ID) { delete this.values[id] }

  onEntities (fn :(id :ID) => any) {
  }
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

/** Determines whether an entity should be operated upon by a system. */
type MatchFn = (cfg :EntityConfig) => boolean

/** Combinators for creating functions that match entities based on which tags and components they contain.
  * Used by systems to determine which entities on which to operate. */
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

/** Defines a subset of entities (based on a supplied matching function) and enables bulk operation on them. */
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
