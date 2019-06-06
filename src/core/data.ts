
export interface DataArray extends Array<Data> {}
export interface DataSet extends Set<Data> {}
export type DataMapKey = number | string
export interface DataMap extends Map<DataMapKey,Data> {}
export interface Record { [key :string] :Data }

export type Data = void | boolean | number | string | DataArray | DataSet | DataMap | Record

export function isSet (value :Data) :boolean {
  return (value instanceof Set) || (
    // this is needed for cross-domain objects in Node
    value !== null && typeof value === 'object' && value.constructor.name === 'Set')
}

export function isMap (value :Data) :boolean {
  return (value instanceof Map) || (
    // this is needed for cross-domain objects in Node
    value !== null && typeof value === 'object' && value.constructor.name === 'Map')
}

/**
 * Creates a deep copy of the specified data value. This deep copies all array, set, map and record
 * valued properties.
 */
export function dataCopy<T extends Data> (value :T) :T {
  if (typeof value !== "object" || value === null) {
    return value
  }

  if (Array.isArray(value)) {
    return (value as Array<Data>).map(dataCopy) as T

  } else if (isSet(value)) {
    const setv = value as Set<Data>, setc = new Set<Data>()
    setv.forEach(elem => setc.add(dataCopy(elem)))
    return setc as T

  } else if (isMap(value)) {
    const mapv = value as Map<Data,Data>, mapc = new Map<Data,Data>()
    mapv.forEach((elem, key) => mapc.set(dataCopy(key), dataCopy(elem)))
    return mapc as T

  } else {
    // this is just a regular object: we only want to deep copy own-props and preserve inheritance
    const recv = value as Record, recc = Object.create(Object.getPrototypeOf(value))
    for (const key in recv) {
      if (recv.hasOwnProperty(key)) {
        recc[key] = dataCopy(recv[key])
      }
    }
    return recc
  }
}

/**
 * Tests the structural equality of two data values. This compares all elements of arrays, sets,
 * maps and record valued subproperties.
 */
export function dataEquals (a :Data, b :Data) :boolean {
  if (a === b) return true
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    const alen = a.length, blen = b.length
    if (alen !== blen) return false
    for (let ii = 0; ii < alen; ii += 1) if (!dataEquals(a[ii], b[ii])) return false
    return true
  }
  if (isSet(a)) {
    if (!isSet(b)) return false
    const aset = a as DataSet, bset = b as DataSet
    if (aset.size !== bset.size) return false
    for (const elem of aset) if (!bset.has(elem)) return false
    return true
  }
  if (isMap(a)) {
    if (!isMap(b)) return false
    const amap = a as DataMap, bmap = b as DataMap
    if (amap.size !== bmap.size) return false
    for (const [key, value] of amap) if (!dataEquals(value, bmap.get(key))) return false
    return true
  }
  if (Array.isArray(b) || isSet(b) || isMap(b)) return false
  for (const key in a) if (a.hasOwnProperty(key) && !dataEquals(a[key], b[key])) return false
  for (const key in b) if (b.hasOwnProperty(key) && !a.hasOwnProperty(key)) return false
  return true
}
