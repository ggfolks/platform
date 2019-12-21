import * as fs from "fs"
import * as p from "path"
import {Remover, log} from "../core/util"
import {Subject} from "../core/react"
import {ResourceLoader} from "./loader"
import {DebugLog, WatchObject} from "./data"

type WatchEvent = {type :string, file :string}

const watchedDirs = new Map<string,Subject<WatchEvent>>()

export function dirWatcher (dir :string) :Subject<WatchEvent> {
  let watch = watchedDirs.get(dir)
  if (!watch) watchedDirs.set(dir, watch = Subject.deriveSubject(disp => {
    if (DebugLog) log.debug("Watching directory", "dir", dir)
    const watcher = fs.watch(dir, (type, file) => disp({type, file}))
    return () => watcher.close()
  }))
  return watch
}

function watchFile (baseDir :string, path :string, onChange :() => void) {
  const fullPath = p.join(baseDir, path), filename = p.basename(fullPath)
  let lastChange = 0
  return dirWatcher(p.dirname(fullPath)).onEmit(({type, file}) => {
    if (file === filename) {
      const now = Date.now()
      if (now - lastChange > 500) {
        onChange()
        lastChange = now
      }
    }
  })
}

/** Creates a resource loader that loads resources via the Node `file` API and optionally watches
  * them for changes. */
export function fileLoader (baseUrl :string, baseDir :string, watch = false) {
  const loader :ResourceLoader = new ResourceLoader(baseUrl, (path, loaded, failed) => {
    fs.readFile(p.join(baseDir, path), "utf8", (err, data) => err ? failed(err) : loaded(data))
  }, !watch ? undefined : path => watchFile(baseDir, path, () => loader.noteUpdated(path)))
  return loader
}

/** Watches files requested by clients and notifies them of updates. */
export function handleWatches (obj :WatchObject, baseDir :string) :Remover {
  const watches = new Map<string, Remover>()
  const unwatch = obj.watched.onChange(ev => {
    switch (ev.type) {
    case "set":
      if (ev.prev === undefined) {
        if (DebugLog) log.debug("Starting watch", "ev", ev)
        watches.set(ev.key, watchFile(baseDir, ev.key, () => {
          obj.watched.set(ev.key, obj.watched.get(ev.key)!+1)
        }))
      }
      break
    case "deleted":
      if (DebugLog) log.debug("Ending watch", "ev", ev)
      const remover = watches.get(ev.key)
      remover && remover()
      break
    }
  })
  return () => {
    unwatch()
    for (const clear of watches.values()) clear()
  }
}
