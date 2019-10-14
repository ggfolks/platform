import {Stream} from "../core/react"

type FilterFlags<Base, Condition> = {
  [Key in keyof Base] :Base[Key] extends Condition ? Key : never
}
type AllowedNames<Base, Condition> = FilterFlags<Base, Condition>[keyof Base]
type MouseEventTypes = AllowedNames<GlobalEventHandlersEventMap, MouseEvent>
type TouchEventTypes = AllowedNames<GlobalEventHandlersEventMap, TouchEvent>
type PointerEventTypes = AllowedNames<GlobalEventHandlersEventMap, PointerEvent>
type KeyboardEventTypes = AllowedNames<GlobalEventHandlersEventMap, KeyboardEvent>

/** Returns the specified mouse events on `elem` as a reactive stream. While the stream has
  * listeners, event listeners will be connected to the underlying HTML `elem`. */
export function mouseEvents (elem :HTMLElement, ...types :MouseEventTypes[]) :Stream<MouseEvent> {
  return Stream.deriveStream(dispatch => {
    // listen for mouseup on document so that we hear it even if the mouse goes up outside the
    // bounds of the target element
    for (const type of types) {
      if (type === "mouseup") document.addEventListener(type, dispatch)
      else elem.addEventListener(type, dispatch)
    }
    return () => {
      for (const type of types) {
        if (type === "mouseup") document.removeEventListener(type, dispatch)
        else elem.removeEventListener(type, dispatch)
      }
    }
  })
}

/** Returns the `wheel` events on `elem` as a reactive stream. While the stream has listeners, event
  * listeners will be connected to the underlying HTML `elem`. */
export function wheelEvents (elem :HTMLElement) :Stream<WheelEvent> {
  return Stream.deriveStream(dispatch => {
    elem.addEventListener("wheel", dispatch)
    return () => {
      elem.removeEventListener("wheel", dispatch)
    }
  })
}

/** Returns the specified touch events on `elem` as a reactive stream. While the stream has
  * listeners, event listeners will be connected to the underlying HTML `elem`. */
export function touchEvents (elem :HTMLElement, ...types :TouchEventTypes[]) :Stream<TouchEvent> {
  return Stream.deriveStream(dispatch => {
    for (const type of types) elem.addEventListener(type, dispatch)
    return () => {
      for (const type of types) elem.removeEventListener(type, dispatch)
    }
  })
}

/** Returns the specified pointer events on `elem` as a reactive stream. While the stream has
  * listeners, event listeners will be connected to the underlying HTML `elem`. */
export function pointerEvents (
  elem :HTMLElement, ...types :PointerEventTypes[]
) :Stream<PointerEvent> {
  return Stream.deriveStream(dispatch => {
    for (const type of types) elem.addEventListener(type, dispatch)
    return () => {
      for (const type of types) elem.removeEventListener(type, dispatch)
    }
  })
}


/** Returns the keyboard events on the document as a reactive stream. While the stream has
  * listeners, event listeners will be connected to the underlying document. */
export function keyEvents (...types :KeyboardEventTypes[]) :Stream<KeyboardEvent> {
  return Stream.deriveStream(dispatch => {
    for (const type of types) document.addEventListener(type, dispatch)
    return () => {
      for (const type of types) document.removeEventListener(type, dispatch)
    }
  })
}
