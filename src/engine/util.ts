import {Base64} from "../core/basex"
import {Decoder, Encoder} from "../core/codec"
import {Color} from "../core/color"
import {Bounds, mat4, quat, quatIdentity, vec3, vec3one, vec3unitY} from "../core/math"
import {Interp, Easing} from "../core/interp"
import {Emitter, Stream} from "../core/react"
import {PMap, log, toFloat32String} from "../core/util"
import {Time, Transform} from "./game"

/** A coroutine that moves a transform over time from its current position to a new one.
  * @param transform the transform to modify.
  * @param position the new position (in local space).
  * @param duration the duration, in seconds, over which to move.
  * @param [easing=linear] the type of easing to use. */
export function* moveTo (
  transform :Transform,
  position :vec3,
  duration :number,
  ease :Interp = Easing.linear,
) {
  yield* animateTo(transform, "localPosition", position, duration, ease)
}

/** A coroutine that moves a transform along a cubic spline to the specified endpoint, using the
  * provided previous and next points to determine tangents.
  * @param transform the transform to modify.
  * @param previous the point before the current position.
  * @param end the target position.
  * @param next the position after the target position.
  * @param speed the speed at which to travel. */
export function* moveThrough (
  transform :Transform,
  previous :vec3,
  end :vec3,
  next :vec3,
  speed :number,
) {
  // see https://en.wikipedia.org/wiki/Cubic_Hermite_spline#Catmull%E2%80%93Rom_spline
  // and http://www.cs.cmu.edu/~462/www/projects/assn2/assn2/catmullRom.pdf
  // and https://qroph.github.io/2018/07/30/smooth-paths-using-catmull-rom-splines.html

  const p0 = previous
  const p1 = vec3.clone(transform.localPosition)
  const p2 = end
  const p3 = next

  const alpha = 0.5 // "centripetal" Catmull-Rom
  const t01 = Math.pow(vec3.distance(p0, p1), alpha)
  const t12 = Math.pow(vec3.distance(p1, p2), alpha)
  const t23 = Math.pow(vec3.distance(p2, p3), alpha)

  const tmp1 = vec3.subtract(vec3.create(), p1, p0)
  vec3.scale(tmp1, tmp1, 1 / t01)
  const tmp2 = vec3.subtract(vec3.create(), p2, p0)
  vec3.scale(tmp2, tmp2, 1 / (t01 + t12))
  const d1 = vec3.subtract(vec3.create(), tmp1, tmp2)

  vec3.subtract(tmp1, p3, p2)
  vec3.scale(tmp1, tmp1, 1 / t23)
  vec3.subtract(tmp2, p3, p1)
  vec3.scale(tmp2, tmp2, 1 / (t12 + t23))
  const d2 = vec3.subtract(vec3.create(), tmp1, tmp2)

  const m1 = vec3.subtract(vec3.create(), p2, p1)
  vec3.scaleAndAdd(m1, m1, d1, t12)
  const m2 = vec3.subtract(vec3.create(), p2, p1)
  vec3.scaleAndAdd(m2, m2, d2, t12)

  // compute the cubic coefficients a and b (c is m1, d is p1)
  const a = vec3.subtract(vec3.create(), p1, p2)
  vec3.add(a, vec3.add(a, vec3.scale(a, a, 2), m1), m2)
  const b = vec3.subtract(vec3.create(), p2, p1)
  vec3.subtract(b, vec3.scaleAndAdd(b, vec3.scale(b, b, 3), m1, -2), m2)

  const position = vec3.create()
  const tangent = vec3.create()
  for (let t = 0; t < 1; ) {
    // compute the position using the parameter and coefficients
    const t2 = t * t, t3 = t2 * t
    vec3.scale(position, a, t3)
    vec3.scaleAndAdd(position, position, b, t2)
    vec3.scaleAndAdd(position, position, m1, t)
    vec3.add(transform.localPosition, position, p1)

    // compute the tangent
    vec3.scale(tangent, a, 3 * t2)
    vec3.scaleAndAdd(tangent, tangent, b, 2 * t)
    vec3.add(tangent, tangent, m1)

    // use the tangent to compute rotation and update parameter
    t = Math.min(t + Time.deltaTime * speed / vec3.length(tangent), 1)
    yRotationTo(transform.localRotation, tangent)

    yield
  }
}

/** A coroutine that rotates a transform over time from its current orientation to a new one.
  * @param transform the transform to modify.
  * @param rotation the new rotation (in local space).
  * @param duration the duration, in seconds, over which to rotate.
  * @param [ease=linear] the type of easing to use. */
export function* rotateTo (
  transform :Transform,
  rotation :quat,
  duration :number,
  ease :Interp = Easing.linear,
) {
  yield* animateTo(transform, "localRotation", rotation, duration, ease)
}

/** Finds the quaternion that rotates Z+ to the specified direction about y.  This is useful in
  * preference to quat.rotateTo because that function sometimes (probably when the angle is close to
  * 180 degrees) chooses odd rotation axes.
  * @param out the quaternion to hold the result.
  * @param direction the direction to rotate to.
  * @return a reference to the result quaternion. */
