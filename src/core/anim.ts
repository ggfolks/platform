import {Prop, Remover, addListener} from "./util"
import {Interp, interpRange} from "./interp"
import {vec2} from "./math"
import {Emitter, Mutable, Stream, Value} from "./react"

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
        if (curidx < anims.length) remain = anims[curidx](-remain)
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
  private readonly batches :Animation[][] = []
  private active :Animation[] = []
  private nextBatchId = 1
  private currentBatchId = 0

  /** The current number of animations running. */
  readonly anims :Value<number> = Mutable.local(0)

  /** Emits an event when the animator transitions from >0 running animations to 0. */
  readonly clear :Stream<Animator> = new Emitter()

  /** Emits an event when a particular animation batch is finished. */
  readonly finished :Stream<number> = new Emitter()

  /** Adds an animation to be played either immediately if there is no active batch, or when the
    * currently accumulating batch is started.
    * @return a thunk that can be invoked to cancel the animation and remove it from the animator
    * (whether or not it has already started). */
  add (anim :Animation) :Remover {
    const batch = this.batches.length > 0 ? this.batches[0] : this.active
    return addListener(batch, anim)
  }

  /** Starts accumulating new animations to a postponed batch. The batch will not start until all
    * currently executing animations are completed and any previously accumulated batches are also
    * run to completion.
    * @return an id for the batch which will be emitted by `finished` when all the animations in
    * this batch have completed (or been canceled). */
  addBarrier () :number {
    const batches = this.batches
    if (batches.length > 0 && batches[batches.length-1].length === 0) return this.nextBatchId-1
    batches.push([])
    return this.nextBatchId++
  }

  /** Updates the animator every frame. This must be called to drive the animation process. */
  update (dt :number) {
    const anims = this.active, batches = this.batches
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
      if (anims.length > 0) return
      else (this.finished as Emitter<number>).emit(this.currentBatchId)
    }
    if (batches.length === 0) (this.clear as Emitter<Animator>).emit(this)
    else {
      this.active = batches.shift()!
      this.currentBatchId += 1
    }
  }
}
