import {quat, vec3} from "../core/math"
import {EaseFn, easeLinear} from "../core/util"
import {Component, Time, Transform} from "./game"

/** A coroutine that moves a transform over time from its current position to a new one.
  * @param transform the transform to modify.
  * @param position the new position (in world space).
  * @param duration the duration, in seconds, over which to move.
  * @param [easing=easeLinear] the type of easing to use. */
export function* moveTo (
  transform :Transform,
  position :vec3,
  duration :number,
  ease :EaseFn = easeLinear,
) {
  yield* animateTo(transform, "position", position, duration, ease)
}

/** A coroutine that rotates a transform over time from its current orientation to a new one.
  * @param transform the transform to modify.
  * @param rotation the new rotation (in world space).
  * @param duration the duration, in seconds, over which to rotate.
  * @param [ease=easeLinear] the type of easing to use. */
export function* rotateTo (
  transform :Transform,
  rotation :quat,
  duration :number,
  ease :EaseFn = easeLinear,
) {
  yield* animateTo(transform, "rotation", rotation, duration, ease)
}

/** A coroutine that resizes a transform over time from its current scale to a new one.
  * @param transform the transform to modify.
  * @param rotation the new scale (in local space).
  * @param duration the duration, in seconds, over which to scale.
  * @param [ease=easeLinear] the type of easing to use. */
export function* uniformScaleTo (
  transform :Transform,
  scale :number,
  duration :number,
  ease :EaseFn = easeLinear,
) {
  yield* scaleTo(transform, vec3.fromValues(scale, scale, scale), duration, ease)
}

/** A coroutine that resizes a transform over time from its current scale to a new one.
  * @param transform the transform to modify.
  * @param rotation the new scale (in local space).
  * @param duration the duration, in seconds, over which to scale.
  * @param [ease=easeLinear] the type of easing to use. */
export function* scaleTo (
  transform :Transform,
  scale :vec3,
  duration :number,
  ease :EaseFn = easeLinear,
) {
  yield* animateTo(transform, "localScale", scale, duration, ease)
}

/** A coroutine that animations a property over time from its current value to a target value.
  * @param component the component to modify.
  * @param name the name of the property to modify.
  * @param value the new value of the property.
  * @param duration the duration, in seconds, over which to animate the property.
  * @param [ease=easeLinear] the type of easing to use in animating. */
export function* animateTo (
  component :Component,
  name :string,
  value :any,
  duration :number,
  ease :EaseFn = easeLinear,
) {
  const startValue = component[name]
  const interpolate = getInterpolateFn(value)
  let elapsed = 0
  do {
    yield
    component[name] = interpolate(startValue, value, ease(elapsed / duration))
  } while ((elapsed += Time.deltaTime) < duration)
  component[name] = value
}

const tmpq = quat.create()
const tmpv = vec3.create()

function getInterpolateFn (value :any) :(start :any, end :any, proportion :number) => any {
  if (typeof value === "number") {
    return (start, end, proportion) => start + (end - start) * proportion
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
