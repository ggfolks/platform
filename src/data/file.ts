import * as P from "path"
import * as fs from "fs"
import {TextEncoder, TextDecoder} from "util"

import {UUID} from "../core/uuid"
import {Record} from "../core/data"
import {MutableMap} from "../core/rcollect"
import {Path, PathMap} from "../core/path"
import {SyncSet, SyncMap, ValueType, setTextCodec} from "../core/codec"
import {Timestamp, log} from "../core/util"
import {MapMeta, isPersist} from "./meta"
import {SyncMsg, ObjType} from "./protocol"
import {DMutable, DObject, DObjectType} from "./data"
import {AbstractDataStore, Resolved, Resolver} from "./server"

const DebugLog = true

setTextCodec(() => new TextEncoder() as any, () => new TextDecoder() as any)

function valueToJSON (value :any, vtype :ValueType) :any {
  switch (vtype) {
  case "undefined": return null
  case "boolean": return value as boolean
  case "int8":
  case "int16":
  case "int32":
  case "size8":
  case "size16":
  case "size32":
  case "float32":
  case "float64":
  case "number": return value as number
  case "string": return value as string
  case "timestamp": return value.millis
  case "uuid": return value as UUID // UUID is string in JS
  case "data": return value
  case "record": return value
  }
}

function valueFromJSON (value :any, vtype :ValueType) :any {
  switch (vtype) {
  case "undefined": return undefined
  case "boolean": return value as boolean
  case "int8":
  case "int16":
  case "int32":
  case "size8":
  case "size16":
  case "size32":
  case "float32":
  case "float64":
  case "number": return value as number
  case "string": return value as string
  case "timestamp": return new Timestamp(value as number)
  case "uuid": return value as string // UUID is a string in JS and Firestore
  case "data": return value
  case "record": return value
  }
}

// TODO: do we want fromSync to be true in here?
function setFromJSON<E> (elems :any[], etype :ValueType, into :SyncSet<E>) {
  const tmp = new Set<E>()
  for (const elem of elems) tmp.add(valueFromJSON(elem, etype))
  for (const elem of into) if (!tmp.has(elem)) into.delete(elem, true)
  for (const elem of tmp) into.add(elem, true)
}

function setToJSON<E> (set :Set<E>, etype :ValueType) :any[] {
  const data = []
  for (const elem of set) data.push(valueToJSON(elem, etype))
  return data
}

function mapFromJSON<V> (data :any, vtype :ValueType, into :SyncMap<string,V>) {
  const keys = [], vals :V[] = []
  for (const key in data) {
    keys.push(key)
    vals.push(valueFromJSON(data[key], vtype))
  }
  for (const key of into.keys()) if (!keys.includes(key)) into.delete(key, true)
  for (let ii = 0; ii < keys.length; ii += 1) into.set(keys[ii], vals[ii], true)
}

function mapToJSON<V> (map :Map<string,V>, meta :MapMeta) :Record {
  const data :Record = {}
  for (const [key, value] of map) data[key] = valueToJSON(value, meta.vtype)
  return data
}

function applyData (obj :DObject, data :Record) {
  for (const meta of obj.metas) {
    if (!isPersist(meta)) continue
    const value = data[meta.name] as any
    if (value === undefined) continue // TEMP: todo, handle undefined `value` props
    const prop = obj[meta.name]
    switch (meta.type) {
    case "value": (prop as DMutable<any>).update(valueFromJSON(value, meta.vtype), true) ; break
    case "set": setFromJSON(value, meta.etype, (prop as SyncSet<any>)) ; break
    case "map": mapFromJSON(value, meta.vtype, (prop as SyncMap<string,any>)) ; break
    }
  }
}

const pathToDir = (root :string, path :Path) => P.join(root, ...path)
const pathToFile = (root :string, path :Path, file :string) => P.join(pathToDir(root, path), file)

const readData = (file :string) => fs.promises.readFile(file, "utf8").then(
  JSON.parse, err => err.code === "ENOENT" ? {} : Promise.reject(err))

const writeData = (file :string, data :Record) => fs.promises.writeFile(file, JSON.stringify(data))

class Syncer {
  private needsFlush = false
  private needsDir = true
  constructor (readonly file :string, readonly data :Record) {}

