import {Remover, NoopRemover, developMode, log} from "../core/util"
import {Data} from "../core/data"
import {Emitter, Subject, Mutable} from "../core/react"

function eventToError (pre :string, err :Event|string) :Error {
  if (typeof err === "string") return new Error(`${pre}: ${err}`)
  else return new Error(pre)
}

const ABSOLUTE_URL_PATTERN = /^(https?|file|blob|data):/
export const isAbsoluteUrl = (path :string) => ABSOLUTE_URL_PATTERN.test(path)

function composeUrl (baseUrl :string, maybeRelativeUrl :string) :string {
  if (isAbsoluteUrl(maybeRelativeUrl)) return maybeRelativeUrl
  if (maybeRelativeUrl.startsWith("/")) maybeRelativeUrl = maybeRelativeUrl.substring(1)
  return baseUrl + maybeRelativeUrl
}

type Loader<T> = (path :string, loaded :(data :T) => void, failed :(err :Error) => void) => void
type Watcher = (path :string) => Remover

type ResourceEvent = {type :"loaded", path :string}
                   | {type :"unloaded", path :string}

const UPDATE_ERA = Date.now()

class Resource<T,R> {
  readonly value = Mutable.local<R|undefined>(undefined)
  readonly subject = Subject.deriveSubject<R>(disp => {
    const unobserve = this.value.onValue(v => v && disp(v))
    return () => {
      unobserve()
      if (!this.cached) this.unload()
    }
  })
  update = UPDATE_ERA
  cached = false

  constructor (readonly owner :ResourceLoader, readonly path :string, readonly unwatch :Remover,
               readonly loader :Loader<T>, readonly parser :(data :T) => R) {
    if (path === "") throw new Error("Invalid empty resource path")
    owner.events.emit({type: "loaded", path})
    this.reload()
  }

  reload () {
    const {path, loader, parser, value} = this
    const vpath = developMode && !isAbsoluteUrl(path) ? `${path}?${this.update++}` : path
    loader(vpath, data => value.update(parser(data)),
           err => log.warn("Failed to load resource data", "path", vpath, err))
  }
  unload () {
    this.unwatch()
    this.owner._unload(this.path)
  }
}

/** Resource loaders load resources from some source (the file system, the network, etc.) and
  * potentially reload the data if the loader supports hot reloading. Note that because this is a
  * "consumer" interface, any errors that occur when loading resources will simply be logged, and
  * the returned subjects will not yield data.
  *
  * Resource paths should be separated by `/` and should generally be "relative" and will be
  * resolved relative to some root known by the resource loader. */
export class ResourceLoader {
  private readonly resources = new Map<string, Resource<any,any>>()

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
               private loader :Loader<string>,
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

  /** Configures the loader to use when loading text and config resources. */
  setDataLoader (loader :Loader<string>) {
    this.loader = loader
  }

  /** Returns the URL to the asset at `path`. */
  getUrl (path :string) :string { return composeUrl(this.baseUrl, path) }

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
  getImage (path :string, cache = true) :Subject<HTMLImageElement> {
    return this._getResource<HTMLImageElement,HTMLImageElement>(path, (path, loaded, failed) => {
      const url = this.getUrl(path)
      const image = new Image()
      image.crossOrigin = ''
      image.src = url
      image.onload = () => loaded(image)
      image.onerror = err => {
        failed(eventToError(`Failed to load '${url}'`, err))
        // TODO: also succeed with error image
      }
    }, cache, d => d)
  }

  getResource<R> (path :string, parse :(data :string) => R, cache :boolean) :Subject<R> {
    return this._getResource(path, this.loader, cache, parse)
  }

  getResourceVia<R> (path :string, loader :Loader<R>, cache :boolean) :Subject<R> {
    return this._getResource(path, loader, cache, d => d)
  }

  /** Informs the resource loader that a resource has been updated and should be reloaded. */
  noteUpdated (path :string) {
    const resource = this.resources.get(path)
    resource && resource.reload()
  }

  /** Parses a JavaScript value and returns the result.  Currently this just evaluates the string,
    * but in the future we may want to use a safer method.
    * @param js the JavaScript string to parse.
    * @return the parsed value. */
  eval (code :string) :Object { return eval(code) }

  /** Cleans up after this resource loader. This does not necessarily unload all resources because
    * external entities may retain references to them, but it cleans up what it can. */
  dispose () {
    for (const resource of this.resources.values()) resource.unwatch()
    this.resources.clear()
  }

  _unload (path :string) {
    this.resources.delete(path)
  }

  private _getResource<R, T> (path :string, loader :Loader<T>, cache :boolean,
                              parser :(data :T) => R) :Subject<R> {
    let res = this.resources.get(path)
    if (!res) this.resources.set(path, res = new Resource(
      this, path, this.watcher(path), loader, parser))
    res.cached = res.cached || cache
    return res.subject as Subject<R>
  }
}
