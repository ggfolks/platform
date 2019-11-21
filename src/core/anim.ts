import {Prop, Remover} from "./util"
import {Interp, interpRange} from "./interp"
import {vec2} from "./math"
import {Emitter, Mutable, Stream, Value, addListener} from "./react"

/** An animation is simply a function that takes a delta time and returns how much time remains
  * until the animation is finished. When the animation returns 0 or less than 0, it is considered
  * complete and is removed by the animator. */
export type Animation = (dt :number) => number

/** Helper methods for creating common animations. */
export class Anim {

  /** Returns an animation that delays `time` seconds. */
  static delay (time :number) :Animation {
    let elapsed = 0
    return dt => {
      elapsed += dt
      return time - elapsed
    }
  }

  /** Returns an animation that invokes `op`. */
  static action (op :() => any) :Animation {
    return dt => {
      op()
      return -dt
    }
  }

  /** Returns an animation that invokes `op` after `time` seconds. */
  static delayedAction (time :number, op :() => any) :Animation {
    return Anim.serial(Anim.delay(time), Anim.action(op))
  }

  /** Returns an animation that runs `anims` in parallel. When all of the animations are finished
    * the aggregate animation reports itself as finished. */
  static parallel (...anims :Animation[]) :Animation {
    let done = anims.map(_ => false)
    return dt => {
      let remain = -dt
      for (let ii = 0, ll = anims.length; ii < ll; ii += 1) {
        if (done[ii]) continue
        let aremain = anims[ii](dt)
        if (aremain <= 0) done[ii] = true
        remain = Math.max(aremain, remain)
      }
      return remain
    }
  }

  /** Returns an animation that runs `anims` in series. When the last animation is finished, the
    * aggregate animation reports itself as finished. */
  static serial (...anims :Animation[]) :Animation {
    let curidx = 0
    return dt => {
      let remain = anims[curidx](dt)
      while (remain <= 0) {
        curidx += 1
        // apply the leftover delta to the next animation
        if (curidx < anims.length) remain = anims[curidx](dt+remain)
        else break
      }
      return remain
    }
  }

  /** Animates `prop` over `time` seconds with the output of `interp`. */
  static animProp (prop :Prop<number>, time :number, interp :Interp) :Animation {
    let elapsed = 0
    return dt => {
      elapsed = Math.min(elapsed + dt, time)
      prop.update(interp(elapsed/time))
      return time - elapsed
    }
  }

  /** Animates `prop` over `time` seconds with the output of `interp0` and `interp1`. */
  static animV2Prop (prop :Prop<vec2>, time :number, interp0 :Interp, interp1 :Interp) :Animation {
    let elapsed = 0
    const cur = vec2.create()
    return dt => {
      elapsed += dt
      const t = Math.min(elapsed, time)/time
      cur[0] = interp0(t)
      cur[1] = interp1(t)
      prop.update(cur)
      return time - elapsed
    }
  }

  /** Returns an animation that tweens `prop` from its current value to `end` over `time` seconds,
    * using `interp` to interpolate over the time period. */
  static tweenPropTo (prop :Prop<number>, end :number, time :number, interp :Interp) :Animation {
    return Anim.tweenProp(prop, prop.current, end, time, interp)
  }

  /** Returns an animation that tweens `prop` from `start` to `end` over `time` seconds, using
    * `interp` to interpolate over the time period. */
  static tweenProp (
    prop :Prop<number>, start :number, end :number, time :number, interp :Interp
  ) :Animation {
    const range = end-start
    let elapsed = 0
    return dt => {
      elapsed += dt
      prop.update(interpRange(interp, start, range, Math.min(elapsed, time), time))
      return time - elapsed
    }
  }

  /** Returns an animation that tweens `prop` from its current value to `end` over `time` seconds,
    * using `interp` to interpolate over the time period. */
  static tweenV2PropTo (prop :Prop<vec2>, end :vec2, time :number, interp :Interp) :Animation {
    return Anim.tweenV2Prop(prop, prop.current, end, time, interp)
  }

  /** Returns an animation that tweens `prop` from `start` to `end` over `time` seconds, using
    * `interp` to interpolate over the time period. */
  static tweenV2Prop (
    prop :Prop<vec2>, start :vec2, end :vec2, time :number, interp :Interp
  ) :Animation {
    const startX = start[0], rangeX = end[0]-startX, startY = start[1], rangeY = end[1]-startY
    let elapsed = 0, cur = vec2.create()
    return dt => {
      elapsed += dt
      const current = Math.min(elapsed, time)
      cur[0] = interpRange(interp, startX, rangeX, current, time)
      cur[1] = interpRange(interp, startY, rangeY, current, time)
      prop.update(cur)
      return time - elapsed
    }
  }
}

export class Animator {
  private active :Animation[] = []

  readonly anims :Value<number> = Mutable.local(0)
  readonly clear :Stream<Animator> = new Emitter()

  // TODO: batches or phases or barriers or something
  add (anim :Animation) :Remover {
    return addListener(this.active, anim)
  }

  update (dt :number) {
    const anims = this.active
    const count = anims.length
    if (count > 0) {
      // TODO: handle removals in the middle of update()
      for (let ii = 0, ll = count; ii < ll; ii += 1) {
        const anim = anims[ii]
        if (anim(dt) <= 0) {
          anims.splice(ii, 1)
          ii -= 1
          ll -= 1
        }
      }
      (this.anims as Mutable<number>).update(anims.length)
      if (anims.length === 0) (this.clear as Emitter<Animator>).emit(this)
    }
  }
}