  addSync (object :DObject, sync :SyncMsg) {
    const meta = object.metas[sync.idx], data = this.data
    // if (DebugLog) log.debug("syncToUpdate", "path", object.path, "type", sync.type,
    //                         "name", meta.name)
    switch (sync.type) {
    case ObjType.VALSET:
      data[meta.name] = valueToJSON(sync.value, sync.vtype)
      break
    case ObjType.SETADD:
    case ObjType.SETDEL:
      data[meta.name] = setToJSON(object[meta.name], sync.etype)
      break
    case ObjType.MAPSET:
    case ObjType.MAPDEL:
      data[meta.name] = mapToJSON(object[meta.name], meta as MapMeta)
      break
    }
    this.needsFlush = true
  }

  async flush () {
    if (!this.needsFlush) return
    this.needsFlush = false
    if (this.needsDir) {
      this.needsDir = false
      try {
        await fs.promises.mkdir(P.dirname(this.file), {recursive: true})
      } catch (err) {
        log.warn("Failed to create parent for object", "file", this.file, err)
      }
    }
    try {
      if (DebugLog) log.info("Flushing object data", "file", this.file, "data", this.data)
      await writeData(this.file, this.data)
    } catch (err) {
      log.warn("Failed to write data for object", "file", this.file, err)
    }
  }
}

const DEFAULT_FLUSH_FREQ = 10 * 1000

export class FileDataStore extends AbstractDataStore {
  private readonly syncers = new PathMap<Syncer>()
  private readonly flushTimer :NodeJS.Timeout

  constructor (rtype :DObjectType<any>, readonly rootDir :string, flushFreq = DEFAULT_FLUSH_FREQ) {
    super(rtype)
    log.info("File datastore syncing every " + flushFreq/1000 + "s", "root", rootDir)
    this.flushTimer = setInterval(() => this.flushUpdates(), flushFreq)
    fs.promises.mkdir(rootDir, {recursive: true}).catch(err => {
      log.warn("Failed to create datastore root", "root", rootDir, err)
    })
  }

  async resolveData (res :Resolved, resolver? :Resolver) {
    const file = pathToFile(this.rootDir, res.object.path, "data.json")
    try {
      const data = await readData(file)
      const syncer = new Syncer(file, data)
      this.syncers.set(res.object.path, syncer)
      if (resolver) resolver(res.object)
      else applyData(res.object, data)
      res.resolvedData()
    } catch (err) {
      log.warn("Failed to resolve data", "file", file, err)
    }
  }

  persistSync (obj :DObject, msg :SyncMsg) {
    const syncer = this.syncers.get(obj.path)
    if (!syncer) log.warn("Missing ref for sync persist", "obj", obj)
    else syncer.addSync(obj, msg)
  }

  protected async resolveTableData (path :Path, table :MutableMap<UUID, Record>) {
    const dir = pathToDir(this.rootDir, path)
    try {
      await fs.promises.mkdir(dir, {recursive: true})
    } catch (err) {
      log.warn("Failed to create table directory", "dir", dir, err)
    }
    try {
      const keys = await fs.promises.readdir(dir)
      for (const key of keys) {
        if (!key.endsWith(".json")) continue
        try {
          const data = await readData(P.join(dir, key))
          table.set(key.substring(0, key.length-5), data)
        } catch (err) {
          log.warn("Failed to read table record", "dir", dir, "key", key, err)
        }
      }
    } catch (err) {
      log.warn("Failed to read table directory", "dir", dir, err)
    }

    table.onChange(async (change) => {
      const file = pathToFile(this.rootDir, path, `${change.key}.json`)
      switch (change.type) {
      case "set":
        if (DebugLog) log.info(
          "Writing table record", "table", path, "file", file, "data", change.value)
        try {
          await writeData(file, change.value)
        } catch (err) {
          log.warn("Failure writing table data", "file", file, err)
        }
        break
      case "deleted":
        if (DebugLog) log.info("Deleting table record", "table", path, "file", file)
        fs.unlink(file, err => {
          if (err && err.code !== "ENOENT") console.warn(err)
        })
        break
      }
    })
  }

  private flushUpdates () {
    this.syncers.forEach(syncer => syncer.flush())
  }

  shutdown () :Promise<void> {
    this.flushUpdates()
    clearInterval(this.flushTimer)
    // TODO: wait until writes are flushed...
    return Promise.resolve()
  }
}
