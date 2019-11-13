import {Stream} from "../core/react"

type FilterFlags<Base, Condition> = {
  [Key in keyof Base] :Base[Key] extends Condition ? Key : never
}
type AllowedNames<Base, Condition> = FilterFlags<Base, Condition>[keyof Base]
type MouseEventTypes = AllowedNames<GlobalEventHandlersEventMap, MouseEvent>
type TouchEventTypes = AllowedNames<GlobalEventHandlersEventMap, TouchEvent>
type PointerEventTypes = AllowedNames<GlobalEventHandlersEventMap, PointerEvent>
type KeyboardEventTypes = AllowedNames<GlobalEventHandlersEventMap, KeyboardEvent>

/** Returns the specified mouse events on `document` as a reactive stream. While the stream has
  * listeners, event listeners will be connected to the DOM. */
export function mouseEvents (...types :MouseEventTypes[]) :Stream<MouseEvent> {
  return Stream.deriveStream(dispatch => {
    for (const type of types) document.addEventListener(type, dispatch)
    return () => {
      for (const type of types) document.removeEventListener(type, dispatch)
    }
  })
}

/** Returns the `wheel` events on `document` as a reactive stream. While the stream has listeners,
  * event listeners will be connected to the DOM. */
export const wheelEvents :Stream<WheelEvent> = Stream.deriveStream(dispatch => {
  document.addEventListener("wheel", dispatch)
  return () => document.removeEventListener("wheel", dispatch)
})

/** Returns the specified touch events on `document` as a reactive stream. While the stream has
  * listeners, event listeners will be connected to the DOM. */
export function touchEvents (...types :TouchEventTypes[]) :Stream<TouchEvent> {
  return Stream.deriveStream(dispatch => {
    for (const type of types) document.addEventListener(type, dispatch, {passive: false})
    return () => {
      for (const type of types) document.removeEventListener(type, dispatch)
    }
  })
}

/** Returns the specified pointer events on `document` as a reactive stream. While the stream has
  * listeners, event listeners will be connected to the DOM. */
export function pointerEvents (...types :PointerEventTypes[]) :Stream<PointerEvent> {
  return Stream.deriveStream(dispatch => {
    for (const type of types) document.addEventListener(type, dispatch)
    return () => {
      for (const type of types) document.removeEventListener(type, dispatch)
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