export function yRotationTo (out :quat, direction :vec3) :quat {
  return quat.setAxisAngle(out, vec3unitY, Math.atan2(direction[0], direction[2]))
}

/** A coroutine that rotates at a fixed angular velocity.
  * @param transform the transform to modify.
  * @param velocity the angular velocity (radians/second). */
export function* spin (transform :Transform, vel :vec3) {
  while (true) {
    // https://gamedev.stackexchange.com/questions/108920/applying-angular-velocity-to-quaternion
    quat.multiply(tmpq, quat.set(tmpq, vel[0], vel[1], vel[2], 0), transform.localRotation)
    const ht = Time.deltaTime * 0.5
    transform.localRotation[0] += ht * tmpq[0]
    transform.localRotation[1] += ht * tmpq[1]
    transform.localRotation[2] += ht * tmpq[2]
    transform.localRotation[3] += ht * tmpq[3]
    quat.normalize(transform.localRotation, transform.localRotation)
    yield
  }
}

/** A coroutine that resizes a transform over time from its current scale to a new one.
  * @param transform the transform to modify.
  * @param rotation the new scale (in local space).
  * @param duration the duration, in seconds, over which to scale.
  * @param [ease=linear] the type of easing to use. */
export function* uniformScaleTo (
  transform :Transform,
  scale :number,
  duration :number,
  ease :Interp = Easing.linear,
) {
  yield* scaleTo(transform, vec3.fromValues(scale, scale, scale), duration, ease)
}

/** A coroutine that resizes a transform over time from its current scale to a new one.
  * @param transform the transform to modify.
  * @param rotation the new scale (in local space).
  * @param duration the duration, in seconds, over which to scale.
  * @param [ease=linear] the type of easing to use. */
export function* scaleTo (
  transform :Transform,
  scale :vec3,
  duration :number,
  ease :Interp = Easing.linear,
) {
  yield* animateTo(transform, "localScale", scale, duration, ease)
}

/** A coroutine that animations a property over time from its current value to a target value.
  * @param object the object to modify.
  * @param name the name of the property to modify.
  * @param value the new value of the property.
  * @param duration the duration, in seconds, over which to animate the property.
  * @param [ease=linear] the type of easing to use in animating. */
export function* animateTo (
  object :PMap<any>,
  name :string,
  value :any,
  duration :number,
  ease :Interp = Easing.linear,
) {
  const startValue = copy(object[name])
  const interpolate = getInterpolateFn(value)
  let elapsed = 0
  do {
    yield
    object[name] = interpolate(startValue, value, ease(elapsed / duration))
  } while ((elapsed += Time.deltaTime) < duration)
  object[name] = value
}

function copy (value :any) {
  if (typeof value === "number") return value
  if (value instanceof Float32Array) {
    // new Float32Array(value) and Float32Array.from(value) fail if value is a proxy
    const copiedValue = new Float32Array(value.length)
    for (let ii = 0; ii < value.length; ii++) copiedValue[ii] = value[ii]
    return copiedValue
  }
  throw new Error(`Don't know how to copy value "${value}"`)
}

const tmpc = Color.create()
const tmpq = quat.create()
const tmpv = vec3.create()

function getInterpolateFn (
  value :any,
) :(start :any, end :any, proportion :number, result? :any) => any {
  if (typeof value === "number") {
    return (start, end, proportion) => start + (end - start) * proportion
  }
  if (value instanceof Color) {
    return (start, end, proportion, result) => Color.lerp(result || tmpc, start, end, proportion)
  }
  if (value instanceof Float32Array) {
    // for the moment, we just assume slerp for four-vector, lerp for three
    switch (value.length) {
      case 4:
        return (start, end, proportion, result) =>
          quat.slerp(result || tmpq, start, end, proportion)
      case 3:
        return (start, end, proportion, result) =>
          vec3.lerp(result || tmpv, start, end, proportion)
    }
  }
  throw new Error(`No interpolation function available for value "${value}"`)
}

/** A coroutine that waits for a number of seconds.
  * @param duration the number of seconds to wait before returning. */
export function* waitForSeconds (duration :number) {
  do yield
  while ((duration -= Time.deltaTime) > 0)
}

/** A coroutine that waits until a condition is satisfied.
  * @param condition the condition to wait for. */
export function* waitUntil (condition :() => boolean) {
  while (!condition()) yield
}

/** A coroutine that waits until a condition is *not* satisfied.
  * @param condition the condition that will stop the waiting. */
export function* waitWhile (condition :() => boolean) {
  while (condition()) yield
}

/** A coroutine that waits for all the coroutines passed as arguments to complete.
  * @param generators the coroutines to wait for. */
export function* waitForAll (...generators :Generator<void>[]) {
  while (true) {
    let allDone = true
    for (const generator of generators) {
      if (!generator.next().done) allDone = false
    }
    if (allDone) return
    yield
  }
}

