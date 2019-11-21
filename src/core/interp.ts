/** An interpolation function. This maps a value from [0, 1] to a value (mostly) from [0, 1] based
  * on some interpolation function. Input values outside the range [0, 1] are generally handled in
  * the same way as values inside the range and the mapped value may range outside [0, 1] for
  * interpolation functions that are "juicy". */
export type Interp = (v :number) => number

const zero :Interp = v => 0
const linear :Interp = v => v
const smoothstep :Interp = v => v*v * (3 - 2*v)

const quadIn :Interp = v => v*v
const quadOut :Interp = v => 1-quadIn(1-v)
const quadInOut :Interp = v => (v < 0.5) ? quadIn(v*2)/2 : 1-quadIn((1-v)*2)/2

const cubicIn :Interp = v => v*v*v
const cubicOut :Interp = v => 1-cubicIn(1-v)
const cubicInOut :Interp = v => (v < 0.5) ? cubicIn(v*2)/2 : 1-cubicIn((1-v)*2)/2

const sineIn :Interp = v => 1 -Math.cos(v * Math.PI/2)
const sineOut :Interp = v => Math.sin(v * Math.PI/2)
const sineInOut :Interp = v => -0.5 * (Math.cos(Math.PI*v) - 1)

const expoIn :Interp = v => v > 0 ? Math.pow(2, 10*(v-1)) : 0
const expoOut :Interp = v => v < 1 ? 1-Math.pow(2, -10*v) : 1
const expoInOut :Interp = v => v <= 0   ? 0 :
  v <  0.5 ? Math.pow(2, 10*(2*v-1))/2 :
  v <  1   ? (2-Math.pow(2, -10*2*(v-0.5)))/2 :
  1

const circIn :Interp = v => -(Math.sqrt(1-v*v)-1)
const circOut :Interp = v => 1-circIn(1-v)
const circInOut :Interp = v => (v < 0.5) ? circIn(v*2)/2 : 1-circIn((1-v)*2)/2

const C = 1.70158

const backIn :Interp = v => v * v * ((C + 1) * v - C)
const backOut :Interp = v => 1-backIn(1-v)
const backInOut :Interp = v => {
  const s = C * 1.525, dv = v*2
  if (dv < 1) return (dv*dv * ((s + 1) * dv - s))/2
  const idv = dv-2
  return (idv * idv * ((s + 1) * idv + s) + 2)/2
}

const TAU = 2 * Math.PI

export function elasticIn (a :number = 1, p :number = 0.4) :Interp {
  const pot = p/TAU, ca = Math.max(1, a), s = Math.asin(1 / ca) * pot
  return v => ca * Math.pow(2, 10 * (v-1)) * Math.sin((s-v-1) / pot)
}

export function elasticOut (a :number = 1, p :number = 0.4) :Interp {
  const pot = p/TAU, ca = Math.max(1, a), s = Math.asin(1 / ca) * pot
  return v => 1 - ca * Math.pow(2, -10 * v) * Math.sin((v+s) / pot)
}

export function elasticInOut (a :number = 1, p :number = 0.4) :Interp {
  const pot = p/TAU, ca = Math.max(1, a), s = Math.asin(1 / ca) * pot
  return v => ((v = v*2 - 1) < 0 ?
               ca * Math.pow(2, 10 * v) * Math.sin((s-v) / pot) :
               2 - ca * Math.pow(2, -10 * v) * Math.sin((s+v) / pot)) / 2
}

const b1 =  4/11, b2 =  6/11, b3 =  8/11, b4 =   3/4, b5 = 9/11
const b6 = 10/11, b7 = 15/16, b8 = 21/22, b9 = 63/64, b0 = 1/b1/b1

const bounceIn :Interp = v => 1-bounceOut(1-v)
const bounceOut :Interp = t => (t = +t) < b1 ? b0 * t * t :
  t < b3 ? b0 * (t -= b2) * t + b4 :
  t < b6 ? b0 * (t -= b5) * t + b7 :
           b0 * (t -= b8) * t + b9
const bounceInOut :Interp = t => ((t *= 2) <= 1 ? 1-bounceOut(1-t) : 1+bounceOut(t-1)) / 2

/** A collection of different interpolation/easing functions. */
export const Easing = {
  zero, linear, smoothstep,
  quadIn, quadOut, quadInOut,
  cubicIn, cubicOut, cubicInOut,
  sineIn, sineOut, sineInOut,
  expoIn, expoOut, expoInOut,
  circIn, circOut, circInOut,
  backIn, backOut, backInOut,
  elasticIn: elasticIn(), elasticOut: elasticOut(), elasticInOut: elasticInOut(),
  bounceIn, bounceOut, bounceInOut,
}

/** Maps elapsed time over duration roughly to `[0, 1]` using `interp`.
  * @param dt the amount of time that has elapsed.
  * @param t the total amount of time for the interpolation. If `t == 0`, the result is `NaN`. */
export const interpTime = (interp :Interp, dt :number, t :number) :number => interp(dt/t)

/** Interpolates between `start` and `start+range` based on `interp` and a supplied elapsed time.
  * @param start the starting value.
  * @param range the difference between the ending value and the starting value.
  * @param dt the amount of time that has elapsed.
  * @param t the total time for the interpolation. If `t == 0`, `start+range` is returned. */
export const interpRange = (interp :Interp, start :number, range :number, dt :number, t :number) =>
  start + range * ((t == 0) ? 1 : interp(dt/t))

/** Returns an interpolator that "shakes" a value around `start`, going `cycles` times through a
  * sine of `amp`. */
export function shake (start :number, amp :number, cycles :number) :Interp {
  const scale = Math.PI*2*cycles
  return (t) => start+Math.sin(scale*t)*amp
}
