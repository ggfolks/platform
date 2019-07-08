import {Emitter, Stream} from "./react"

/** Timing information for an animated system. */
export interface Clock {
  /** A millisecond timestamp, obtained from [[renderAnimationFrame]]. */
  time :number
  /** The number of milliseconds that have elapsed since the loop was first started.
    * This does not advance when the loop is paused. */
  elapsed :number
  /** The number of milliseconds that have elapsed since the last frame.
    * Will be `0` on the first frame after starting and the first frame after unpausing. */
  dt :number
}

/** Handles the top-level render loop. */
export class Loop {
  private running = false
  private stamp = {time: 0, elapsed: 0, dt: 0}
  private wasRunning = false
  private onFrame = (time :number) => {
    const {stamp, wasRunning} = this
    const dt = wasRunning ? time-this.stamp.time : 0
    stamp.time = time
    stamp.elapsed += dt
    stamp.dt = dt
    const clock = this.clock as Emitter<Clock>
    clock.emit(this.stamp)
    if (!wasRunning) this.wasRunning = true
    if (this.running) requestAnimationFrame(this.onFrame)
  }

  /** Emits a `clock` on every frame, while this loop is running. */
  clock :Stream<Clock> = new Emitter<Clock>()

  /** Whether or not this loop is running. */
  get active () :boolean { return this.running }

  /** Starts this render loop. */
  start () {
    if (this.running) console.warn(`Can't start already running loop.`)
    else {
      this.running = true
      this.wasRunning = false
      requestAnimationFrame(this.onFrame)
    }
  }

  /** Stops this render loop. */
  stop () {
    if (!this.running) console.warn(`Can't stop non-running loop.`)
    else this.running = false
  }
}
