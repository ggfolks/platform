import { Data, DataMap, DataSet, Record, isSet, isMap } from "./data"
import { Value, constantOpt } from "./react"

/** Indicates that a record property should not inherit from a record property with the same name in
  * a parent config, but rather should replace it outright. */
const REPLACE_PROP = "__replace__"

/** The name of the property that defines the _prototype_ for a given config record. A config record
  * inherits values from its prototype. */
const PROTOTYPE_PROP = "prototype"

/**
 * Merges a chain of inherited config records. `configs` must be ordered from child-most to
 * parent-most. Records are merged property by property, with child values overriding parent values.
 * In the case of set-valued properties, child sets are unioned with parent sets. Record-valued
 * properties are recursively merged with parent records. For both record- and set-valued
 * properties, if the child declares an explicit empty record or set, that property _overrides_ the
 * parent property instead of being merged with it.
 */
export function makeConfig (configs :Record[]) :Record {
  function merge (target :Record, source :Record) :Record {
    for (const key in source) {
      const sprop = source[key], tprop = target[key]
      const sourceIsObject = typeof sprop === "object"
      if (!sourceIsObject || sprop === null) {
        target[key] = sprop
      }
      // TODO: support custom _merge property
      // else if (sprop._merge) {
      //   target[key] = sprop._merge(tprop)
      // }
      else if (isSet(sprop)) {
        const sset = sprop as DataSet, merged = new Set(tprop as Set<Data>)
        sset.forEach(elem => merged.add(elem))
        target[key] = merged
      }
      else if (isMap(sprop)) {
        const smap = sprop as DataMap, merged = new Map(tprop as DataMap)
        smap.forEach((val, key) => merged.set(key, val))
        target[key] = merged
      }
      else if (Array.isArray(sprop)) {
        target[key] = sprop.slice(0)
      }
      // if the target prop is not a record, overwrite it; otherwise merge
      else if (typeof tprop !== "object" || Array.isArray(tprop) || isSet(tprop) ||
               tprop[REPLACE_PROP] === true) {
        // TODO: warn about invalid merge?
        target[key] = merge({}, sprop as Record)
      }
      else {
        target[key] = merge(tprop as Record, sprop as Record)
      }
    }
    return target
  }
  return Object.freeze(configs.reduceRight(merge, {}))
}

/**
 * Loads config records based on their path. Used by [resolveConfig].
 */
export interface Source {

  /**
   * Loads the config record at `path`. The record value may be `undefined` until it is resolved via
   * some asynchronous process. If the record is backed by a reactive data store, its value may
   * subsequently change due to changes that occur on the underlying data store.
   */
  load (path :string) :Value<Record|undefined>
}

/**
 * Resolves the config record at `path` from `source`. If the record at `path` derives from a
 * prototype, it too will be resolved and so forth until the complete hierarchy of records has been
 * resolved and correctly merged. Because the initial process may require multiple asynchronous
 * loads, the returned value will be `undefined` until the entire inheritance chain has been
 * successfully resolved for the first time.
 *
 * TODO: do we want to expose errors at this level of the abstraction? I think probably not. Instead
 * the tfw.data client can expose a more "global" error state, so that if all is hosed, we can just
 * shut everything down and show an error screen. Fine grained error reporting is somewhat pointless
 * since there's not much we can usefully do when our persistent data layer is dead.
 */
export function resolveConfig (source :Source, path :string) :Value<Record|undefined> {
  function resolveProtos (path :string, protos :Record[]) :Value<Record[]|undefined> {
    return source.load(path).switchMap(config => {
      if (!config) return constantOpt<Record[]>(undefined)
      const newProtos = protos.concat([config])
      const nextPath = config[PROTOTYPE_PROP] as string
      if (nextPath) return resolveProtos(nextPath, newProtos)
      return constantOpt(newProtos)
    })
  }
  return resolveProtos(path, []).map(cfgs => cfgs && makeConfig(cfgs))
}
