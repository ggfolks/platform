import {Remover, NoopRemover, log} from "../core/util"
import {Data} from "../core/data"
import {Emitter, Subject} from "../core/react"

function eventToError (pre :string, err :Event|string) :Error {
  if (typeof err === "string") return new Error(`${pre}: ${err}`)
  else return new Error(pre)
}

const ABSOLUTE_URL_PATTERN = /^(https?|file|blob|data):/

function composeUrl (baseUrl :string, maybeRelativeUrl :string) :string {
  if (ABSOLUTE_URL_PATTERN.test(maybeRelativeUrl)) return maybeRelativeUrl
  if (maybeRelativeUrl.startsWith("/")) maybeRelativeUrl = maybeRelativeUrl.substring(1)
  return baseUrl + maybeRelativeUrl
}

type Loader = (path :string, loaded :(data :string) => void, failed :(err :Error) => void) => void
type Watcher = (path :string) => Remover

type ResourceEvent = {type :"loaded", path :string}
                   | {type :"unloaded", path :string}

/** Resource loaders load resources from some source (the file system, the network, etc.) and
  * potentially reload the data if the loader supports hot reloading. Note that because this is a
  * "consumer" interface, any errors that occur when loading resources will simply be logged, and
  * the returned subjects will not yield data.
  *
  * Resource paths should be separated by `/` and should generally be "relative" and will be
  * resolved relative to some root known by the resource loader. */
export class ResourceLoader {
  private readonly resources = new Map<string, Subject<any>>()
  private readonly reloaders = new Map<string, () => void>()
  private readonly watches = new Set<Remover>()

  /** Creates the default base URL based on the browser's location bar. This is temporary while we
    * develop and eventually we'll need to be explicit about from where resources are loaded. */
  static getDefaultBaseUrl () :string {
    return typeof location === "undefined" ? "http://localhost:8080" :
      (location.origin + location.pathname)
  }

  /** Creates a resource loader that loads resources over the network via the `fetch` API. */
  static fetchLoader (baseUrl :string) {
    const loader = new ResourceLoader(baseUrl, (path, loaded, failed) => {
      const url = loader.getUrl(path)
      fetch(url).then(rsp => {
        if (rsp.ok) rsp.text().then(loaded, failed)
        else failed(new Error(rsp.statusText))
      }, failed)
    })
    return loader
  }

  /** Emits events when resources are loaded and unloaded. */
  readonly events = new Emitter<ResourceEvent>()

  constructor (private _baseUrl :string,
               private readonly loader :Loader,
               private readonly watcher :Watcher = _ => NoopRemover) {
    this.setBaseUrl(_baseUrl) // add trailing slash if needed
  }

  /** The URL prepended to all relative resource paths when loading over the network. */
  get baseUrl () :string { return this._baseUrl }

  /** Configures the base URL of this resource loader. Resources loaded over the network will be
    * loaded relative to this base. */
  setBaseUrl (baseUrl :string) {
    this._baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`
  }

  /** Returns the URL to the asset at `path`. */
  getUrl (path :string) { return composeUrl(this.baseUrl, path) }

  /** Returns the object resource at `path`. The code is loaded as a text resource and then
    * materialized using `eval`. */
  getObject (path :string, cache = true) :Subject<any> {
    return this.getResource(path, code => this.eval(code), cache)
  }

  /** Returns the data resource at `path` which will be parsed as JSON. */
  getData (path :string, cache = true) :Subject<Data> {
    return this.getResource(path, json => JSON.parse(json), cache)
  }

  /** Loads the text resource at `path`. */
  getText (path :string, cache = true) :Subject<string> {
    return this.getResource(path, text => text, cache)
  }

  // TODO: binary resources? could return data as Uint8Array

  /** Loads the image resource at `path`. */
  getImage (path :string, cache = true) :Subject<HTMLImageElement|Error> {
    // TODO: image caching, if desired
    const url = this.getUrl(path)
    return Subject.deriveSubject(disp => {
      const image = new Image()
      image.crossOrigin = ''
      image.src = url
      image.onload = () => disp(image)
      image.onerror = err => disp(eventToError(`Failed to load '${url}'`, err))
      return NoopRemover // nothing to dispose, GC takes care of image
    })
  }

  getResource<R> (path :string, parse :(data :string) => R, cache :boolean) :Subject<R> {
    // TODO: resource caching
    let res = this.resources.get(path)
    if (!res) this.resources.set(path, res = Subject.deriveSubject(disp => {
      const reload = () => this.loader(
        path, data => disp(parse(data)),
        err => log.warn("Failed to load resource data", "path", path, err))
      this.reloaders.set(path, reload)
      const unwatch = this.watcher(path)
      this.watches.add(unwatch)
      reload()
      this.events.emit({type: "loaded", path})
      return () => {
        this.reloaders.delete(path)
        this.watches.delete(unwatch)
        unwatch()
        this.events.emit({type: "unloaded", path})
      }
    }))
    return res as Subject<R>
  }

  /** Informs the resource loader that a resource has been updated and should be reloaded. */
  noteUpdated (path :string) {
    const reloader = this.reloaders.get(path)
    reloader && reloader()
  }

  /** Parses a JavaScript value and returns the result.  Currently this just evaluates the string,
    * but in the future we may want to use a safer method.
    * @param js the JavaScript string to parse.
    * @return the parsed value. */
  eval (code :string) :Object { return eval(code) }

  /** Cleans up after this resource loader. This does not necessarily unload all resources because
    * external entities may retain references to them, but it cleans up what it can. */
  dispose () {
    for (const unwatch of this.watches) unwatch()
    this.resources.clear()
  }
}