const IDENTIFIER_PATTERN = /^[a-zA-Z_]\w*$/

const constructorStringifiers = new Map<Function, (value :any, indent :number) => string>([
  [Float32Array, value => `Float32Array.of(${toFloat32ArrayString(value)})`],
  [Uint16Array, value => `Uint16Array.of(${value.join(", ")})`],
  [Uint32Array, value => `Uint32Array.of(${value.join(", ")})`],
  [Color, value => `Color.fromARGB(${toFloat32ArrayString(value)})`],
  [Bounds, value => {
    return `Bounds.create(${JavaScript.stringify(value.min)}, ${JavaScript.stringify(value.max)})`
  }],
  [Object, (value, indent) => {
    let string = (indent === 0) ? "({" : "{"
    const nextIndent = indent + 2
    const nextIndentString = " ".repeat(nextIndent)
    let first = true
    for (const key in value) {
      if (first) {
        string += "\n"
        first = false
      } else string += ",\n"
      string += nextIndentString
      if (IDENTIFIER_PATTERN.test(key)) string += key
      else string += JSON.stringify(key)
      string += ": " + JavaScript.stringify(value[key], nextIndent)
    }
    if (!first) string += "\n" + " ".repeat(indent)
    return string + (indent === 0 ? "})\n" : "}")
  }],
  [Array, (values, indent) => {
    let string = "["
    for (const value of values) {
      if (string.length > 1) string += ", "
      string += JavaScript.stringify(value, indent)
    }
    return string + "]"
  }],
  [Uint8Array, (value, indent) => {
    return `Base64.decode("${Base64.encode(value)}")`
  }]
])

function toFloat32ArrayString (array :Float32Array) :string {
  let value = ""
  for (let ii = 0; ii < array.length; ii++) {
    if (value.length > 0) value += ", "
    value += toFloat32String(array[ii])
  }
  return value
}

const constructorCloners = new Map<Function, (value :any) => any>([
  [Float32Array, value => cloneTypedArray(Float32Array, value)],
  [Color, value => Color.clone(value)],
  [Bounds, value => Bounds.clone(value)],
  [Object, value => {
    const obj :PMap<any> = {}
    for (const key in value) obj[key] = JavaScript.clone(value[key])
    return obj
  }],
  [Array, values => {
    const array :any[] = []
    for (const value of values) array.push(JavaScript.clone(value))
    return array
  }],
  [Uint32Array, value => value],
  [Uint16Array, value => value],
  [Uint8Array, value => value], // treat UintArrays as immutable for performance
])

interface TypedArrayConstructor<T> {
  new (size :number): T
}

function cloneTypedArray (constructor :TypedArrayConstructor<any>, value :any) {
  // we copy "manually" rather than using one of the various typed array functions (slice,
  // TypedArray.from, etc.) because this way works with the proxies we use for transform elements
  const array = new constructor(value.length)
  for (let ii = 0; ii < array.length; ii++) array[ii] = value[ii]
  return array
}

// make sure the types we use are in global scope
const globalObject = (typeof window === "undefined") ? global : window
globalObject["Color"] = Color
globalObject["Bounds"] = Bounds
globalObject["Base64"] = Base64

/** Utility class to assist with converting JS objects to strings and vice-versa; equivalent to
  * the `JSON` class. */
export abstract class JavaScript {

  /** Converts a JavaScript value to a parseable string.
    * @param value the value to stringify.
    * @param [indent=0] the current indentation level.
    * @return the resulting string. */
  static stringify (value :any, indent = 0) :string {
    switch (typeof value) {
      case "undefined":
      case "boolean":
        return String(value)

      case "number":
        return toFloat32String(value)

      case "string":
        return JSON.stringify(value)

      case "object":
        if (value === null) return "null"
        const stringifier = constructorStringifiers.get(value.constructor)
        if (stringifier) return stringifier(value, indent)
        throw new Error(`Don't know how to stringify "${value}" ("${value.constructor}")`)

      default:
        throw new Error(`Don't know how to stringify "${value}" ("${typeof value}")`)
    }
  }

  /** Clones a value of the types supported for parsing and stringification.
    * @param value the value to clone.
    * @return the cloned value. */
  static clone (value :any) :any {
    switch (typeof value) {
      case "undefined":
      case "boolean":
      case "number":
      case "string":
        return value

      case "object":
        if (value === null) return null
        const cloner = constructorCloners.get(value.constructor)
        if (cloner) return cloner(value)
        throw new Error(`Don't know how to clone "${value}" ("${value.constructor}")`)

      default:
        throw new Error(`Don't know how to clone "${value}" ("${typeof value}")`)
    }
  }
}

const CardinalRotations = [
  quatIdentity,
  quat.fromEuler(quat.create(), 0, 90, 0),
  quat.fromEuler(quat.create(), 0, 180, 0),
  quat.fromEuler(quat.create(), 0, 270, 0),
]

