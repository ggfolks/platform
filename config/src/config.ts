import { Data, Record, isSet } from "@tfw/core/data"

/** Indicates that a record property should not inherit from a record property with the same name in
  * a parent config. */
const REPLACE_PROP = '__replace__'

/** A marker property defined on a record to indicate that it is a config object. */
const IS_CONFIG_PROP = '__is_config__'

/** A marker property defined on a record to indicate that it is an immutable value and can be used
  * as is in a deep copy of a containing object. */
const IS_VALUE_PROP = '__is_value__'

/**
 * Creates a deep copy of the specified value. This deep copies all array, set and object valued
 * properties. It copies all enumerable properties and disconnects from any config inheritance.
 * @param value the value to copy.
 * @return the copied value.
 */
export function deepCopy (value :Data) :Data {
  if (typeof value !== 'object' || value === null || value[IS_VALUE_PROP]) {
    return value
  }

  let copy :Data
  if (Array.isArray(value)) {
    copy = (value as Array<Data>).map(deepCopy)

  } else if (isSet(value)) {
    const setv = value as Set<Data>, setc = new Set<Data>()
    setv.forEach(elem => setc.add(deepCopy(elem)))
    copy = setc

  // } else if (isMap(value)) {
  //   const mapv = value as Map<Data,Data>, mapc = new Map<Data,Data>()
  //   mapv.forEach((elem, key) => mapc.set(deepCopy(key), deepCopy(elem)))
  //   copy = mapc

  } else if (value[IS_CONFIG_PROP]) {
    // this is an inherited config object: we need to deep copy all props, including inherited ones
    copy = {}
    for (const key in value) {
      copy[key] = deepCopy(value[key])
    }

  } else {
    // this is just a regular object: we only want to deep copy own-props and preserve inheritance
    copy = Object.create(Object.getPrototypeOf(value))
    for (const key in value) {
      if (value.hasOwnProperty(key)) {
        copy[key] = deepCopy(value[key])
      }
    }
  }
  return copy
}

/**
 * Creates a deep copy of `child` which inherits from `parent` at every point where `child` and
 * `parent` share the same 'paths'. `child` inherits from `parent` (the empty path), and if both
 * child and parent have a subobject with key `foo` then that child subobject is made to inherit
 * from the corresponding `foo` in the parent. This proceedes recursively through the entire child
 * object tree.
 *
 * If a child subobject contains a special marker property: `__replace__: true` or it is an empty
 * object it will not inherit from the parent subobject (and will instead effectively replace it).
 *
 * Special handling is also performed for properties with `Set` values: if a parent defines a
 * property with a `Set` value, any `Set` or `array` valued 'override' of that property by a child
 * will merge in the values from the parent and be `Set` valued itself.
 *
 * *NOTE*: this also freezes the returned deep copy of `child`, preventing it from being further
 * modified. It is assumed that the parent is already frozen, having been loaded as a config
 * object itself.
 */
export function deepInherit (child :Record, parent :Record) {
  if (child[REPLACE_PROP]) {
    return Object.freeze(deepCopy(child))
  }

  const heir = Object.create(parent)
  // define a non-enumerable property we can use to identify config objects;
  // this is needed to do The Right Thing(tm) in deepCopy
  Object.defineProperty(heir, IS_CONFIG_PROP, {value: true})

  for (const key in child) {
    // note: we don't check hasOwnProperty on the parent, we want to search as far up the parent
    // chain as necessary to find a sub-parent
    if (child.hasOwnProperty(key)) {
      const subChild = child[key], subParent = parent[key]
      let subValue :Readonly<Data>
      if (isSet(subParent) && (isSet(subChild) || Array.isArray(subChild))) {
        const subSet = new Set(subChild as Iterable<Data>)
        if (subSet.size > 0) {
          (subParent as Set<Data>).forEach(elem => subSet.add(elem))
        }
        subValue = Object.freeze(subSet)
      } else if (typeof subChild === 'object' && typeof subParent === 'object' &&
                 !Array.isArray(subChild) && Object.keys(subChild).length > 0) {
        subValue = deepInherit(subChild as Record, subParent as Record)
      } else {
        subValue = Object.freeze(deepCopy(subChild))
      }
      Object.defineProperty(heir, key, {value: subValue, enumerable: true})
    }
  }
  return Object.freeze(heir)
}
