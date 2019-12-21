import {Remover, log} from "../core/util"
import {UUID} from "../core/uuid"
import {dmap, dqueue} from "../data/meta"
import {Auth} from "../auth/auth"
import {DContext, DObject} from "../data/data"
import {ResourceLoader, isAbsoluteUrl} from "./loader"

export const DebugLog = false

export type WatchReq = {type :"watch", path :string}
                     | {type :"unwatch", path :string}

export class WatchObject extends DObject {
  private watching = new Map<string, Set<UUID>>()

  @dmap("string", "size32")
  watched = this.map<string, number>()

  @dqueue(handleWatchRequest)
  watchq = this.queue<WatchReq>()

  addWatch (path :string, watcher :UUID) {
    let watching = this.watching.get(path)
    if (!watching) this.watching.set(path, watching = new Set())
    watching.add(watcher)
    if (!this.watched.has(path)) this.watched.set(path, 0)
  }

  removeWatch (path :string, watcher :UUID) {
    let watching = this.watching.get(path)
    if (watching) {
      watching.delete(watcher)
      if (watching.size === 0) {
        this.watching.delete(path)
        this.watched.delete(path)
      }
    }
    else log.warn("No watching set for unwatched resource", "path", path, "watcher", watcher)
  }

  canSubscribe (auth :Auth) { return true }

  noteUnsubscribed (ctx :DContext) {
    const watcher = ctx.auth.id
    for (const [path, watchers] of this.watching) {
      if (watchers.has(watcher)) this.removeWatch(path, watcher)
    }
  }
}

function handleWatchRequest (ctx :DContext, obj :WatchObject, req :WatchReq) {
  switch (req.type) {
  case "watch": obj.addWatch(req.path, ctx.auth.id) ; break
  case "unwatch": obj.removeWatch(req.path, ctx.auth.id) ; break
  }
}

export function watchLoader (loader :ResourceLoader, object :WatchObject) :Remover {
  const unloader = loader.events.onEmit(ev => {
    if (DebugLog) log.debug("Loader change", "ev", ev)
    switch (ev.type) {
    case "loaded":
      if (!isAbsoluteUrl(ev.path)) object.watchq.post({type: "watch", path: ev.path})
      break
    case "unloaded":
      if (!isAbsoluteUrl(ev.path)) object.watchq.post({type: "unwatch", path: ev.path})
      break
    }
  })
  const unobject = object.watched.onChange(ev => {
    if (DebugLog) log.debug("Watched change", "ev", ev)
    if (ev.type === "set") loader.noteUpdated(ev.key)
  })
  return () => { unloader() ; unobject() }
}