function getCardinalRotation (rotation :quat) :number {
  for (let ii = 0; ii < CardinalRotations.length; ii++) {
    if (quat.equals(rotation, CardinalRotations[ii])) return ii
  }
  return -1
}

function getBinaryPrecision (position :vec3) :number {
  for (let ii = 0; ii < 3; ii++) {
    vec3.copy(tmpv, position)
    const factor = 2 ** ii
    vec3.scale(tmpv, tmpv, factor)
    vec3.round(tmpv, tmpv)
    vec3.scale(tmpv, tmpv, 1 / factor)
    if (vec3.equals(tmpv, position)) return ii
  }
  return -1
}

/** A flag indicating that the model can be walked upon. */
export const WALKABLE_FLAG = (1 << 0)

/** A flag indicating that the model should not cast shadows. */
export const NO_CAST_SHADOW_FLAG = (1 << 1)

/** A flag indicating that the model should not receive shadows. */
export const NO_RECEIVE_SHADOW_FLAG = (1 << 2)

/** A flag indicating that the model is not a tile. */
export const NON_TILE_FLAG = (1 << 3)

/** Helper class to encode multiple model URLs/transforms into a compact merged format. */
export class FusedEncoder {
  private readonly _encoder = new Encoder()
  private readonly _urlCodes = new Map<string, number>()
  private _nextCode = 1

  /** Adds an entry to the fused set.
    * @param url the URL of the model.
    * @param bounds the model/tile's (local) bounds.
    * @param position the model's relative position.
    * @param rotation the model's relative rotation.
    * @param scale the model's relative scale.
    * @param flags the model's flags. */
  addTile (
    url :string,
    bounds :Bounds,
    position :vec3,
    rotation :quat,
    scale :vec3,
    flags :number,
  ) {
    const code = this._urlCodes.get(url)
    if (code !== undefined) {
      this._encoder.addVarInt(code)
    } else {
      const code = this._nextCode++
      this._urlCodes.set(url, code)
      this._encoder.addVarInt(code)
      this._encoder.addString(url)
      this._addFloatTriplet(bounds.min)
      this._addFloatTriplet(bounds.max)
    }
    const precision = getBinaryPrecision(position)
    const cardinal = getCardinalRotation(rotation)
    if (precision === -1 || cardinal === -1 || !vec3.equals(scale, vec3one)) {
      this._encoder.addVarSize(flags << 2 | 3)
      this._addFloatTriplet(position)
      this._addFloatTriplet(rotation)
      this._addFloatTriplet(scale)
      return
    }
    this._encoder.addVarSize(flags << 4 | cardinal << 2 | precision)
    const factor = 2 ** precision
    this._encoder.addVarInt(Math.round(position[0] * factor))
    this._encoder.addVarInt(Math.round(position[1] * factor))
    this._encoder.addVarInt(Math.round(position[2] * factor))
  }

  addFusedTiles (source :Uint8Array, position :vec3, rotation :quat, scale :vec3) {
    this._encoder.addVarInt(-source.length)
    for (let ii = 0; ii < source.length; ii++) this._encoder.addSize8(source[ii])
    this._addFloatTriplet(position)
    this._addFloatTriplet(rotation)
    this._addFloatTriplet(scale)
  }

  /** Returns the encoded array of bytes. */
  finish () :Uint8Array {
    return this._encoder.finish()
  }

  private _addFloatTriplet (array :Float32Array) {
    this._encoder.addFloat32(array[0])
    this._encoder.addFloat32(array[1])
    this._encoder.addFloat32(array[2])
  }
}

/** Interface for visitors of fused tile sets. */
interface FusedVisitor {

  /** Visits a single tile.
    * @param url the URL of the tile model.
    * @param bounds the local bounds of the tile.
    * @param position the relative position of the tile.
    * @param rotation the relative rotation of the tile.
    * @param scale the relative scale of the tile.
    * @param flags the flags associated with the tile. */
  visitTile (
    url :string,
    bounds :Bounds,
    position :vec3,
    rotation :quat,
    scale :vec3,
    flags :number,
  ) :void

  /** Visites a fused set of tiles.
    * @param source the source array to decode.
    * @param position the relative position of the tile set.
    * @param rotation the relative rotation of the tile set.
    * @param scale the relative scale of the tile set. */
  visitFusedTiles (source :Uint8Array, position :vec3, rotation :quat, scale :vec3) :void
}

/** Helper function to decode multiple model URLs/transforms from merged format.
  * @param source the encoded fused model set.
  * @param visitor the visitor to receive the contents. */
