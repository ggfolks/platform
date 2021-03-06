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

  /** If defined, this specifies an "exclusivity group" for this interaction. All actions except the
    * highest `priority` action(s) in an exclusivity group will be immediately canceled.
    *
    * This can be used if you need to adjudicate exclusivity before the first pointer move event is
    * dispatched. It is also useful for adjudicating between a subset of interactions that should
    * not overlap, while allowing other interactions to proceed. For example two drag interactions
    * can be tagged with `drag` exclusivity, which still allows a third tap interaction to overlap
    * with whichever of the drag interactions that took priority. */
  exclusive? :string

  /** Used in conjunction with `exclusive` to determine which conflicting interaction is used.
    * If not specified, an interaction's priority is `0`. */
  priority? :number

  // allow extra stuff in interaction to allow secret side communication between handlers
  [extra :string] :any
}

/** A helper type for interaction providers which allow pluggable gesture handlers.
  * @param event the event forwarded from the browser.
  * @param pos the position of the event in the provider's coordinate system.
  * @return an interaction to start, or `undefined`. */
export type GestureHandler =
  (event :MouseEvent|TouchEvent, pos :vec2) => PointerInteraction|undefined

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
export interface InteractionProvider {

  /** Controls the order in which interaction providers are notified of events. Providers are
    * notified from highest to lowest z-index. */
  zIndex :number

  /** Translates `x/y`, which are relative to the origin of the browser window, into this provider's
    * coordinate system, written into `pos`.
    * @return whether coordinates are in bounds for this provider. */
  toLocal (x :number, y :number, pos :vec2) :boolean

  /** Checks whether this handler wishes to handle this pointer interaction.
    * @param event the event forwarded from the browser.
    * @param pos the position of the event in the provider's coordinate system.
    * @param iacts append an interaction to this array to start it. */
  handlePointerDown (event :MouseEvent|TouchEvent, pos :vec2, into :PointerInteraction[]) :void

  /** Called when the mouse moves but there are no active interactions as well as immediately after
    * any interactions complete, with the mouse position at the time of completion. A provider
    * should use this to provide hover feedback.
    * @param topHit true if the mouse is in this provider's bounds and it is the highest provider on
    * the stack (i.e. it "owns" the hover). */
  updateMouseHover (event :MouseEvent, pos :vec2, topHit :boolean) :void

  /** Called when the mouse stops hovering over a provider. */
  endMouseHover () :void

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

function handleExclusive (iacts :PointerInteraction[]) :PointerInteraction[] {
  if (iacts.length <= 1) return iacts
  const prios = new Map<string, number>()
  for (const iact of iacts) {
    if (iact.exclusive !== undefined) prios.set(iact.exclusive, iact.priority || 0)
  }
  for (let ii = 0; ii < iacts.length; ii += 1) {
    const iact = iacts[ii]
    if (iact.exclusive === undefined) continue
    const prio = iact.priority || 0, max = prios.get(iact.exclusive) || 0
    if (prio < max) {
      iact.cancel()
      iacts.splice(ii, 1)
      ii -= 1
    }
  }
  return iacts
}

export class InteractionManager {
  private readonly disposer = new Disposer()
  private readonly providers :InteractionProvider[] = []
  private readonly istate :IState[] = []
  private readonly overlayRect = rect.fromValues(0, 0, 0, 0)
  private readonly afterDispatch :Array<() => void> = []
  private dispatching = false
  private activeTouchId :number|undefined = undefined
  private hoveredProviders = new Set<InteractionProvider>()
  private lastHoveredProviders = new Set<InteractionProvider>()

  constructor () {
    this.disposer.add(mouseEvents("mousedown", "mousemove", "mouseup", "mouseleave", "dblclick").
                      onEmit(ev => this.handleMouseEvent(ev)))
    this.disposer.add(touchEvents("touchstart", "touchmove", "touchcancel", "touchend").
                      onEmit(ev => this.handleTouchEvent(ev)))
  }

