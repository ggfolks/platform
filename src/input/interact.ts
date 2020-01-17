import {Disposer, Remover, log, removeListener} from "../core/util"
import {vec2, rect} from "../core/math"
import {mouseEvents, touchEvents} from "./react"

/** Encapsulates a mouse or touch interaction. An interaction is started when a mouse or touch down
  * event is dispatched to an interaction provider. Multiple interactions may be started by the same
  * press/touch and based on subsequent input one of the interactions can claim primacy and the
  * other interactions will be canceled. */
export type PointerInteraction = {
  /** Called when the pointer is moved while this interaction is active.
    * @return true if this interaction has accumulated enough input to know that it should be
    * granted exclusive control. */
  move: (moveEvent :MouseEvent|TouchEvent, pos :vec2) => boolean
  /** Called when the pointer is released while this interaction is active.
    * This ends the interaction. */
  release: (upEvent :MouseEvent|TouchEvent, pos :vec2) => void
  /** Called if this action is canceled. This ends the interaction. */
  cancel: () => void

  // allow extra stuff in interaction to allow secret side communication between handlers
  [extra :string] :any
}

/** Allows arbitrary code to participate in mouse/touch input handling. At the top-level this is
  * performed by `InteractionProvider` instances, but an interaction provider may allow the
  * registration of gesture handlers that all operate in its coordinate system, so this interface
  * simplifies that process. */
export interface GestureHandler {

  /** Checks whether this handler wishes to handle this pointer interaction.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event relative to the root origin.
    * @return an interaction to be started or `undefined`. */
  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) :void
}

/** Allows an application component to participate in coordinated user input interactions. Certain
  * input events (mouse and touch down) begin "pointer interactions" which then hear about
  * subsequent mouse or touch move events.
  *
  * At any point one of the pointer interactions can "claim" the interaction and the remaining
  * interactions will be canceled. For example a scroll interaction and a button interaction could
  * both start as a result of a touch down, but once the touch has moved beyond a certain threshold,
  * the scroll handler can claim the interaction which cancels the button interaction.
  *
  * Interactions are only started for events that are "in bounds" for a given provider. The
  * `toLocal` method is used to determine whether the event is in bounds as well as to translate
  * positions from browser window coordinates into the provider's coordinates (to simplify life for
  * the pointer interaction implementations). */
export interface InteractionProvider extends GestureHandler {

  /** Controls the order in which interaction providers are notified of events. Providers are
    * notified from highest to lowest z-index. */
  zIndex :number

  /** Translates `x/y`, which are relative to the origin of the browser window, into this provider's
    * coordinate system, written into `pos`.
    * @return whether coordinates are in bounds for this provider. */
  toLocal (x :number, y :number, pos :vec2) :boolean

  /** Called when the mouse moves but there are no active interactions as well as immediately after
    * any interactions complete, with the mouse position at the time of completion. A provider
    * should use this to provide hover feedback. */
  updateMouseHover (event :MouseEvent, pos :vec2) :void

  /** Called when a double click is performed in this provider's bounds.
    * @return true if the provider handled the click, false otherwise. */
  handleDoubleClick (event :MouseEvent, pos :vec2) :boolean
}

let currentEditNumber = 0

/** Returns the current value of the edit number, which is simply a number that we increment after
  * certain input events (mouse up, key up) to determine which edits should be merged. */
export function getCurrentEditNumber () {
  return currentEditNumber
}

/** Increments the current edit number, for use by components that handle events specially but want
  * to influence edit merge behavior. */
export function incrementEditNumber () {
  currentEditNumber += 1
}

const pos = vec2.create()

type IState = {iacts :PointerInteraction[], prov :InteractionProvider}

export class InteractionManager {
  private readonly disposer = new Disposer()
  private readonly providers :InteractionProvider[] = []
  private readonly istate :IState[] = []
  private readonly overlayRect = rect.fromValues(0, 0, 0, 0)
  private activeTouchId :number|undefined = undefined

  constructor () {
    this.disposer.add(mouseEvents("mousedown", "mousemove", "mouseup", "dblclick").
                      onEmit(ev => this.handleMouseEvent(ev)))
    this.disposer.add(touchEvents("touchstart", "touchmove", "touchcancel", "touchend").
                      onEmit(ev => this.handleTouchEvent(ev)))
  }

  addProvider (provider :InteractionProvider) :Remover {
    const providers = this.providers
    let index = 0
    for (let ll = providers.length; index < ll; index += 1) {
      if (provider.zIndex > providers[index].zIndex) break
    }
    providers.splice(index, 0, provider)
    return () => removeListener(providers, provider)
  }

