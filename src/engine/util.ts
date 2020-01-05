import {Base64} from "../core/basex"
import {Decoder, Encoder} from "../core/codec"
import {Color} from "../core/color"
import {Bounds, quat, quatIdentity, vec3, vec3one, vec3unitY} from "../core/math"
import {Interp, Easing} from "../core/interp"
import {PMap, toFloat32String} from "../core/util"
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

/** A coroutine that moves a transform over time from its current position to a new one, passing
  * near an intermediate position.
  * @param transform the transform to modify.
  * @param middle the middle position (in local space).
  * @param end the end position (in local space).
  * @param radius the (maximum) radius of curvature.
  * @param speed the speed, in units per second, at which to move. */
export function* curveTo (
  transform :Transform,
  middle :vec3,
  end :vec3,
  radius :number,
  speed :number,
) {
  const start = transform.localPosition
  const middleStart = vec3.subtract(vec3.create(), start, middle)
  const middleStartLength = vec3.length(middleStart)
  const middleEnd = vec3.subtract(vec3.create(), end, middle)
  const middleEndLength = vec3.length(middleEnd)
  const cornerAngle = vec3.angle(middleStart, middleEnd)
  if (cornerAngle === 0 || cornerAngle === Math.PI) {
    // no bend, no curve
    yield* moveTo(transform, end, (middleStartLength + middleEndLength) / speed)
    return
  }
  const tanHalfAngle = Math.tan(cornerAngle / 2)
  const curveDistance = Math.min(radius / tanHalfAngle, middleStartLength, middleEndLength)
  const curveStart = vec3.scaleAndAdd(
    vec3.create(),
    middle,
    middleStart,
    curveDistance / middleStartLength,
  )
  yield* moveTo(transform, curveStart, (middleStartLength - curveDistance) / speed)
  radius = curveDistance * tanHalfAngle
  const angle = Math.PI - cornerAngle
  const duration = angle * radius / speed
  const rotation = yRotationTo(quat.create(), middleEnd)
  const crossProduct = vec3.cross(vec3.create(), middleEnd, middleStart)
  yield* waitForAll(
    arcTo(transform, radius, angle * Math.sign(crossProduct[1]), duration),
    rotateTo(transform, rotation, duration),
  )
  yield* moveTo(transform, end, (middleEndLength - curveDistance) / speed)
}

/** Moves the local position of the transform in an arc.
  * @param transform the transform to modify.
  * @param radius the radius of curvature.
  * @param angle the angle to move, in radians (positive for CCW).
  * @param duration the duration over which to move.
  * @param [ease=linear] the type of easing to use. */
export function* arcTo (
  transform :Transform,
  radius :number,
  angle :number,
  duration :number,
  ease :Interp = Easing.linear,
) {
  const start = vec3.clone(transform.localPosition)
  const center = vec3.scaleAndAdd(
    vec3.create(),
    start,
    transform.right,
    angle > 0 ? radius : -radius,
  )
  let elapsed = 0
  do {
    yield
    vec3.rotateY(transform.localPosition, start, center, angle * ease(elapsed / duration))
  } while ((elapsed += Time.deltaTime) < duration)
  vec3.rotateY(transform.localPosition, start, center, angle)
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

/** A coroutine that animations a property over time from its current value to a target value,
  * approaching an intermediate value along the way.
  * @param object the object to modify.
  * @param name the name of the property to modify.
  * @param middleValue the intermediate value of the property.
  * @param endValue the new value of the property.
  * @param duration the duration, in seconds, over which to animate the property.
  * @param [ease=linear] the type of easing to use in animating. */
export function* animateThrough (
  object :PMap<any>,
  name :string,
  middleValue :any,
  endValue :any,
  duration :number,
  ease :Interp = Easing.linear,
) {
  const value = object[name]
  const startValue = copy(value)
  const firstValue = copy(value)
  const secondValue = copy(value)
  const interpolate = getInterpolateFn(value)
  let elapsed = 0
  do {
    yield
    const t = ease(elapsed / duration)
    // https://en.wikipedia.org/wiki/De_Casteljau%27s_algorithm#B%C3%A9zier_curve
    interpolate(startValue, middleValue, t, firstValue)
    interpolate(middleValue, endValue, t, secondValue)
    object[name] = interpolate(firstValue, secondValue, t)
  } while ((elapsed += Time.deltaTime) < duration)
  object[name] = endValue
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

interface Occupancy {
  x :number
  y :number
  z :number
  walkable :number
  nextOccupancy? :Occupancy
}

/** Tracks occupancy in a 3D grid of fixed-size (0.5, 1.0, 0.5) cells, providing the means to find
  * unoccupied cells and perform pathfinding. */
export class NavGrid {

  /** Maps 3D coordinate hashes to occupancy records. */
  private readonly _occupancies = new Map<number, Occupancy>()

  insert (bounds :Bounds, walkable :boolean) {
    this._addToWalkable(bounds, walkable ? 1 : -1)
  }

  delete (bounds :Bounds, walkable :boolean) {
    this._addToWalkable(bounds, walkable ? -1 : 1)
  }

  private _addToWalkable (bounds :Bounds, increment :number) {
    this._visitOccupancies(bounds, occupancy => (occupancy.walkable += increment) === 0, true)
  }

  private _visitOccupancies (
    bounds :Bounds|undefined,
    op :(occupancy :Occupancy) => boolean|void,
    create = false,
    requireWalkable = false,
  ) :boolean {
    if (!bounds) {
      for (const [hash, currentOccupancy] of this._occupancies) {
        let occupancy :Occupancy|undefined = currentOccupancy
        let previousOccupancy :Occupancy|undefined
        for (; occupancy; occupancy = occupancy.nextOccupancy) {
          if (requireWalkable && occupancy.walkable <= 0) return false
          if (op(occupancy)) this._deleteOccupancy(hash, occupancy, previousOccupancy)
          else previousOccupancy = occupancy
        }
      }
      return true
    }
    const lx = Math.floor(bounds.min[0] * 2)
    const ux = Math.max(lx + 1, Math.ceil(bounds.max[0] * 2))
    const ly = Math.floor(bounds.min[1])
    const uy = Math.max(ly + 1, Math.ceil(bounds.max[1]))
    const lz = Math.floor(bounds.min[2] * 2)
    const uz = Math.max(lz + 1, Math.ceil(bounds.max[2] * 2))
    for (let x = lx; x < ux; x++) {
      for (let y = ly; y < uy; y++) {
        for (let z = lz; z < uz; z++) {
          const hash = 31 * (31 * (217 + x) + y) + z
          let occupancy = this._occupancies.get(hash)
          let previousOccupancy :Occupancy|undefined
          for (; occupancy; occupancy = occupancy.nextOccupancy) {
            if (occupancy.x === x && occupancy.y === y && occupancy.z === z) {
              if (requireWalkable && occupancy.walkable <= 0) return false
              if (op(occupancy)) this._deleteOccupancy(hash, occupancy, previousOccupancy)
              break
            }
            previousOccupancy = occupancy
          }
          if (!occupancy) {
            if (requireWalkable) return false
            if (create) {
              occupancy = {x, y, z, walkable: 0}
              if (!op(occupancy)) {
                if (previousOccupancy) previousOccupancy.nextOccupancy = occupancy
                else this._occupancies.set(hash, occupancy)
              }
            }
          }
        }
      }
    }
    return true
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
