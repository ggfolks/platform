import {Subject} from "./react"

function eventToError (pre :string, err :Event|string) :Error {
  if (typeof err === "string") return new Error(`${pre}: ${err}`)
  else return new Error(pre)
}

export function loadImage (url :string) :Subject<HTMLImageElement|Error> {
  return Subject.derive(disp => {
    const image = new Image()
    image.crossOrigin = ''
    image.src = url
    image.onload = () => disp(image)
    image.onerror = err => disp(eventToError(`Failed to load '${url}'`, err))
    return () => {} // nothing to dispose, GC takes care of image
  })
}