export function decodeFused (source :Uint8Array, visitor :FusedVisitor) {
  const decoder = new Decoder(source)
  const urlMappings = new Map<number, [string, Bounds]>()
  const position = vec3.create()
  const rotation = quat.create()
  const scale = vec3.create()
  const readTriplet = (out :Float32Array) => {
    out[0] = decoder.getFloat32()
    out[1] = decoder.getFloat32()
    out[2] = decoder.getFloat32()
  }
  while (decoder.pos < source.byteLength) {
    const code = decoder.getVarInt()
    if (code <= 0) {
      const source = new Uint8Array(-code)
      for (let ii = 0; ii < source.length; ii++) source[ii] = decoder.getSize8()
      readTriplet(position)
      readTriplet(rotation)
      quat.calculateW(rotation, rotation)
      readTriplet(scale)
      visitor.visitFusedTiles(source, position, rotation, scale)
      continue
    }
    let mapping = urlMappings.get(code)
    if (mapping === undefined) {
      const newUrl = decoder.getString()
      const newBounds = Bounds.create()
      readTriplet(newBounds.min)
      readTriplet(newBounds.max)
      urlMappings.set(code, mapping = [newUrl, newBounds])
    }
    const [url, bounds] = mapping
    const bits = decoder.getVarSize()
    const precision = bits & 3
    if (precision === 3) {
      const flags = bits >> 2
      readTriplet(position)
      readTriplet(rotation)
      quat.calculateW(rotation, rotation)
      readTriplet(scale)
      visitor.visitTile(url, bounds, position, rotation, scale, flags)
      continue
    }
    const cardinal = (bits >> 2) & 3
    const flags = bits >> 4
    position[0] = decoder.getVarInt()
    position[1] = decoder.getVarInt()
    position[2] = decoder.getVarInt()
    vec3.scale(position, position, 2 ** -precision)
    visitor.visitTile(url, bounds, position, CardinalRotations[cardinal], vec3one, flags)
  }
}

class Occupancy {
  walkableCount = 0
  blockingCount = 0
  unwalkableCount = 0
  lastVisit = 0
  nextOccupancy? :Occupancy

  get walkable () :boolean { return this.walkableCount > 0 && this.unwalkableCount === 0 }
  get blocking () :boolean { return this.blockingCount > 0 }
  get empty () :boolean { return this.walkableCount === 0 && this.unwalkableCount === 0 }

  constructor (readonly x :number, readonly y :number, readonly z :number) {}
}

const tmpm = mat4.create()
const tmpb = Bounds.create()

const MAX_WALKABLE_SEARCH_DISTANCE = 32
const MAX_PATH_LENGTH = 128

/** Tracks occupancy in a 3D grid of fixed-size (0.5, 1.0, 0.5) cells, providing the means to find
  * unoccupied cells and perform pathfinding. */
export class NavGrid {

  /** The bounds of the grid's walkable areas. */
  readonly walkableBounds = Bounds.empty(Bounds.create())

  /** Maps 3D coordinate hashes to occupancy records. */
  private readonly _occupancies = new Map<number, Occupancy>()

  private _changed = new Emitter<void>()
  private _walkableCellCount = 0
  private _floorWalkableCellCounts = new Map<number, number>()
  private _currentVisit = 0

  /** Returns a reference to a stream that fires when the grid is changed. */
  get changed () :Stream<void> { return this._changed }

  /** Returns the total number of walkable cells. */
  get walkableCellCount () { return this._walkableCellCount }

  /** Applies the provided operation to all walkable cells. */
  visitWalkableCells (op :(occupancy :Occupancy) => void) {
    this._visitAllOccupancies(occupancy => {
      if (occupancy.walkable) op(occupancy)
    })
  }

  /** Adds a tile to the grid.
    * @param min the local minima of the tile bounds.
    * @param max the local maxima of the tile bounds.
    * @param matrix the matrix to apply to the bounds.
    * @param walkable whether or not the region is walkable. */
  insertTile (min :vec3, max :vec3, matrix :mat4, walkable :boolean) {
    vec3.copy(tmpb.min, min)
    vec3.copy(tmpb.max, max)
    this._addToCounts(Bounds.transformMat4(tmpb, tmpb, matrix), walkable, 1)
  }

  /** Removes a tile from the grid.
    * @param min the local minima of the tile bounds.
    * @param max the local maxima of the tile bounds.
    * @param matrix the matrix to apply to the bounds.
    * @param walkable whether or not the region was walkable. */
  deleteTile (min :vec3, max :vec3, matrix :mat4, walkable :boolean) {
    vec3.copy(tmpb.min, min)
    vec3.copy(tmpb.max, max)
    this._addToCounts(Bounds.transformMat4(tmpb, tmpb, matrix), walkable, -1)
  }

  /** Adds a set of fused models to the grid.
    * @param source the encoded models.
    * @param matrix the matrix to apply. */
  insertFused (source :Uint8Array, matrix :mat4) {
    this._addFusedToCounts(source, matrix, 1)
  }

  /** Removes a set of fused models from the grid.
    * @param source the encoded models.
    * @param matrix the matrix to apply. */
  deleteFused (source :Uint8Array, matrix :mat4) {
    this._addFusedToCounts(source, matrix, -1)
  }

  /** Adds a single occupant to the grid.
    * @param position the occupant's position. */
  insertOccupant (position :vec3) {
    this._addToCounts(positionToBounds(position), false, 1)
  }

