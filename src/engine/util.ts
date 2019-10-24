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
