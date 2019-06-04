import { Data, Record, isSet, isMap } from "../core/data"

/** Indicates that a record property should not inherit from a record property with the same name in
  * a parent config, but rather should replace it outright. */
const REPLACE_PROP = "__replace__"

/**
 * Merges a chain of inherited config records. `configs` must be ordered from child-most to
 * parent-most. Records are merged property by property, with child values overriding parent values.
 * In the case of set-valued properties, child sets are unioned with parent sets. Record-valued
 * properties are recursively merged with parent records. For both record- and set-valued
 * properties, if the child declares an explicit empty record or set, that property _overrides_ the
 * parent property instead of being merged with it.
 */
export function inheritMerge (configs :Record[]) :Record {
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
        const sset = sprop as Set<Data>, merged = new Set(tprop as Set<Data>)
        sset.forEach(elem => merged.add(elem))
        target[key] = merged
      }
      else if (isMap(sprop)) {
        throw new Error("TODO")
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
  return Object.freeze(configs.reverse().reduce(merge, {}))
}