  /** Removes a single occupant from the grid.
    * @param position the occupant's position. */
  deleteOccupant (position :vec3) {
    this._addToCounts(positionToBounds(position), false, -1)
  }

  /** Finds a standable position as close as possible to the position provided.
    * @param origin the position at which to start the search.
    * @return the closest standable position, or undefined if we failed to find one. */
  getStandablePosition (origin :vec3) :vec3|undefined {
    // make sure there are walkable cells on the requested "floor"
    const y = Math.round(origin[1])
    if ((this._floorWalkableCellCounts.get(y) || 0) <= 0) return undefined

    const ox = Math.floor(origin[0] * 2)
    const oz = Math.floor(origin[2] * 2)
    if (this.isCellStandable(ox, y, oz)) return cellToPosition(vec3.fromValues(ox, y, oz))

    const cells :vec3[] = []
    for (let distance = 1; distance <= MAX_WALKABLE_SEARCH_DISTANCE; distance++) {
      const lx = ox - distance, ux = ox + distance
      const lz = oz - distance, uz = oz + distance
      for (let x = lx; x <= ux; x++) {
        if (this.isCellStandable(x, y, lz)) cells.push(vec3.fromValues(x, y, lz))
        if (this.isCellStandable(x, y, uz)) cells.push(vec3.fromValues(x, y, uz))
      }
      for (let z = lz + 1; z < uz; z++) {
        if (this.isCellStandable(lx, y, z)) cells.push(vec3.fromValues(lx, y, z))
        if (this.isCellStandable(ux, y, z)) cells.push(vec3.fromValues(ux, y, z))
      }
      if (cells.length > 0) {
        return cellToPosition(cells[Math.floor(Math.random() * cells.length)])
      }
    }
    return undefined
  }

  isCellStandable (x :number, y :number, z :number) :boolean {
    let occupancy = this._occupancies.get(getCellHash(x, y, z))
    for (; occupancy; occupancy = occupancy.nextOccupancy) {
      if (occupancy.x === x && occupancy.y === y && occupancy.z === z) {
        if (!occupancy.walkable) return false
        // "scan" forward to ensure that nothing is blocking the location
        const lz = Math.floor(this.walkableBounds.min[2] * 2)
        const uz = Math.max(lz + 1, Math.ceil(this.walkableBounds.max[2] * 2))
        for (let bz = z + 1; bz < uz; bz++) {
          if (this._isCellBlocking(x, y, bz)) return false
        }
        return true
      }
    }
    return false
  }

  /** Finds a path from the origin to the destination.
    * @param origin the location at which to start the path.
    * @param destination the location at which to end the path.
    * @return the computed path, or undefined if a path could not be found. */
  getPath (origin :vec3, destination :vec3) :vec3[]|undefined {
    const start = positionToCell(vec3.clone(origin))
    const end = positionToCell(vec3.clone(destination))

    if (start[1] !== end[1]) return undefined

    this._currentVisit++
    this._visitCell(start[0], start[1], start[2])

    interface WorkingPath {
      cell :vec3
      previous? :WorkingPath
      length :number
      estimate :number
    }
    const basePath = {cell: start, length: 0, estimate: vec3.distance(start, end)}
    const fringe :WorkingPath[] = [basePath]

    let bestPath = basePath
    while (fringe.length > 0) {
      bestPath = fringe[0]
      if (vec3.equals(bestPath.cell, end)) {
        const positions = []
        for (let path :WorkingPath|undefined = bestPath; path; path = path.previous) {
          positions.unshift(cellToPosition(path.cell))
        }
        return this._collapsePath(positions)
      }
      if (bestPath.length >= MAX_PATH_LENGTH) {
        log.warn("Reached max path length.", "start", start, "end", end)
        return undefined
      }
      const lastPath = fringe.pop()!
      if (fringe.length > 0) fringe[0] = lastPath

      // filter down the heap
      // https://en.wikipedia.org/wiki/Binary_heap#Extract
      for (let idx = 0;; ) {
        const leftIdx = (idx << 1) + 1
        const rightIdx = leftIdx + 1
        let smallestIdx = idx
        if (leftIdx < fringe.length) {
          if (fringe[leftIdx].estimate < fringe[smallestIdx].estimate) smallestIdx = leftIdx
          if (
            rightIdx < fringe.length &&
            fringe[rightIdx].estimate < fringe[smallestIdx].estimate
          ) {
           smallestIdx = rightIdx
         }
        }
        if (smallestIdx === idx) break
        fringe[idx] = fringe[smallestIdx]
        fringe[smallestIdx] = lastPath
        idx = smallestIdx
      }

      // add neighbors
      for (let ii = 0; ii < 8; ii++) {
        const cell = vec3.clone(bestPath.cell)
        let stepSize = 1
        if (ii & 4) {
          cell[2] += (ii & 2 ? 1 : -1)
          cell[0] += (ii & 1 ? 1 : -1)
          stepSize = Math.SQRT2
        } else {
          const sign = (ii & 1) ? 1 : -1
          if (ii & 2) cell[2] += sign
          else cell[0] += sign
        }
        if (!this._isCellWalkableAndUnvisited(cell[0], cell[1], cell[2])) continue
        this._visitCell(cell[0], cell[1], cell[2])
        const length = bestPath.length + stepSize
        const estimate = length + vec3.distance(cell, end)
        const path = {cell, previous: bestPath, length, estimate}
        fringe.push(path)

        // filter up the heap
        for (let idx = fringe.length - 1; idx; ) {
          const parentIdx = (idx - 1) >> 1
          const parent = fringe[parentIdx]
          if (estimate >= parent.estimate) break
          fringe[idx] = parent
          fringe[parentIdx] = path
          idx = parentIdx
        }
      }
    }
    log.warn("Failed to find a path.", "start", start, "end", end)
    return undefined
  }

