import {Subject} from "./react"
import {NoopRemover} from "./util"

function eventToError (pre :string, err :Event|string) :Error {
  if (typeof err === "string") return new Error(`${pre}: ${err}`)
  else return new Error(pre)
}

export function loadImage (url :string) :Subject<HTMLImageElement|Error> {
  return Subject.deriveSubject(disp => {
    const image = new Image()
    image.crossOrigin = ''
    image.src = getAbsoluteUrl(url)
    image.onload = () => disp(image)
    image.onerror = err => disp(eventToError(`Failed to load '${url}'`, err))
    return NoopRemover // nothing to dispose, GC takes care of image
  })
}

let baseUrl = ""

/** Sets the base URL to use to resolve relative URLs. */
export function setBaseUrl (url :string) {
  baseUrl = url.endsWith("/") ? url : url + "/"
}
setBaseUrl(
  typeof location === "undefined" ? "http://localhost:8080" : (location.origin + location.pathname),
)

const ABSOLUTE_URL_PATTERN = /^(https?|file|blob):/

/** Given an URL that may be absolute or relative, returns an absolute URL relative to the base. */
export function getAbsoluteUrl (maybeRelativeUrl :string) :string {
  if (ABSOLUTE_URL_PATTERN.test(maybeRelativeUrl)) return maybeRelativeUrl
  if (maybeRelativeUrl.startsWith("/")) maybeRelativeUrl = maybeRelativeUrl.substring(1)
  return baseUrl + maybeRelativeUrl
}