  addProvider (provider :InteractionProvider) :Remover {
    const providers = this.providers
    if (this.dispatching) {
      this.afterDispatch.push(() => this.addProvider(provider))
    } else {
      let index = 0
      for (let ll = providers.length; index < ll; index += 1) {
        if (provider.zIndex > providers[index].zIndex) break
      }
      providers.splice(index, 0, provider)
    }
    // TODO: we should update mouse hover in case this provider now obscures some other provider
    return () => {
      this.lastHoveredProviders.delete(provider)
      // TODO: ditto re: provider hovering
      if (this.dispatching) this.afterDispatch.push(() => removeListener(providers, provider))
      else removeListener(providers, provider)
    }
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

    case "mouseleave":
      this.clearMouseHover()
      break

    case "dblclick":
      // if the event falls in an area obscured by an overlay element,
      // don't process it and let the browser do its normal processing
      if (!rect.contains(this.overlayRect, vec2.set(pos, mx, my))) {
        this.dispatch(p => {
          if (p.toLocal(mx, my, pos)) {
            if (p.handleDoubleClick(event, pos)) {
              event.cancelBubble = true
              event.preventDefault()
            }
            return true
          }
          return false
        })
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
    return this.dispatch(p => {
      if (!p.toLocal(x, y, pos)) return false
      try {
        p.handlePointerDown(event, pos, niacts)
        if (niacts.length > 0) {
          this.istate[button] = {iacts: handleExclusive(niacts), prov: p}
          return true
        }
      } catch (err) {
        log.warn("Provider choked on pointer down", "prov", p, "pos", pos, err)
      }
      return false
    })
  }

  private handleMove (event :MouseEvent|TouchEvent, x :number, y :number, button :number) :boolean {
    const state = this.istate[button]
    if (!state) return false
    state.prov.toLocal(x, y, pos)
    for (const iact of state.iacts) {
      try {
        if (iact.move(event, pos)) {
          // if any interaction claims the interaction, cancel all the rest
          for (const cc of state.iacts) if (cc !== iact) cc.cancel()
          state.iacts.length = 0
          state.iacts.push(iact)
          break
        }
      } catch (error) {
        log.warn("Interact choked in 'move'", "event", event, "pos", pos, "iact", iact, error)
      }
    }
    return true
  }

  private handleUp (event :MouseEvent|TouchEvent, x :number, y :number, button :number,
                    cancel = false) :boolean {
    const state = this.istate[button]
    if (!state) return false
    state.prov.toLocal(x, y, pos)
    for (const iact of state.iacts) {
      try {
        cancel ? iact.cancel() : iact.release(event, pos)
      } catch (error) {
        const what = cancel ? "cancel" : "release"
        log.warn(`Interaction choked in '${what}'`, "event", event, "pos", pos, "iact", iact, error)
      }
    }
    delete this.istate[button]
    return true
  }

  private updateMouseHover (event :MouseEvent) {
    const {hoveredProviders, lastHoveredProviders} = this
    let sentTopHit = false
    this.dispatch(p => {
      const inBounds = p.toLocal(event.clientX, event.clientY, pos)
      p.updateMouseHover(event, pos, inBounds && !sentTopHit)
      if (inBounds) {
        sentTopHit = true
        hoveredProviders.add(p)
      }
      return false
    })
    for (const provider of lastHoveredProviders) {
      if (!hoveredProviders.has(provider)) provider.endMouseHover()
    }
    lastHoveredProviders.clear()
    this.hoveredProviders = lastHoveredProviders
    this.lastHoveredProviders = hoveredProviders
  }

  private clearMouseHover () {
    for (const provider of this.lastHoveredProviders) provider.endMouseHover()
    this.lastHoveredProviders.clear()
  }

  private dispatch (action :(p :InteractionProvider) => boolean) :boolean {
    this.dispatching = true
    try {
      for (const p of this.providers) if (action(p)) return true
      return false
    }
    finally {
      this.dispatching = false
      if (this.afterDispatch.length > 0) {
        for (const op of this.afterDispatch) op()
        this.afterDispatch.length = 0
      }
    }
  }
}