  /** Resets the grid state. */
  clear () {
    Bounds.empty(this.walkableBounds)
    this._occupancies.clear()
    this._walkableCellCount = 0
    this._floorWalkableCellCounts.clear()
    this._changed.emit()
  }

  private _collapsePath (path :vec3[]) :vec3[] {
    const collapsed = [path.shift()!]
    startLoop: while (path.length > 0) {
      const start = collapsed[collapsed.length - 1]
      for (let jj = path.length - 1; jj > 0; jj--) {
        const end = path[jj]
        if (this._isSegmentWalkable(start, end)) {
          collapsed.push(end)
          path.splice(0, jj + 1)
          continue startLoop
        }
      }
      collapsed.push(path.shift()!)
    }
    return collapsed
  }

  private _isSegmentWalkable (start :vec3, end :vec3) :boolean {
    const y = Math.round(start[1])

    let px = start[0], pz = start[2]
    let cx = Math.floor(px * 2), cz = Math.floor(pz * 2)
    const dx = end[0] - start[0], dz = end[2] - start[2]
    const ex = Math.floor(end[0] * 2), ez = Math.floor(end[2] * 2)
    while (
      (dx > 0 ? cx < ex : cx > ex) ||
      (dz > 0 ? cz < ez : cz > ez)
    ) {
      let t = Infinity
      let nx = cx, nz = cz
      if (dx > 0) {
        t = ((cx + 1)/2 - px) / dx
        nx++
      } else if (dx < 0) {
        t = (cx/2 - px) / dx
        nx--
      }
      if (dz > 0) {
        const zt = ((cz + 1)/2 - pz) / dz
        if (zt <= t) {
          nz++
          if (zt < t) nx = cx
        }
      } else if (dz < 0) {
        const zt = (cz/2 - pz) / dz
        if (zt <= t) {
          nz--
          if (zt < t) nx = cx
        }
      }
      if (!this._isCellWalkable(nx, y, nz)) return false
      px += t*dx
      pz += t*dz
      cx = nx
      cz = nz
    }
    return true
  }

  private _isCellBlocking (x :number, y :number, z :number) :boolean {
    let occupancy = this._occupancies.get(getCellHash(x, y, z))
    for (; occupancy; occupancy = occupancy.nextOccupancy) {
      if (occupancy.x === x && occupancy.y === y && occupancy.z === z) return occupancy.blocking
    }
    return false
  }

  private _isCellWalkable (x :number, y :number, z :number) :boolean {
    let occupancy = this._occupancies.get(getCellHash(x, y, z))
    for (; occupancy; occupancy = occupancy.nextOccupancy) {
      if (occupancy.x === x && occupancy.y === y && occupancy.z === z) return occupancy.walkable
    }
    return false
  }

  private _isCellWalkableAndUnvisited (x :number, y :number, z :number) :boolean {
    let occupancy = this._occupancies.get(getCellHash(x, y, z))
    for (; occupancy; occupancy = occupancy.nextOccupancy) {
      if (occupancy.x === x && occupancy.y === y && occupancy.z === z) {
        return occupancy.walkable && occupancy.lastVisit !== this._currentVisit
      }
    }
    return false
  }

  private _visitCell (x :number, y :number, z :number) {
    let occupancy = this._occupancies.get(getCellHash(x, y, z))
    for (; occupancy; occupancy = occupancy.nextOccupancy) {
      if (occupancy.x === x && occupancy.y === y && occupancy.z === z) {
        occupancy.lastVisit = this._currentVisit
        return
      }
    }
  }

  private _addFusedToCounts (source :Uint8Array, parentMatrix :mat4, increment :number) {
    decodeFused(source, {
      visitTile: (url, bounds, position, rotation, scale, flags) => {
        if (flags & NON_TILE_FLAG) return
        mat4.fromRotationTranslationScale(tmpm, rotation, position, scale)
        Bounds.transformMat4(tmpb, bounds, mat4.multiply(tmpm, parentMatrix, tmpm))
        this._addToCounts(tmpb, Boolean(flags & WALKABLE_FLAG), increment)
      },
      visitFusedTiles: (source, position, rotation, scale) => {
        const matrix = mat4.fromRotationTranslationScale(mat4.create(), rotation, position, scale)
        this._addFusedToCounts(source, mat4.multiply(matrix, parentMatrix, matrix), increment)
      },
    })
  }