  get hasInteractions () :boolean {
    for (const state of this.istate) if (state) return true
    return false
  }

  setOverlayRect (bounds :rect) { rect.copy(this.overlayRect, bounds) }
  clearOverlayRect () { rect.set(this.overlayRect, 0, 0, 0, 0) }

  shutdown () {
    this.disposer.dispose()
  }

  private handleMouseEvent (event :MouseEvent) {
    const button = event.button, mx = event.clientX, my = event.clientY
    switch (event.type) {
    case "mousedown":
      if (this.handleDown(event, mx, my, button)) {
        event.cancelBubble = true
        event.preventDefault()
      }
      break

    case "mousemove":
      if (this.handleMove(event, mx, my, button)) event.preventDefault()
      else this.updateMouseHover(event)
      break

    case "mouseup":
      if (this.handleUp(event, mx, my, button)) {
        event.preventDefault()
        this.updateMouseHover(event)
        currentEditNumber += 1
      }
      break

    case "dblclick":
      // if the event falls in an area obscured by an overlay element,
      // don't process it and let the browser do its normal processing
      if (!rect.contains(this.overlayRect, vec2.set(pos, mx, my))) {
        for (const prov of this.providers) {
          if (prov.toLocal(mx, my, pos)) {
            if (prov.handleDoubleClick(event, pos)) {
              event.cancelBubble = true
              event.preventDefault()
            }
            break
          }
        }
      }
    }
  }

  private handleTouchEvent (event :TouchEvent) {
    if (event.type === "touchstart") {
      if (this.activeTouchId === undefined && event.changedTouches.length === 1) {
        this.handleTouch(event, event.changedTouches[0])
      }
    } else {
      for (let ii = 0, ll = event.changedTouches.length; ii < ll; ii += 1) {
        const touch = event.changedTouches[ii]
        if (touch.identifier === this.activeTouchId) {
          this.handleTouch(event, touch)
          break
        }
      }
    }
  }

  private handleTouch (event :TouchEvent, touch :Touch) {
    const tx = touch.clientX, ty = touch.clientY
    switch (event.type) {
    case "touchstart":
      if (this.handleDown(event, tx, ty, 0)) {
        event.cancelBubble = true
        event.preventDefault()
        this.activeTouchId = touch.identifier
      }
      break

    case "touchmove":
      if (this.handleMove(event, tx, ty, 0)) event.preventDefault()
      break

    case "touchend":
    case "touchcancel":
      const canceled = event.type === "touchcancel"
      if (this.handleUp(event, tx, ty, 0, canceled)) {
        this.activeTouchId = undefined
        event.preventDefault()
        if (!canceled) currentEditNumber += 1
      }
      break
    }
  }

  private handleDown (event :MouseEvent|TouchEvent, x :number, y :number, button :number) :boolean {
    const ostate = this.istate[button]
    if (ostate) {
      log.warn("Starting new interaction but have old?", "event", event.type, "old", ostate.iacts)
      for (const iact of ostate.iacts) iact.cancel()
    }

    // if the down event falls in an area obscured by an overlay element,
    // don't process it and let the browser do its normal processing
    if (rect.contains(this.overlayRect, vec2.set(pos, x, y))) return false

    const niacts :PointerInteraction[] = []
    for (const p of this.providers) {
      if (!p.toLocal(x, y, pos)) continue
      p.handlePointerDown(event, pos, niacts)
      if (niacts.length === 0) continue
      this.istate[button] = {iacts: niacts, prov: p}
      return true
    }
    return false
  }

  private handleMove (event :MouseEvent|TouchEvent, x :number, y :number, button :number) :boolean {
    const state = this.istate[button]
    if (!state) return false
    state.prov.toLocal(x, y, pos)
    for (const iact of state.iacts) {
      if (iact.move(event, pos)) {
        // if any interaction claims the interaction, cancel all the rest
        for (const cc of state.iacts) if (cc !== iact) cc.cancel()
        state.iacts.length = 0
        state.iacts.push(iact)
        break
      }
    }
    return true
  }

  private handleUp (event :MouseEvent|TouchEvent, x :number, y :number, button :number,
                    cancel = false) :boolean {
    const state = this.istate[button]
    if (!state) return false
    state.prov.toLocal(x, y, pos)
    for (const iact of state.iacts) cancel ? iact.cancel() : iact.release(event, pos)
    delete this.istate[button]
    return true
  }

  private updateMouseHover (event :MouseEvent) {
    for (const p of this.providers) {
      p.toLocal(event.clientX, event.clientY, pos)
      p.updateMouseHover(event, pos)
    }
  }
}
