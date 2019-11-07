import {Color} from "../core/color"
import {quat, vec3} from "../core/math"
import {Interp, Easing} from "../core/interp"
import {PMap} from "../core/util"
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

function getInterpolateFn (value :any) :(start :any, end :any, proportion :number) => any {
  if (typeof value === "number") {
    return (start, end, proportion) => start + (end - start) * proportion
  }
  if (value instanceof Color) {
    return (start, end, proportion) => Color.lerp(tmpc, start, end, proportion)
  }
  if (value instanceof Float32Array) {
    // for the moment, we just assume slerp for four-vector, lerp for three
    switch (value.length) {
      case 4: return (start, end, proportion) => quat.slerp(tmpq, start, end, proportion)
      case 3: return (start, end, proportion) => vec3.lerp(tmpv, start, end, proportion)
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
  [Float32Array, value => `Float32Array.of(${value.join(", ")})`],
  [Color, value => `Color.fromARGB(${value.join(", ")})`],
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
    return string + (indent === 0 ? "})" : "}")
  }],
])

const constructorCloners = new Map<Function, (value :any) => any>([
  [Float32Array, value => cloneTypedArray(Float32Array, value)],
  [Color, value => Color.clone(value)],
  [Object, value => {
    const obj :PMap<any> = {}
    for (const key in value) obj[key] = JavaScript.clone(value[key])
    return obj
  }],
  [Array, values => {
    const array :any[] = []
    for (const value of values) array.push(JavaScript.clone(value))
    return array
  }]
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
      case "number":
        return String(value)

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

  /** Parses a JavaScript value and returns the result.  Currently this just evaluates the string,
    * but in the future we may want to use a safer method.
    * @param js the JavaScript string to parse.
    * @return the parsed value. */
  static parse (js :string) :any {
    return eval(js)
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