  private _addToCounts (bounds :Bounds, walkable :boolean, increment :number) {
    // add to walkable bounds
    if (walkable) Bounds.union(this.walkableBounds, this.walkableBounds, bounds)

    // if the bounds are higher than one unit, block areas behind
    const blocking = bounds.max[1] - bounds.min[1] > 1

    // adjust the bounds slightly to make sure they don't "spill out" of the cell
    Bounds.expand(bounds, bounds, -0.0001)
    bounds.max[1] = bounds.min[1] // bounds are "flat," for now

    let changed = false
    this._visitOccupancies(
      bounds,
      occupancy => {
        const oldWalkable = occupancy.walkable
        const oldBlocking = occupancy.blocking
        if (walkable) occupancy.walkableCount += increment
        else occupancy.unwalkableCount += increment
        if (occupancy.walkable !== oldWalkable) {
          if (occupancy.walkable) {
            this._walkableCellCount++
            let floorCount = this._floorWalkableCellCounts.get(occupancy.y) || 0
            this._floorWalkableCellCounts.set(occupancy.y, floorCount + 1)
          }
          else {
            this._walkableCellCount--
            let floorCount = this._floorWalkableCellCounts.get(occupancy.y) || 0
            this._floorWalkableCellCounts.set(occupancy.y, floorCount - 1)
          }
          changed = true
        }
        if (blocking) occupancy.blockingCount += increment
        if (occupancy.blocking !== oldBlocking) {
          changed = true
        }
        return occupancy.empty
      },
    )
    if (changed) this._changed.emit()
  }

  private _visitAllOccupancies (op :(occupancy :Occupancy) => boolean|void) {
    for (const [hash, currentOccupancy] of this._occupancies) {
      let occupancy :Occupancy|undefined = currentOccupancy
      let previousOccupancy :Occupancy|undefined
      for (; occupancy; occupancy = occupancy.nextOccupancy) {
        if (op(occupancy)) this._deleteOccupancy(hash, occupancy, previousOccupancy)
        else previousOccupancy = occupancy
      }
    }
  }

  private _visitOccupancies (bounds :Bounds, op :(occupancy :Occupancy) => boolean|void) {
    const lx = Math.floor(bounds.min[0] * 2)
    const ux = Math.max(lx + 1, Math.ceil(bounds.max[0] * 2))
    const ly = Math.floor(bounds.min[1])
    const uy = Math.max(ly + 1, Math.ceil(bounds.max[1]))
    const lz = Math.floor(bounds.min[2] * 2)
    const uz = Math.max(lz + 1, Math.ceil(bounds.max[2] * 2))
    for (let x = lx; x < ux; x++) {
      for (let y = ly; y < uy; y++) {
        for (let z = lz; z < uz; z++) {
          const hash = getCellHash(x, y, z)
          let occupancy = this._occupancies.get(hash)
          let previousOccupancy :Occupancy|undefined
          for (; occupancy; occupancy = occupancy.nextOccupancy) {
            if (occupancy.x === x && occupancy.y === y && occupancy.z === z) {
              if (op(occupancy)) this._deleteOccupancy(hash, occupancy, previousOccupancy)
              break
            }
            previousOccupancy = occupancy
          }
          if (!occupancy) {
            occupancy = new Occupancy(x, y, z)
            if (!op(occupancy)) {
              if (previousOccupancy) previousOccupancy.nextOccupancy = occupancy
              else this._occupancies.set(hash, occupancy)
            }
          }
        }
      }
    }
  }

  private _deleteOccupancy (
    hash :number,
    occupancy :Occupancy,
    previousOccupancy :Occupancy|undefined,
  ) {
    if (previousOccupancy) {
      previousOccupancy.nextOccupancy = occupancy.nextOccupancy
    } else if (occupancy.nextOccupancy) {
      this._occupancies.set(hash, occupancy.nextOccupancy)
    } else {
      this._occupancies.delete(hash)
    }
  }
}

function getCellHash (x :number, y :number, z :number) {
  return 31 * (31 * (217 + x) + y) + z
}

function positionToBounds (position :vec3) :Bounds {
  // get the position of the bottom center of the cell
  vec3.copy(tmpb.min, position)
  cellToPosition(positionToCell(tmpb.min))
  // put the bounds in the center of the cell and give them a small nonzero size
  tmpb.min[1] += 0.5
  vec3.copy(tmpb.max, tmpb.min)
  Bounds.expand(tmpb, tmpb, 0.01)
  return tmpb
}

function positionToCell (position :vec3) :vec3 {
  position[0] = Math.floor(position[0] * 2)
  position[1] = Math.round(position[1])
  position[2] = Math.floor(position[2] * 2)
  return position
}

function cellToPosition (cell :vec3) :vec3 {
  cell[0] = cell[0]/2 + 0.25
  cell[2] = cell[2]/2 + 0.25
  return cell
}
